/**
 * pa-agent 的独立运行环境供给。
 *
 * 目标：**可迁移 + 独立化**。换一台电脑、没有任何 Python 时也能自己把环境备好，
 * 且服务始终跑在自己的虚拟环境里（不依赖系统 Python 的包，避免版本/依赖漂移）。
 *
 * 供给顺序（首次启动自动走一遍，之后直接命中缓存）：
 *   1. `<userData>/pa-agent-venv` 已健康 → 直接用（零下载）
 *   2. 找一个可用作「基础解释器」的 Python：
 *        设置里的 pythonPath → 随程序分发的 runtime → 本机 Python 官方安装目录 → PATH
 *   3. 一个都没有 → 从 GitHub 下载可重定位的独立 CPython，再用它建 venv
 *
 * 环境一律落在 userData（打包后 resources 只读，不能就地建环境）。
 */
import { app } from 'electron'
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { pythonDir } from '../backtest'
import { getSetting } from '../db'
import { killProcessTree } from './proc'

/** pa-agent 运行需要的第三方模块（tiktoken 可选，有字符数兜底）
 *  tzdata 必需：Windows 无系统时区库，zoneinfo 加载 Asia/Shanghai 会失败。 */
export const REQUIRED_MODULES = ['openai', 'pydantic', 'jsonschema', 'tzdata']

const VENV_DIRNAME = 'pa-agent-venv'
/** 从 GitHub 下载的独立 CPython 落在这里（userData 可写，且能跨版本升级保留） */
const STANDALONE_DIRNAME = 'pa-agent-python'

/** 可重定位的独立 CPython（astral-sh/python-build-standalone） */
const PY_VERSION = '3.12.14'
const PB_RELEASE = '20260901'
const PY_ASSET = `cpython-${PY_VERSION}+${PB_RELEASE}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`
const PY_GH_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PB_RELEASE}/${PY_ASSET}`

/**
 * 下载地址（按可用性排序，逐个尝试）。
 *
 * 实测：国内直连 GitHub release 常常连不上（HTTP 000），而 GitHub 代理可用，
 * 所以代理优先、官方兜底。可用 `PA_AGENT_PY_DOWNLOAD_BASE` 指定自己的镜像前缀
 * （形如 `https://ghproxy.net/https://github.com`，会拼上官方路径）。
 */
function pythonDownloadUrls(): string[] {
  const override = process.env.PA_AGENT_PY_DOWNLOAD_BASE?.trim()
  const urls: string[] = []
  if (override) urls.push(`${override.replace(/\/$/, '')}/${PY_ASSET}`)
  for (const prefix of ['https://ghproxy.net/', 'https://gh-proxy.com/']) {
    urls.push(`${prefix}${PY_GH_URL}`)
  }
  urls.push(PY_GH_URL)
  return [...new Set(urls)]
}

/** venv 创建/依赖安装的超时（首次要下包，给足时间） */
const SETUP_TIMEOUT_MS = 10 * 60_000
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000

export type ProgressFn = (evt: Record<string, unknown>) => void

export interface PaEnv {
  ready: boolean
  /** 就绪时的 venv 解释器路径 */
  python: string | null
  /** 未就绪时的可操作说明 */
  message: string
}

// ── 路径 ──────────────────────────────────────────────────────────────────────

export function paVenvDir(): string {
  return join(app.getPath('userData'), VENV_DIRNAME)
}

export function paVenvPython(): string {
  return join(paVenvDir(), 'Scripts', 'python.exe')
}

export function paStandaloneDir(): string {
  return join(app.getPath('userData'), STANDALONE_DIRNAME)
}

export function paSetupScript(): string {
  return join(pythonDir(), 'pa-agent', 'scripts', 'setup_env.py')
}

export function paRequirements(): string {
  return join(pythonDir(), 'pa-agent', 'requirements.txt')
}

export function hasManagedPython(): boolean {
  return existsSync(paVenvPython())
}

// ── 探测 ──────────────────────────────────────────────────────────────────────

/** 解释器是否具备 pa-agent 的依赖 */
export function probeDeps(python: string, cwd?: string): { ok: boolean; missing: string[]; detail: string } {
  const code =
    'import importlib.util, json, sys\n' +
    `missing = [m for m in ${JSON.stringify(REQUIRED_MODULES)} if importlib.util.find_spec(m) is None]\n` +
    'sys.stdout.write(json.dumps(missing))\n'
  const env = { ...process.env }
  delete env.PYTHONPATH
  env.PYTHONUTF8 = '1'
  let r: SpawnSyncReturns<string>
  try {
    r = spawnSync(python, ['-c', code], { env, windowsHide: true, encoding: 'utf8', timeout: 30_000, cwd })
  } catch (error) {
    return { ok: false, missing: REQUIRED_MODULES, detail: error instanceof Error ? error.message : String(error) }
  }
  if (r.error) {
    return { ok: false, missing: REQUIRED_MODULES, detail: r.error.message }
  }
  try {
    const missing = JSON.parse((r.stdout || '').trim() || '[]') as string[]
    return { ok: missing.length === 0, missing, detail: (r.stderr || '').trim() }
  } catch {
    return { ok: false, missing: REQUIRED_MODULES, detail: (r.stderr || '').trim() || `无法运行解释器: ${python}` }
  }
}

