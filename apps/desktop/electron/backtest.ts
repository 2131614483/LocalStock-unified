import { app, ipcMain } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import Database from 'better-sqlite3'
import { getSetting } from './db'
import type {
  BacktestDataStatus,
  BacktestResult,
  BacktestTemplate,
  DownloadProgressMsg
} from '../shared/types'

/**
 * python 脚本目录：打包后在 `resources/python`，开发时在 `apps/desktop/python`。
 *
 * 开发模式下 `app.getAppPath()` 的取值随启动方式变化（electron-vite dev 指向项目根，
 * 而 `electron out/main/index.js` 可能指向 out/），因此按候选顺序探测，以标志文件为准。
 */
export function pythonDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'python')
  const candidates = [
    join(app.getAppPath(), 'python'),
    join(app.getAppPath(), '..', 'python'),
    // out/main/index.js -> apps/desktop
    join(__dirname, '..', '..', 'python'),
    join(process.cwd(), 'python')
  ]
  const looksRight = (dir: string): boolean =>
    existsSync(join(dir, 'engine', 'backtest_engine.py')) ||
    existsSync(join(dir, 'pa-agent', 'server.py'))
  for (const candidate of candidates) {
    try {
      if (looksRight(candidate)) return resolve(candidate)
    } catch {
      // 路径不可访问，继续下一个候选
    }
  }
  return candidates[0]
}

/** 行情库路径的来源（界面据此告诉用户"当前用的是哪一个"） */
export type MarketDbSource = 'setting' | 'env' | 'portable' | 'exe' | 'userData'

/** 设置表里存用户选定行情库路径的键 */
export const MARKET_DB_SETTING_KEY = 'marketDbPath'

/**
 * 解析行情库路径及其来源，优先级：
 *   1. 设置里的 `marketDbPath`（用户在界面里显式选定，最优先）
 *   2. 环境变量 `LOCALSTOCK_MARKET_DB`（工作区/开发脚本注入）
 *   3. 便携包同目录 `data/stock_data.db`（用户把数据放在软件旁）
 *   4. exe 同目录 `data/stock_data.db`
 *   5. `userData/stock_data.db`（兜底；打包版未配置时会是桌面端自建的空库）
 *
 * 注意：来源 1、2 即使文件不存在也照原样返回 —— 由界面提示"文件不存在"，
 * 而不是静默回退到空的用户目录库（否则迁移配置失效会很难查）。
 */
export function resolveMarketDb(): { path: string; source: MarketDbSource } {
  const configured = getSetting(MARKET_DB_SETTING_KEY)?.trim()
  if (configured) return { path: configured, source: 'setting' }

  const unifiedDb = process.env.LOCALSTOCK_MARKET_DB?.trim()
  // 环境变量是工作区迁移时注入的明确配置。即使文件暂时不存在，也必须保留该路径
  // 交给设置页报告；静默退回 userData 会把配置错误伪装成“程序自建的空库”。
  if (unifiedDb) return { path: unifiedDb, source: 'env' }

  // electron-builder portable 会把内部 exe 解压到临时目录；该变量才是用户双击的便携包所在目录。
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
  if (portableDir) {
    const portableDb = join(portableDir, 'data', 'stock_data.db')
    if (existsSync(portableDb)) return { path: portableDb, source: 'portable' }
  }

  const exeData = join(dirname(app.getPath('exe')), 'data', 'stock_data.db')
  if (existsSync(exeData)) return { path: exeData, source: 'exe' }

  return { path: join(app.getPath('userData'), 'stock_data.db'), source: 'userData' }
}

/** 当前生效的行情库路径 */
export function stockDataPath(): string {
  return resolveMarketDb().path
}

function pythonExe(): string {
  return getSetting('pythonPath') || 'python'
}

let downloading: ChildProcess | null = null

