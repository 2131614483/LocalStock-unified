/**
 * 价格行为 AI 服务进程托管。
 *
 * pa-agent 的源码随桌面端分发（`python/pa-agent`，打包后 `resources/python/pa-agent`），
 * 本模块负责在应用启动时把它作为子进程拉起，退出时关闭，崩溃时有限重启。
 *
 * 运行环境由 `electron/pa/runtime.ts` 供给：服务**始终跑在独立虚拟环境里**
 * （不依赖系统 Python 的包）。本机已有 Python 时用它建 venv；一个都没有时
 * 自动从 GitHub 下载独立 CPython 再建 —— 因此把项目拷到别的电脑也能直接跑。
 *
 * 端口：服务端以 PA_AGENT_PORT=0 让系统分配空闲端口，再写入 PA_AGENT_PORT_FILE，
 * 由本模块读取 —— 避免双方抢同一端口的竞态。
 */
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pythonDir, stockDataPath } from '../backtest'
import type { PaServerState, PaServerStatus } from '../../shared/types'
import { killProcessTree } from './proc'
import { ensurePaEnv, hasManagedPython, paVenvDir, paVenvPython, type ProgressFn } from './runtime'
import { loadPaConfig } from './config'

/** 运行产物目录名（分析记录/日志） */
const RUNTIME_DIRNAME = 'pa-agent'

/** 端口等待与健康检查超时 */
const PORT_WAIT_TIMEOUT_MS = 25_000
const READY_POLL_INTERVAL_MS = 250
const HEALTH_TIMEOUT_MS = 10_000

/** 意外退出后的最大重启次数与退避 */
const MAX_RESTARTS = 3
const RESTART_BACKOFF_MS = [1500, 4000, 9000]

/** 保留的诊断日志行数（界面「查看日志」展示的就是它） */
const LOG_TAIL_LINES = 80

interface InternalState {
  state: PaServerState
  port: number | null
  error: string | null
  python: string | null
  log: string[]
  child: ChildProcess | null
  stopping: boolean
  restarts: number
  /** 环境是否已确认就绪（避免每次启动都重新探测） */
  envReady: boolean
  /** 环境准备进度回调（安装时把 JSONL 推给界面） */
  onProgress: ProgressFn | null
  startPromise: Promise<PaServerStatus> | null
}

const state: InternalState = {
  state: 'stopped',
  port: null,
  error: null,
  python: null,
  log: [],
  child: null,
  stopping: false,
  restarts: 0,
  envReady: false,
  onProgress: null,
  startPromise: null
}

// ── 路径 ──────────────────────────────────────────────────────────────────────

export function paServiceDir(): string {
  return join(pythonDir(), loadPaConfig().profile === 'aggressive' ? 'pa-agent-aggressive' : 'pa-agent')
}

export function paServerScript(): string {
  return join(paServiceDir(), 'server.py')
}

export function paRuntimeDir(): string {
  return join(app.getPath('userData'), loadPaConfig().profile === 'aggressive' ? `${RUNTIME_DIRNAME}-aggressive` : RUNTIME_DIRNAME)
}

/** 服务端写入的日志文件（server.py 的 RotatingFileHandler 目标） */
export function paLogFile(): string {
  return join(paRuntimeDir(), 'logs', 'pa_agent.log')
}

export { hasManagedPython, paVenvDir, paVenvPython }

// ── 日志 ──────────────────────────────────────────────────────────────────────

function appendLog(text: string): void {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    state.log.push(line)
  }
  if (state.log.length > LOG_TAIL_LINES) {
    state.log.splice(0, state.log.length - LOG_TAIL_LINES)
  }
}

// ── 子进程环境 ────────────────────────────────────────────────────────────────

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // PYTHONPATH 可能让子进程导入到错误的同名包，去掉
  delete env.PYTHONPATH
  env.PYTHONUTF8 = '1'
  env.PYTHONIOENCODING = 'utf-8'
  return {
    ...env,
    LOCALSTOCK_MARKET_DB: stockDataPath(),
    LOCALSTOCK_PA_RUNTIME_DIR: paRuntimeDir(),
    PA_AGENT_HOST: '127.0.0.1',
    ...extra
  }
}

// ── 端口/健康 ─────────────────────────────────────────────────────────────────