/**
 * 本机可以作为「基础解释器」的 Python（用于创建 venv）。
 *
 * 之所以要枚举：`python` 在 PATH 上未必是想要的那个（本机 PATH 上是 Anaconda，
 * 恰好缺 openai），而 Python 官方安装目录里的往往自带我们需要的包。
 */
export function candidateBasePythons(): string[] {
  // 调试用：强制走「本机没有 Python」分支，用来验证从 GitHub 下载独立运行时的路径
  if (process.env.LOCALSTOCK_PA_FORCE_DOWNLOAD === '1') return []

  const out: string[] = []

  const configured = getSetting('pythonPath')?.trim()
  if (configured) out.push(configured)

  // 随程序分发的独立运行时（若存在，最省事）
  const bundled = join(pythonDir(), 'pa-agent', 'runtime', 'python.exe')
  if (existsSync(bundled)) out.push(bundled)

  // 之前下载过的独立 CPython
  const standalone = join(paStandaloneDir(), 'python.exe')
  if (existsSync(standalone)) out.push(standalone)

  // Python 官方安装目录（新版本优先）
  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Python') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Python') : ''
  ].filter(Boolean)
  for (const root of roots) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue // 目录不存在是常态
    }
    const versions = names
      .filter((n) => /^Python3\d*$/.test(n))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const name of versions) {
      const exe = join(root, name, 'python.exe')
      if (existsSync(exe)) out.push(exe)
    }
  }

  out.push('python')
  return [...new Set(out)]
}

/** 基础解释器必须自带 venv 模块（嵌入版没有，用它建的"venv"不可用） */
function canCreateVenv(python: string): boolean {
  const env = { ...process.env }
  delete env.PYTHONPATH
  try {
    const r = spawnSync(python, ['-c', 'import venv, ensurepip; print("ok")'], {
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30_000
    })
    return !r.error && r.status === 0
  } catch {
    return false
  }
}

/** venv 是否真的可用（不能只看文件在不在） */
export function venvHealthy(): boolean {
  const py = paVenvPython()
  if (!existsSync(py)) return false
  return probeDeps(py).ok
}

// ── 建 venv + 装依赖 ──────────────────────────────────────────────────────────

