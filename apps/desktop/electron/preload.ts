import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { WindowApi } from '../shared/types'

/**
 * 全局 UI 缩放（在 preload 做：webFrame 属于 electron 模块，渲染层 ESM bundle
 * 直接 import 'electron' 会把整个 electron 包拖进 bundle 导致 __dirname 崩溃）。
 * Ctrl+滚轮 / Ctrl+= / Ctrl+- 缩放，Ctrl+0 复位；zoomFactor 存 settings['ui.zoom']。
 */
function setupZoom(): void {
  const KEY = 'ui.zoom'
  const MIN = 0.7
  const MAX = 2.0
  const STEP = 0.1
  const clamp = (v: number): number => Math.max(MIN, Math.min(MAX, Math.round(v * 100) / 100))
  const apply = (v: number): void => {
    webFrame.setZoomFactor(clamp(v))
  }

  void ipcRenderer.invoke('settings:get', KEY).then((v) => {
    const n = Number(v)
    if (Number.isFinite(n) && n >= MIN && n <= MAX) apply(n)
  })

  const zoomBy = (delta: number): void => {
    const next = clamp(webFrame.getZoomFactor() + delta)
    apply(next)
    void ipcRenderer.invoke('settings:set', KEY, String(next))
  }

  // preload 运行在带 DOM 的渲染进程上下文（sandbox:false），window/DOM 事件可用。
  // tsconfig.node 无 DOM lib，用全局 this 上的 window（preload 里 window 即全局对象）。
  const g = globalThis as unknown as {
    addEventListener(
      type: string,
      fn: (e: { ctrlKey: boolean; deltaY: number; key: string; preventDefault(): void }) => void,
      opts?: { passive?: boolean; capture?: boolean }
    ): void
  }
  g.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? STEP : -STEP)
    },
    { passive: false }
  )
  g.addEventListener(
    'keydown',
    (e) => {
      if (!e.ctrlKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomBy(STEP)
      } else if (e.key === '-') {
        e.preventDefault()
        zoomBy(-STEP)
      } else if (e.key === '0') {
        e.preventDefault()
        apply(1)
        void ipcRenderer.invoke('settings:set', KEY, '1')
      }
    },
    { capture: true }
  )
}

setupZoom()