/** 行情库数据状态（exists/stocksCount/dailyRows/日期范围/版本），AI 工具与 IPC 复用 */
export function getDataStatus(): BacktestDataStatus {
  const db = stockDataPath()
  if (!existsSync(db)) return { exists: false }
  try {
    const conn = new Database(db, { readonly: true })
    const stocks = (conn.prepare('SELECT COUNT(*) AS c FROM stocks').get() as { c: number }).c
    const rows = (conn.prepare('SELECT COUNT(*) AS c FROM stock_daily').get() as { c: number }).c
    const range = conn.prepare(
      'SELECT MIN(trade_date) AS f, MAX(trade_date) AS t FROM stock_daily'
    ).get() as { f: string | null; t: string | null }
    // sync_meta：数据版本 + 最后同步时间（download_full_data.py 写入）。
    // 表可能缺失（旧数据包/未跑全量下载），此时降级：数据仍可用，仅无版本/同步时间，
    // 避免 getDataStatus 因一张元数据表而误报整个库"未就绪"。
    let metaMap: Record<string, string> = {}
    try {
      const meta = conn
        .prepare('SELECT key, value FROM sync_meta WHERE key IN (?, ?)')
        .all('db_version', 'last_full_sync') as Array<{ key: string; value: string }>
      for (const m of meta) metaMap[m.key] = m.value
    } catch {
      // 忽略：缺 sync_meta 表时返回存在但无版本/同步时间
    }
    conn.close()
    return {
      exists: true,
      stocksCount: stocks,
      dailyRows: rows,
      dateFrom: range.f,
      dateTo: range.t,
      dbVersion: metaMap['db_version'],
      lastSync: metaMap['last_full_sync']
    }
  } catch (err) {
    return { exists: false, error: String(err) }
  }
}

/** 策略模板列表，AI 工具与 IPC 复用 */
export function listStrategyTemplates(): BacktestTemplate[] {
  const dir = join(pythonDir(), 'scripts', 'templates')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.py'))
    .map((f) => ({
      name: f.replace(/\.py$/, ''),
      code: readFileSync(join(dir, f), 'utf-8')
    }))
}

/** 运行回测（引擎子进程，stdout 纯 JSON），AI 工具与 IPC 复用 */
export function runBacktest(args: {
  code: string
  startDate: string
  endDate: string
  capital: number
}): Promise<BacktestResult> {
  const engine = join(pythonDir(), 'engine', 'backtest_engine.py')
  if (!existsSync(engine)) {
    return Promise.resolve({ code: -1, error: `回测引擎不存在: ${engine}` })
  }
  return new Promise((resolve) => {
    execFile(
      pythonExe(),
      [
        engine,
        '--code',
        args.code,
        '--db',
        stockDataPath(),
        '--start',
        args.startDate,
        '--end',
        args.endDate,
        '--capital',
        String(args.capital)
      ],
      { maxBuffer: 50 * 1024 * 1024, timeout: 120_000, windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1' } },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            code: -1,
            error: String((err as Error).message || err),
            stderr: stderr ? stderr.slice(0, 2000) : ''
          })
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          resolve({
            code: -1,
            error: '回测输出解析失败：策略代码里的 print() 会破坏 JSON，请改用 log()',
            stderr: stderr ? stderr.slice(0, 2000) : '',
            raw: stdout.slice(0, 500)
          })
        }
      }
    )
  })
}

export function registerBacktestIpc(getWindow: () => Electron.BrowserWindow | null): void {
  // 数据状态
  ipcMain.handle('backtest:getDataStatus', () => getDataStatus())

  // 启动全量数据下载（子进程，stdout 逐行解析 JSONL 进度 → 推送）
  ipcMain.handle('backtest:downloadData', () => {
    if (downloading) return { started: false, reason: 'already-running' }
    const script = join(pythonDir(), 'scripts', 'download_full_data.py')
    if (!existsSync(script)) {
      return { started: false, reason: `脚本不存在: ${script}` }
    }
    const win = getWindow()
    const sendProgress = (msg: DownloadProgressMsg): void => {
      if (win && !win.isDestroyed()) win.webContents.send('backtest:downloadProgress', msg)
    }
    // PYTHONUTF8=1：强制子进程 stdout/stderr 以 UTF-8 输出。
    // Windows 下管道默认走 GBK（locale），按 UTF-8 解码会乱码。
    const child = spawn(pythonExe(), [script, '--db', stockDataPath()], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1' }
    })
    downloading = child
    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf-8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t) continue
        try {
          const msg = JSON.parse(t)
          sendProgress(msg)
        } catch {
          // 非 JSON 行忽略（baostock 自身日志）
        }
      }
    })
    child.on('close', (code) => {
      downloading = null
      sendProgress({ type: 'exit', code: code ?? -1 })
    })
    child.on('error', (err) => {
      downloading = null
      sendProgress({
        type: 'error',
        message: `无法启动下载：${err.message}（请确认已安装 Python 和 baostock）`
      })
    })
    return { started: true }
  })

  // 运行回测（引擎子进程，stdout 纯 JSON）
  ipcMain.handle(
    'backtest:run',
    (
      _e,
      args: { code: string; startDate: string; endDate: string; capital: number }
    ) => runBacktest(args)
  )

  // 策略模板列表
  ipcMain.handle('backtest:listTemplates', () => listStrategyTemplates())
}