function waitForPortFile(portFile: string, child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + PORT_WAIT_TIMEOUT_MS
    let settled = false
    const done = (port: number | null): void => {
      if (settled) return
      settled = true
      resolve(port)
    }
    const tick = (): void => {
      if (settled) return
      if (existsSync(portFile)) {
        const port = Number(readFileSync(portFile, 'utf8').trim())
        if (Number.isFinite(port) && port > 0) return done(port)
      }
      // 子进程已死就没必要再等
      if (child.exitCode !== null || child.signalCode !== null) return done(null)
      if (Date.now() > deadline) return done(null)
      setTimeout(tick, READY_POLL_INTERVAL_MS)
    }
    tick()
  })
}

/** 等 /api/health 可用；失败时把服务端给的原因带回来，便于界面与日志定位 */
async function waitForHealth(baseUrl: string): Promise<{ ok: boolean; reason: string }> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastReason = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return { ok: true, reason: '' }
      // 非 200 时服务端会带 message（如「行情库缺少 stocks 表」），保留下来
      try {
        const body = (await res.json()) as { message?: string }
        if (body?.message) lastReason = body.message
      } catch {
        lastReason = `HTTP ${res.status}`
      }
    } catch {
      // 还没起来，继续轮询
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS))
  }
  return { ok: false, reason: lastReason }
}

// ── 启动 / 停止 ───────────────────────────────────────────────────────────────

async function start(): Promise<PaServerStatus> {
  if (state.state === 'ready' && state.port) return getPaServerStatus()
  if (state.startPromise) return state.startPromise

  state.startPromise = (async (): Promise<PaServerStatus> => {
    state.stopping = false
    const script = paServerScript()
    if (!existsSync(script)) {
      state.state = 'error'
      state.error = `未找到 pa-agent 服务脚本：${script}`
      return getPaServerStatus()
    }

    // 1. 环境供给（首次会自动准备：本机 Python 建 venv，或下载独立 CPython）
    if (!state.envReady) {
      state.state = 'starting'
      state.error = null
      const env = await ensurePaEnv(
        (evt) => state.onProgress?.(evt),
        appendLog,
        false
      )
      if (!env.ready || !env.python) {
        state.state = 'no-deps'
        state.error = env.message
        appendLog(`[env] ${env.message}`)
        return getPaServerStatus()
      }
      state.envReady = true
      state.python = env.python
    }

    const python = state.python ?? paVenvPython()
    state.state = 'starting'
    state.error = null

    const portFile = join(app.getPath('temp'), `pa-agent-port-${process.pid}.txt`)
    try {
      rmSync(portFile, { force: true })
    } catch {
      // 忽略：文件不存在是常态
    }
    mkdirSync(paRuntimeDir(), { recursive: true })

    appendLog(`[start] ${python} ${script}`)
    let child: ChildProcess
    try {
      child = spawn(python, [script], {
        cwd: paServiceDir(),
        env: childEnv({
          PA_AGENT_PORT: '0',
          PA_AGENT_PORT_FILE: portFile,
          // 供服务端监视父进程：桌面端被强制结束时（Windows 不会自动带走子进程）
          // 服务随之退出，避免留下孤儿进程占着端口
          PA_AGENT_PARENT_PID: String(process.pid)
        }),
        windowsHide: true
      })
    } catch (error) {
      state.state = 'error'
      state.error = `启动失败：${error instanceof Error ? error.message : String(error)}`
      return getPaServerStatus()
    }

    state.child = child
    child.stdout?.on('data', (d: Buffer) => appendLog(d.toString('utf8')))
    child.stderr?.on('data', (d: Buffer) => appendLog(d.toString('utf8')))
    child.on('error', (error) => {
      appendLog(`[error] ${error.message}`)
    })
    child.on('close', (code) => {
      state.child = null
      state.port = null
      if (state.stopping) {
        state.state = 'stopped'
        return
      }
      appendLog(`[exit] 服务进程退出，退出码 ${code}`)
      // 意外退出：有限重启
      if (state.restarts < MAX_RESTARTS) {
        const delay = RESTART_BACKOFF_MS[Math.min(state.restarts, RESTART_BACKOFF_MS.length - 1)]
        state.restarts += 1
        appendLog(`[restart] ${delay}ms 后第 ${state.restarts} 次重启`)
        setTimeout(() => {
          void start().then((s) => {
            if (s.state === 'ready') state.restarts = 0
          })
        }, delay)
      } else {
        state.state = 'error'
        state.error = `价格行为服务反复退出（已重试 ${MAX_RESTARTS} 次），请查看日志。`
      }
    })

    const port = await waitForPortFile(portFile, child)
    try {
      rmSync(portFile, { force: true })
    } catch {
      // 忽略
    }

    if (port === null) {
      state.state = 'error'
      state.error = state.error ?? '价格行为服务启动超时，请查看日志。'
      return getPaServerStatus()
    }

    state.port = port
    const baseUrl = `http://127.0.0.1:${port}`
    const health = await waitForHealth(baseUrl)
    if (!health.ok) {
      state.state = 'error'
      state.error = health.reason
        ? `价格行为服务健康检查未通过：${health.reason}`
        : '价格行为服务已启动但健康检查未通过，请查看日志。'
      appendLog(`[health] ${state.error}`)
      return getPaServerStatus()
    }

    state.state = 'ready'
    state.error = null
    state.restarts = 0
    appendLog(`[ready] ${baseUrl}`)
    return getPaServerStatus()
  })()

  try {
    return await state.startPromise
  } finally {
    state.startPromise = null
  }
}