const api: WindowApi = {
  market: {
    getQuotes: (secids) => ipcRenderer.invoke('market:getQuotes', secids),
    getMarketList: (params) => ipcRenderer.invoke('market:getMarketList', params),
    getKline: (secid, klt, fqt) => ipcRenderer.invoke('market:getKline', secid, klt, fqt),
    getMinute: (secid, days) => ipcRenderer.invoke('market:getMinute', secid, days),
    getOrderBook: (secid) => ipcRenderer.invoke('market:getOrderBook', secid),
    search: (keyword) => ipcRenderer.invoke('market:search', keyword),
    subscribe: (secids, interval) => ipcRenderer.invoke('market:subscribe', secids, interval),
    onQuotes: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, quotes: Parameters<typeof cb>[0]) =>
        cb(quotes)
      ipcRenderer.on('market:quotes', listener)
      return () => ipcRenderer.removeListener('market:quotes', listener)
    }
  },
  news: {
    list: (secid, name, limit) => ipcRenderer.invoke('news:list', secid, name, limit),
    range: (secid, name, start, end) => ipcRenderer.invoke('news:range', secid, name, start, end),
    analyze: (secid, name, start, end, items) => ipcRenderer.invoke('news:analyze', secid, name, start, end, items)
  },
  watchlist: {
    list: () => ipcRenderer.invoke('watchlist:list'),
    add: (item) => ipcRenderer.invoke('watchlist:add', item),
    remove: (secid) => ipcRenderer.invoke('watchlist:remove', secid),
    reorder: (secids) => ipcRenderer.invoke('watchlist:reorder', secids)
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },
  quant: {
    getConfig: () => ipcRenderer.invoke('quant:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('quant:setConfig', cfg),
    testConnection: (refresh) => ipcRenderer.invoke('quant:testConnection', refresh)
  },
  marketDb: {
    getInfo: () => ipcRenderer.invoke('market:getDbInfo'),
    inspect: (path) => ipcRenderer.invoke('market:inspectDb', path),
    pick: () => ipcRenderer.invoke('market:pickDb'),
    setPath: (path) => ipcRenderer.invoke('market:setDbPath', path),
    reset: () => ipcRenderer.invoke('market:resetDbPath')
  },
  pa: {
    getConfig: () => ipcRenderer.invoke('pa:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('pa:setConfig', cfg),
    getServerStatus: () => ipcRenderer.invoke('pa:getServerStatus'),
    restartServer: () => ipcRenderer.invoke('pa:restartServer'),
    installDeps: () => ipcRenderer.invoke('pa:installDeps'),
    onDepsProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, evt: Parameters<typeof cb>[0]) => cb(evt)
      ipcRenderer.on('pa:depsProgress', listener)
      return () => ipcRenderer.removeListener('pa:depsProgress', listener)
    },
    onServerStatus: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, status: Parameters<typeof cb>[0]) =>
        cb(status)
      ipcRenderer.on('pa:serverStatus', listener)
      // 告诉主进程本窗口需要状态推送（主进程按 webContents 订阅）
      void ipcRenderer.invoke('pa:subscribeServerStatus', true)
      return () => {
        ipcRenderer.removeListener('pa:serverStatus', listener)
        void ipcRenderer.invoke('pa:subscribeServerStatus', false)
      }
    },
    testConnection: () => ipcRenderer.invoke('pa:testConnection'),
    searchSymbols: (keyword, limit) => ipcRenderer.invoke('pa:searchSymbols', keyword, limit),
    getKline: (symbol, timeframe, bars) =>
      ipcRenderer.invoke('pa:getKline', symbol, timeframe, bars),
    exportOffline: (req) => ipcRenderer.invoke('pa:exportOffline', req),
    readClipboardText: () => ipcRenderer.invoke('pa:readClipboardText'),
    pickImportText: () => ipcRenderer.invoke('pa:pickImportText'),
    pickOfflinePack: () => ipcRenderer.invoke('pa:pickOfflinePack'),
    latestOfflinePack: () => ipcRenderer.invoke('pa:latestOfflinePack'),
    archiveImportedRecord: (record) => ipcRenderer.invoke('pa:archiveImportedRecord', record),
    listKnowledgeLibraries: () => ipcRenderer.invoke('pa:listKnowledgeLibraries'),
    analyze: (req) => ipcRenderer.invoke('pa:analyze', req),
    cancel: () => ipcRenderer.invoke('pa:cancel'),
    onEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, evt: Parameters<typeof cb>[0]) => cb(evt)
      ipcRenderer.on('pa:event', listener)
      return () => ipcRenderer.removeListener('pa:event', listener)
    }
  },
  backtest: {
    getDataStatus: () => ipcRenderer.invoke('backtest:getDataStatus'),
    downloadData: () => ipcRenderer.invoke('backtest:downloadData'),
    onDownloadProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, msg: Parameters<typeof cb>[0]) =>
        cb(msg)
      ipcRenderer.on('backtest:downloadProgress', listener)
      return () => ipcRenderer.removeListener('backtest:downloadProgress', listener)
    },
    run: (args) => ipcRenderer.invoke('backtest:run', args),
    listTemplates: () => ipcRenderer.invoke('backtest:listTemplates')
  },
  drawings: {
    get: (secid) => ipcRenderer.invoke('drawings:get', secid),
    save: (secid, drawings) => ipcRenderer.invoke('drawings:save', secid, drawings),
    restore: (secid, version) => ipcRenderer.invoke('drawings:restore', secid, version),
    clear: (secid) => ipcRenderer.invoke('drawings:clear', secid),
    runAlgo: (secid, code, kline) => ipcRenderer.invoke('drawings:runAlgo', secid, code, kline),
    aiCode: (intent, oldCode, kline) =>
      ipcRenderer.invoke('drawing:aiCode', intent, oldCode, kline)
  },
  alerts: {
    list: () => ipcRenderer.invoke('alerts:list'),
    add: (rule) => ipcRenderer.invoke('alerts:add', rule),
    remove: (id) => ipcRenderer.invoke('alerts:remove', id),
    toggle: (id, enabled) => ipcRenderer.invoke('alerts:toggle', id, enabled),
    scanNow: () => ipcRenderer.invoke('alerts:scanNow')
  },
  ai: {
    send: (text, ctx) => ipcRenderer.invoke('ai:send', text, ctx),
    reset: () => ipcRenderer.invoke('ai:reset'),
    cancel: () => ipcRenderer.invoke('ai:cancel'),
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('ai:setConfig', cfg),
    getAudit: () => ipcRenderer.invoke('ai:getAudit'),
    rollback: (auditId) => ipcRenderer.invoke('ai:rollback', auditId),
    onChunk: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, chunk: string) => cb(chunk)
      ipcRenderer.on('ai:chunk', listener)
      return () => ipcRenderer.removeListener('ai:chunk', listener)
    },
    onTool: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, call: Parameters<typeof cb>[0]) =>
        cb(call)
      ipcRenderer.on('ai:tool', listener)
      return () => ipcRenderer.removeListener('ai:tool', listener)
    },
    onRefresh: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('ai:refresh', listener)
      return () => ipcRenderer.removeListener('ai:refresh', listener)
    },
    onDone: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('ai:done', listener)
      return () => ipcRenderer.removeListener('ai:done', listener)
    },
    onError: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, err: string) => cb(err)
      ipcRenderer.on('ai:error', listener)
      return () => ipcRenderer.removeListener('ai:error', listener)
    }
  },
  selection: {
    listRules: () => ipcRenderer.invoke('selection:listRules'),
    saveRule: (rule) => ipcRenderer.invoke('selection:saveRule', rule),
    deleteRule: (id) => ipcRenderer.invoke('selection:deleteRule', id),
    runScan: (rule) => ipcRenderer.invoke('selection:runScan', rule),
    getResults: () => ipcRenderer.invoke('selection:getResults'),
    onProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]) =>
        cb(p)
      ipcRenderer.on('selection:progress', listener)
      return () => ipcRenderer.removeListener('selection:progress', listener)
    }
  },
  monitor: {
    getState: () => ipcRenderer.invoke('monitor:getState'),
    setConfig: (cfg) => ipcRenderer.invoke('monitor:setConfig', cfg),
    addStock: (item) => ipcRenderer.invoke('monitor:addStock', item),
    removeStock: (secid) => ipcRenderer.invoke('monitor:removeStock', secid),
    openWindow: () => ipcRenderer.invoke('monitor:openWindow'),
    setPinned: (v) => ipcRenderer.invoke('monitor:setPinned', v),
    setOpacity: (v) => ipcRenderer.invoke('monitor:setOpacity', v),
    setLarge: (v) => ipcRenderer.invoke('monitor:setLarge', v),
    getPredictionStats: () => ipcRenderer.invoke('monitor:getPredictionStats'),
    getPredictionStatsByStock: () => ipcRenderer.invoke('monitor:getPredictionStatsByStock'),
    getPredictionStatsByHour: () => ipcRenderer.invoke('monitor:getPredictionStatsByHour'),
    onQuotes: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, stocks: Parameters<typeof cb>[0]) =>
        cb(stocks)
      ipcRenderer.on('monitor:quotes', listener)
      return () => ipcRenderer.removeListener('monitor:quotes', listener)
    },
    onEvents: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: Parameters<typeof cb>[0]) => cb(ev)
      ipcRenderer.on('monitor:event', listener)
      return () => ipcRenderer.removeListener('monitor:event', listener)
    },
    onConfig: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, cfg: Parameters<typeof cb>[0]) => cb(cfg)
      ipcRenderer.on('monitor:config', listener)
      return () => ipcRenderer.removeListener('monitor:config', listener)
    },
    onStats: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, s: Parameters<typeof cb>[0]) => cb(s)
      ipcRenderer.on('monitor:stats', listener)
      return () => ipcRenderer.removeListener('monitor:stats', listener)
    }
  },
  minute: {
    analyze: (secid, intent, minute) => ipcRenderer.invoke('minute:analyze', secid, intent, minute),
    get: (secid) => ipcRenderer.invoke('minute:get', secid),
    clear: (secid) => ipcRenderer.invoke('minute:clear', secid),
    onAnnotations: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]) => cb(p)
      ipcRenderer.on('minute:annotations', listener)
      return () => ipcRenderer.removeListener('minute:annotations', listener)
    }
  },
  float: {
    open: (view, params) => ipcRenderer.invoke('float:open', view, params),
    toggle: (view) => ipcRenderer.invoke('float:toggle', view),
    close: (view) => ipcRenderer.invoke('float:close', view),
    getAll: () => ipcRenderer.invoke('float:getAll'),
    onChanged: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('float:changed', listener)
      return () => ipcRenderer.removeListener('float:changed', listener)
    }
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
    close: () => ipcRenderer.invoke('win:close')
  }
}

export {}

contextBridge.exposeInMainWorld('api', api)
