/**
 * 行情库位置：查询、选定与即时生效。
 *
 * 设计取舍：软件主体与数据库分开存放时，用户需要在设置里指到自己的库。
 * 校验信息刻意做得**便宜** —— 不对 stock_daily（千万级）做 COUNT(*)，
 * 改看表是否存在、stocks 行数（几千）与 trade_calendar 的日期范围（几千），
 * 否则打开设置页就要卡几十秒。
 */
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { existsSync, statSync } from 'node:fs'
import Database from 'better-sqlite3'
import { getSetting, setSetting } from '../db'
import { MARKET_DB_SETTING_KEY, resolveMarketDb, stockDataPath } from '../backtest'
import { setDbPath } from './db-path'
import { resetMarketDbWorker } from './sqlite-worker-client'

/** 判定"这是不是一个可用的行情库"所需的最少表 */
const REQUIRED_TABLES = ['stocks', 'stock_daily', 'trade_calendar'] as const

export interface MarketDbInfo {
  /** 当前生效路径 */
  path: string
  /** 路径来源 */
  source: 'setting' | 'env' | 'portable' | 'exe' | 'userData'
  /** 是否来自用户在设置里的显式选定 */
  configured: boolean
  exists: boolean
  /** 库结构是否完整（含必需表） */
  valid: boolean
  sizeMb?: number
  stocksCount?: number
  dateFrom?: string | null
  dateTo?: string | null
  /** 不可用时的可操作说明 */
  error?: string
  /** 用户选定后若文件不存在，提示但保留其选择 */
  missingConfigured?: boolean
}

/** 来源 → 界面可读文案 */
export const SOURCE_LABEL: Record<MarketDbInfo['source'], string> = {
  setting: '设置中指定',
  env: '环境变量 LOCALSTOCK_MARKET_DB',
  portable: '便携包同目录 data/',
  exe: '程序同目录 data/',
  userData: '用户数据目录（默认，通常是空库）'
}

/** SQLite 的底层报错 → 可操作的中文提示（不要把 "file is not a database" 原样丢给用户） */
function friendlyOpenError(error: unknown, path: string): string {
  const text = error instanceof Error ? error.message : String(error)
  const lower = text.toLowerCase()
  if (lower.includes('not a database') || lower.includes('encrypted')) {
    return (
      `该文件不是 SQLite 数据库（或已加密）：${path}。` +
      '请确认选的是 LocalStock 的 stock_data.db，而不是它的 -wal/-shm 附属文件、压缩包或其它程序的数据文件。'
    )
  }
  if (lower.includes('malformed')) {
    return `数据库文件已损坏：${path}，请从同步源重新生成。`
  }
  if (lower.includes('unable to open') || lower.includes('eperm') || lower.includes('ebusy')) {
    return `无法打开：${path}（文件不存在、被占用或没有访问权限）。`
  }
  return text
}

/** 检查一个具体的库文件；不抛错，把问题写在返回值里 */
export function inspectMarketDb(path: string): MarketDbInfo {
  const base: MarketDbInfo = {
    path,
    source: resolveMarketDb().source,
    configured: Boolean(getSetting(MARKET_DB_SETTING_KEY)?.trim()),
    exists: false,
    valid: false
  }

  if (!existsSync(path)) {
    base.error = '文件不存在'
    return base
  }
  base.exists = true
  try {
    base.sizeMb = Math.round((statSync(path).size / 1024 / 1024) * 10) / 10
  } catch {
    // 体积拿不到不影响其它判断
  }

  let conn: Database.Database | null = null
  try {
    conn = new Database(path, { readonly: true, fileMustExist: true })
    const present = new Set(
      (
        conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string
        }[]
      ).map((r) => r.name)
    )
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t))
    if (missing.length) {
      base.valid = false
      base.error =
        `缺少数据表：${missing.join('、')}。` +
        '这通常不是 LocalStock 的行情库（可能是本程序在用户数据目录下自动建的空库）。'
      return base
    }

    base.stocksCount = (
      conn.prepare('SELECT COUNT(*) AS c FROM stocks').get() as { c: number }
    ).c

    // 日期范围用交易日历取（几千行，毫秒级）；stock_daily 是千万级，不做 COUNT
    const range = conn
      .prepare('SELECT MIN(trade_date) AS f, MAX(trade_date) AS t FROM trade_calendar')
      .get() as { f: string | null; t: string | null }
    base.dateFrom = range?.f ?? null
    base.dateTo = range?.t ?? null

    base.valid = true
    return base
  } catch (error) {
    base.error = friendlyOpenError(error, path)
    return base
  } finally {
    try {
      conn?.close()
    } catch {
      // 关闭失败不影响结果
    }
  }
}