export function stopPaServer(): void {
  state.stopping = true
  const child = state.child
  if (child?.pid && child.exitCode === null) {
    killProcessTree(child)
  }
  state.child = null
  state.port = null
  state.state = 'stopped'
}

/** 手动重启：先停再起，并让环境重新判定 */
export async function restartPaServer(): Promise<PaServerStatus> {
  stopPaServer()
  state.envReady = false
  state.restarts = 0
  state.log = []
  await new Promise((r) => setTimeout(r, 400))
  return start()
}

export function getPaServerStatus(): PaServerStatus {
  return {
    state: state.state,
    baseUrl: state.port ? `http://127.0.0.1:${state.port}` : null,
    port: state.port,
    error: state.error,
    log: [...state.log],
    python: state.python,
    serviceDir: paServiceDir(),
    venvDir: paVenvDir(),
    logFile: paLogFile()
  }
}

/** 供客户端取用：服务就绪时返回 baseUrl，否则抛错 */
export function requirePaBaseUrl(override?: string | null): string {
  const manual = override?.trim()
  if (manual) return manual.replace(/\/$/, '')
  if (state.state === 'ready' && state.port) return `http://127.0.0.1:${state.port}`
  if (state.state === 'no-deps') throw new Error(state.error ?? '价格行为 AI 运行环境未就绪')
  if (state.state === 'starting') throw new Error('价格行为 AI 正在准备运行环境，请稍候…')
  throw new Error(state.error ?? '价格行为服务未运行')
}

// ── 环境安装（界面按钮 / 首次自动） ───────────────────────────────────────────

export interface DepsInstallResult {
  ok: boolean
  error?: string
}

let installing = false

/** 强制重新准备运行环境，完成后重启服务使之生效 */
export async function installPaDeps(onProgress: ProgressFn): Promise<DepsInstallResult> {
  if (installing) return { ok: false, error: '正在准备中，请稍候' }
  installing = true
  state.state = 'starting'
  state.error = null
  try {
    const env = await ensurePaEnv(onProgress, appendLog, true)
    if (!env.ready || !env.python) {
      state.state = 'no-deps'
      state.error = env.message
      return { ok: false, error: env.message }
    }
    state.envReady = true
    state.python = env.python
    const status = await restartPaServer()
    if (status.state !== 'ready') {
      return { ok: false, error: status.error ?? '环境已就绪但服务未能启动' }
    }
    return { ok: true }
  } finally {
    installing = false
  }
}

/** 应用启动时调用；失败不抛出，错误通过状态暴露给界面 */
export async function startPaServerSafe(onProgress?: ProgressFn): Promise<PaServerStatus> {
  state.onProgress = onProgress ?? null
  try {
    return await start()
  } catch (error) {
    state.state = 'error'
    state.error = error instanceof Error ? error.message : String(error)
    return getPaServerStatus()
  } finally {
    state.onProgress = null
  }
}
