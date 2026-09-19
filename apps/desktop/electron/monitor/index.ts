import { ipcMain } from 'electron'
import type { MonitorConfig, MonitorEvent, MonitorPredictionStats, MonitorQuote } from '../../shared/types'
import {
  addMonitored,
  getMonitorConfig,
  getPredictionStats,
  getPredictionStatsByHour,
  getPredictionStatsByStock,
  removeMonitored,
  saveMonitorConfig,
  seedMonitorList
} from './store'
import { MonitorScheduler, buildMonitorState } from './scheduler'
import { getMonitorWindow, openMonitorWindow } from './window'
/**
 * 实时监盘：IPC + 调度器（单例）。开启后按间隔拉实时价 → 入库 → 预警 → 推送监盘窗口 → AI 预测。
 */
const scheduler = new MonitorScheduler({
  quotes: (stocks: MonitorQuote[]) => {
    sendToMonitor('monitor:quotes', stocks)
  },
  events: (ev: MonitorEvent) => {
    sendToMonitor('monitor:event', ev)
  },
  config: (cfg: MonitorConfig) => {
    sendToMonitor('monitor:config', cfg)
  },
  stats: (s: MonitorPredictionStats) => {
    sendToMonitor('monitor:stats', s)
  }
})

function sendToMonitor(channel: string, payload: unknown): void {
  const win = getMonitorWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function startMonitor(): void {
  seedMonitorList()
  scheduler.start(getMonitorConfig())
}

export function stopMonitor(): void {
  scheduler.stop()
}

export function registerMonitorIpc(): void {
  seedMonitorList()

  ipcMain.handle('monitor:getState', () => buildMonitorState())

  ipcMain.handle('monitor:setConfig', (_e, patch: Partial<MonitorConfig>) => {
    const cfg = saveMonitorConfig(patch)
    scheduler.pushConfig(cfg)
    scheduler.start(cfg) // 重启定时（含关闭时停止）
    return cfg
  })

  ipcMain.handle('monitor:addStock', (_e, item: { secid: string; code: string; name: string }) => {
    addMonitored(item)
    return { ok: true }
  })

  ipcMain.handle('monitor:removeStock', (_e, secid: string) => {
    removeMonitored(secid)
    return { ok: true }
  })

  ipcMain.handle('monitor:openWindow', () => {
    openMonitorWindow()
    // 打开后立即触发一次采集，让窗口马上有数据
    void scheduler.tick(getMonitorConfig())
    return { ok: true }
  })

  ipcMain.handle('monitor:setPinned', (_e, v: boolean) => {
    getMonitorWindow()?.setAlwaysOnTop(!!v)
    return { ok: true }
  })

  ipcMain.handle('monitor:setOpacity', (_e, v: number) => {
    const o = Math.max(0.3, Math.min(1, Number(v) || 1))
    getMonitorWindow()?.setOpacity(o)
    return { ok: true }
  })

  ipcMain.handle('monitor:setLarge', (_e, v: boolean) => {
    const win = getMonitorWindow()
    if (!win) return { ok: false }
    if (v) {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.maximize()
    } else {
      win.unmaximize()
      win.setAlwaysOnTop(false)
    }
    return { ok: true }
  })

  ipcMain.handle('monitor:getPredictionStats', () => getPredictionStats())
  ipcMain.handle('monitor:getPredictionStatsByStock', () => getPredictionStatsByStock())
  ipcMain.handle('monitor:getPredictionStatsByHour', () => getPredictionStatsByHour())
}