/** 当前生效行情库的信息 */
export function getMarketDbInfo(): MarketDbInfo {
  const { path, source } = resolveMarketDb()
  const info = inspectMarketDb(path)
  info.source = source
  // 显式选定的文件却不存在：给出提示（不要静默回退）
  if (source === 'setting' && !info.exists) info.missingConfigured = true
  return info
}

/** 让新路径**立即生效**：主进程注入值、只读查询 worker、价格行为服务一并切换 */
export async function applyMarketDbPath(): Promise<MarketDbInfo> {
  setDbPath(stockDataPath())
  resetMarketDbWorker()
  // pa-agent 启动时以 LOCALSTOCK_MARKET_DB 取库路径，需重启才会用新库
  try {
    const { restartPaServer } = await import('../pa/server')
    await restartPaServer()
  } catch (error) {
    console.warn('[market-db] 重启价格行为服务失败（不影响行情库切换）:', error)
  }
  return getMarketDbInfo()
}

/** 弹系统文件选择框挑行情库；返回 null 表示用户取消 */
export async function pickMarketDbFile(
  parent: BrowserWindow | null
): Promise<{ path: string; info: MarketDbInfo } | null> {
  const current = stockDataPath()
  const result = parent
    ? await dialog.showOpenDialog(parent, {
        title: '选择行情库文件（stock_data.db）',
        defaultPath: existsSync(current) ? current : app.getPath('documents'),
        properties: ['openFile'],
        filters: [
          { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: '全部文件', extensions: ['*'] }
        ]
      })
    : await dialog.showOpenDialog({
        title: '选择行情库文件（stock_data.db）',
        properties: ['openFile'],
        filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }]
      })

  if (result.canceled || !result.filePaths.length) return null
  const path = result.filePaths[0]
  return { path, info: inspectMarketDb(path) }
}

/** 保存用户选定的路径；传 null/空串表示恢复默认解析顺序 */
export async function saveMarketDbPath(path: string | null): Promise<MarketDbInfo> {
  const trimmed = (path ?? '').trim()
  if (trimmed) {
    if (!existsSync(trimmed)) throw new Error(`文件不存在：${trimmed}`)
    setSetting(MARKET_DB_SETTING_KEY, trimmed)
  } else {
    setSetting(MARKET_DB_SETTING_KEY, '')
  }
  return applyMarketDbPath()
}

export function registerMarketDbIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('market:getDbInfo', () => getMarketDbInfo())

  // 手工输入路径时先校验再保存
  ipcMain.handle('market:inspectDb', (_e, path: string) => {
    const trimmed = (path ?? '').trim()
    if (!trimmed) return getMarketDbInfo()
    const info = inspectMarketDb(trimmed)
    info.configured = true
    info.source = 'setting'
    return info
  })

  ipcMain.handle('market:pickDb', () => pickMarketDbFile(getWindow()))

  ipcMain.handle('market:setDbPath', (_e, path: string | null) => saveMarketDbPath(path))

  ipcMain.handle('market:resetDbPath', () => saveMarketDbPath(null))
}
