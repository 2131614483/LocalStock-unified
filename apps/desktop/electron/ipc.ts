import { BrowserWindow, ipcMain } from 'electron'
import { getMarketList, searchStocks } from './market/eastmoney'
import { getOrderBook } from './market/tencent'
import { getQuotesSafe } from './market/quotes'
import { getLocalMarketListAsync } from './market/sqlite-worker-client'
import { resolveKline } from './market/kline-resolver'
import { resolveMinute } from './market/minute-resolver'
import { setDbPath } from './market/db-path'
import { stockDataPath } from './backtest'
import {
  listWatchlist,
  addWatchlist,
  removeWatchlist,
  reorderWatchlist,
  getSetting,
  setSetting
} from './db'

let timer: NodeJS.Timeout | null = null
let currentInterval = 3000
/** 各窗口订阅的 secid 贡献（webContents.id → Set），并集后广播给所有窗口（主窗+浮窗） */
const subContrib = new Map<number, Set<string>>()

function unionSecids(): string[] {
  const set = new Set<string>()
  for (const s of subContrib.values()) for (const x of s) set.add(x)
  return [...set]
}

async function pushQuotesBroadcast(): Promise<void> {
  const secids = unionSecids()
  if (secids.length === 0) return
  try {
    const quotes = await getQuotesSafe(secids)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('market:quotes', quotes)
    }
  } catch (err) {
    console.error('[pushQuotes]', err)
  }
}

function subscribeMarket(
  event: Electron.IpcMainInvokeEvent,
  secids: string[],
  interval: number
): void {
  const id = event.sender.id
  subContrib.set(id, new Set(secids))
  event.sender.once('destroyed', () => {
    subContrib.delete(id)
  })
  if (interval > 0) currentInterval = interval
  if (timer) clearInterval(timer)
  timer = setInterval(() => void pushQuotesBroadcast(), currentInterval)
  void pushQuotesBroadcast()
}

export function stopQuotePolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  subContrib.clear()
}

/** IPC 耗时审计：>100ms 的 handler 打印日志，用于定位主进程阻塞点（同步 SQLite 等） */
function auditedHandle(channel: string, handler: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const t0 = Date.now()
    try {
      return await handler(event, ...args)
    } finally {
      const ms = Date.now() - t0
      if (ms > 100) console.log(`[IPC-SLOW] ${channel}: ${ms}ms`)
    }
  })
}

export function registerIpc(getWindow: () => Electron.BrowserWindow | null): void {
  // 主进程注入行情库路径（worker 与查询模块共用；worker 内不访问 electron）
  setDbPath(stockDataPath())
  auditedHandle('market:getQuotes', (_e, secids: string[]) => getQuotesSafe(secids))
  auditedHandle(
    'market:getMarketList',
    async (_e, params: Parameters<typeof getMarketList>[0]) => {
      // 优先本地行情库生成列表（worker 线程执行，不阻塞主进程）
      const local = await getLocalMarketListAsync(params)
      if (local) return local
      return getMarketList(params)
    }
  )
  auditedHandle('market:getKline', (_e, secid: string, klt: number, fqt: number) =>
    resolveKline(secid, klt, fqt)
  )
  auditedHandle('market:getMinute', (_e, secid: string, days = 1) =>
    resolveMinute(secid, days)
  )
  auditedHandle('market:getOrderBook', (_e, secid: string) => getOrderBook(secid))
  ipcMain.handle('market:search', (_e, keyword: string) => searchStocks(keyword))
  ipcMain.handle('market:subscribe', (e, secids: string[], interval: number) => {
    subscribeMarket(e, secids, interval)
    return { ok: true }
  })

  ipcMain.handle('watchlist:list', () => listWatchlist())
  ipcMain.handle('watchlist:add', (_e, item: { secid: string; code: string; name: string }) =>
    addWatchlist(item)
  )
  ipcMain.handle('watchlist:remove', (_e, secid: string) => removeWatchlist(secid))
  ipcMain.handle('watchlist:reorder', (_e, secids: string[]) => reorderWatchlist(secids))

  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => setSetting(key, value))

  // 窗口控制（自绘标题栏按钮用）：作用于发送事件的窗口本身（主窗/浮窗/监盘窗通用）
  ipcMain.handle('win:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.handle('win:maximizeToggle', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('win:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}
