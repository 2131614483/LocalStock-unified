import { BrowserWindow } from 'electron'
import { join } from 'path'
import { loadWindowState, trackWindowState } from '../window-state'

/**
 * 独立监盘窗口（单例）：再次打开时聚焦/复用已有窗口，不重复创建。
 */
let monitorWin: BrowserWindow | null = null

export function getMonitorWindow(): BrowserWindow | null {
  return monitorWin && !monitorWin.isDestroyed() ? monitorWin : null
}

export function openMonitorWindow(): BrowserWindow {
  const existing = getMonitorWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }
  const saved = loadWindowState('monitor', { defaultWidth: 940, defaultHeight: 640, minWidth: 720, minHeight: 420 })
  monitorWin = new BrowserWindow({
    width: saved?.width ?? 940,
    height: saved?.height ?? 640,
    x: saved?.x,
    y: saved?.y,
    resizable: true,
    minWidth: 720,
    minHeight: 420,
    backgroundColor: '#0d0e10',
    autoHideMenuBar: true,
    show: false,
    title: '实时监盘 · LocalStock',
    // 深色标题栏：hidden + 自绘控制按钮（测试需先 focus 窗口，见 main.ts 注）
    titleBarStyle: 'hidden',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  trackWindowState(monitorWin, 'monitor')
  monitorWin.on('ready-to-show', () => monitorWin?.show())
  monitorWin.on('closed', () => {
    monitorWin = null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void monitorWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}/monitor.html`)
  } else {
    void monitorWin.loadFile(join(__dirname, '../renderer/monitor.html'))
  }
  return monitorWin
}

export function closeMonitorWindow(): void {
  if (monitorWin && !monitorWin.isDestroyed()) monitorWin.close()
}