/** 跑 setup_env.py，把 JSONL 进度转给 onProgress */
function runSetup(basePython: string, onProgress: ProgressFn, log: (s: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const script = paSetupScript()
    if (!existsSync(script)) {
      onProgress({ type: 'error', message: `未找到环境安装脚本：${script}` })
      return resolve(false)
    }
    const env = { ...process.env }
    delete env.PYTHONPATH
    env.PYTHONUTF8 = '1'
    env.PYTHONIOENCODING = 'utf-8'

    let child
    try {
      child = spawn(basePython, [script, '--venv', paVenvDir()], {
        cwd: dirname(script),
        env,
        windowsHide: true
      })
    } catch (error) {
      onProgress({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      return resolve(false)
    }

    const timer = setTimeout(() => {
      log('[setup] 超时，终止安装')
      // 按树杀：setup_env 自身还会派生 venv/pip 子进程，只杀外壳会留下它们
      killProcessTree(child)
      resolve(false)
    }, SETUP_TIMEOUT_MS)

    let buf = ''
    const handle = (d: Buffer): void => {
      buf += d.toString('utf8')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        log(`[setup] ${line}`)
        try {
          onProgress(JSON.parse(line) as Record<string, unknown>)
        } catch {
          onProgress({ type: 'log', message: line })
        }
      }
    }
    child.stdout?.on('data', handle)
    child.stderr?.on('data', handle)
    child.on('error', (error) => {
      clearTimeout(timer)
      onProgress({ type: 'error', message: error.message })
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

// ── 无环境时从 GitHub 下载独立 CPython ────────────────────────────────────────

/**
 * 解压 .tar.gz。
 *
 * 必须用系统自带的 bsdtar（`%SystemRoot%\System32\tar.exe`）而不是 PATH 上的 `tar`：
 * 若 PATH 上是 Git/MSYS 的 GNU tar，它会把 Windows 路径 `C:\...` 按 `host:path`
 * 语法解析成远程主机，直接失败（实测退出码 2）。
 */
function extractTarGz(archive: string, targetDir: string): void {
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const candidates = existsSync(systemTar) ? [systemTar, 'tar'] : ['tar']
  let lastError = ''
  for (const bin of candidates) {
    const r = spawnSync(bin, ['-xzf', archive, '-C', targetDir], {
      windowsHide: true,
      encoding: 'utf8'
    })
    if (!r.error && r.status === 0) return
    lastError = r.error?.message ?? ((r.stderr || '').trim() || `tar 退出码 ${r.status}`)
  }
  throw new Error(`解压失败：${lastError}`)
}

async function downloadAndExtract(targetDir: string, onProgress: ProgressFn, log: (s: string) => void): Promise<boolean> {
  const archive = join(app.getPath('temp'), PY_ASSET)
  try {
    onProgress({ type: 'progress', stage: 'download-python', message: `下载独立 Python（${PY_VERSION}）…` })
    const urls = pythonDownloadUrls()
    let lastError = ''
    let ok = false
    for (const url of urls) {
      try {
        log(`[download] ${url}`)
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archive))
        ok = true
        break
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        log(`[download] 该地址失败：${lastError}`)
      }
    }
    if (!ok) throw new Error(lastError || '所有下载地址均不可用')
    log(`[download] 完成 ${(statSync(archive).size / 1024 / 1024).toFixed(1)} MB`)

    onProgress({ type: 'progress', stage: 'extract-python', message: '解压独立 Python…' })
    rmSync(targetDir, { recursive: true, force: true })
    mkdirSync(targetDir, { recursive: true })
    extractTarGz(archive, targetDir)
    // 归档内层通常还有一层 python/
    const inner = readdirSync(targetDir).find((n) => existsSync(join(targetDir, n, 'python.exe')))
    if (inner) {
      const innerPath = join(targetDir, inner)
      const tmp = join(targetDir, '__inner__')
      renameSync(innerPath, tmp)
      for (const n of readdirSync(tmp)) renameSync(join(tmp, n), join(targetDir, n))
      rmSync(tmp, { recursive: true, force: true })
    }
    if (!existsSync(join(targetDir, 'python.exe'))) throw new Error('解压后未找到 python.exe')
    rmSync(archive, { force: true })
    log(`[download] 就绪：${targetDir}`)
    return true
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log(`[download] 失败：${msg}`)
    onProgress({
      type: 'error',
      message:
        `无法下载独立 Python（${msg}）。` +
        '可手动安装 Python 3.10+ 后在设置 → 回测里指定 pythonPath，或检查网络/代理。'
    })
    rmSync(archive, { force: true })
    return false
  }
}

// ── 对外入口 ──────────────────────────────────────────────────────────────────

/**
 * 确保 pa-agent 的虚拟环境就绪（全自动）。已就绪时零开销、零下载。
 *
 * @param onProgress 进度回调（JSONL 事件，界面据此显示"正在准备运行环境…"）
 * @param log        诊断日志
 * @param force      忽略现有 venv，强制重建
 */
export async function ensurePaEnv(
  onProgress: ProgressFn,
  log: (s: string) => void,
  force = false
): Promise<PaEnv> {
  if (!force && venvHealthy()) {
    return { ready: true, python: paVenvPython(), message: '' }
  }

  // 找一个能建 venv 的基础解释器
  const tried: string[] = []
  for (const base of candidateBasePythons()) {
    if (!canCreateVenv(base)) {
      tried.push(base)
      log(`[env] ${base} 不能创建虚拟环境（缺 venv/ensurepip），跳过`)
      continue
    }
    log(`[env] 用 ${base} 创建独立虚拟环境`)
    onProgress({ type: 'progress', stage: 'create-venv', message: `使用 ${base} 创建独立运行环境…` })
    const ok = await runSetup(base, onProgress, log)
    if (ok && venvHealthy()) {
      onProgress({ type: 'done', venv: paVenvDir(), python: paVenvPython() })
      return { ready: true, python: paVenvPython(), message: '' }
    }
    log('[env] 该基础解释器建环境失败，尝试下一个')
  }

  // 本机没有可用 Python：下载独立 CPython 再建环境
  log('[env] 未找到可用 Python，改为下载独立运行时')
  onProgress({ type: 'progress', stage: 'download-python', message: '本机没有可用的 Python，正在下载…' })
  const downloaded = await downloadAndExtract(paStandaloneDir(), onProgress, log)
  if (downloaded) {
    const base = join(paStandaloneDir(), 'python.exe')
    const ok = await runSetup(base, onProgress, log)
    if (ok && venvHealthy()) {
      onProgress({ type: 'done', venv: paVenvDir(), python: paVenvPython() })
      return { ready: true, python: paVenvPython(), message: '' }
    }
  }

  const message =
    '无法准备价格行为 AI 的运行环境：本机没有可用的 Python，且下载独立运行时失败。' +
    '可手动安装 Python 3.10+ 后在设置中指定 pythonPath，然后点击「重启服务」。'
  tried.length && log(`[env] 已尝试过的解释器：${tried.join(' , ')}`)
  return { ready: false, python: null, message }
}
