import { BrowserWindow } from 'electron'
import { join } from 'path'
import type { FloatViewId, FloatViewParams } from '../shared/types'
import { openMonitorWindow, getMonitorWindow } from './monitor/window'
import { loadWindowState, trackWindowState } from './window-state'

/**
 * 视图浮窗管理器：每个视图（自选/沪深/回测/预警/选股/AI/详情/监盘）可拆成独立系统窗口，
 * 自由缩放/移动/隐藏（OS 窗口天然支持），工具栏「窗口」菜单统一管理。
 */

export const FLOAT_VIEWS: Array<{ view: FloatViewId; label: string }> = [
  { view: 'watchlist', label: '自选股' },
  { view: 'market', label: '沪深A股' },
  { view: 'backtest', label: '回测' },
  { view: 'alerts', label: '预警' },
  { view: 'selection', label: '选股' },
  { view: 'ai', label: 'AI 助手' },
  { view: 'monitor', label: '实时监盘' },
  { view: 'settings', label: '设置' }
]

const VIEW_TITLE: Record<FloatViewId, string> = {
  watchlist: '自选股',
  market: '沪深A股',
  detail: '个股详情',
  backtest: '回测',
  alerts: '预警',
  selection: '选股',
  ai: 'AI 助手',
  monitor: '实时监盘',
  settings: '设置'
}

const VIEW_SIZE: Record<FloatViewId, { width: number; height: number }> = {
  watchlist: { width: 720, height: 560 },
  market: { width: 840, height: 620 },
  detail: { width: 1080, height: 720 },
  backtest: { width: 980, height: 700 },
  alerts: { width: 620, height: 520 },
  selection: { width: 980, height: 700 },
  ai: { width: 620, height: 720 },
  monitor: { width: 940, height: 640 },
  settings: { width: 720, height: 700 }
}

const floats = new Map<FloatViewId, BrowserWindow>()
const floatParams = new Map<FloatViewId, FloatViewParams>()
let onChange: (() => void) | null = null

export function setFloatChangeNotifier(fn: (() => void) | null): void {
  onChange = fn
}

function emitChange(): void {
  onChange?.()
}

export function getFloat(view: FloatViewId): BrowserWindow | null {
  const w = floats.get(view)
  return w && !w.isDestroyed() ? w : null
}

export function getFloatParams(view: FloatViewId): FloatViewParams | undefined {
  return floatParams.get(view)
}

export function isFloatVisible(view: FloatViewId): boolean {
  if (view === 'monitor') return !!getMonitorWindow()
  const w = getFloat(view)
  return !!w && w.isVisible()
}

export function getAllFloatStates(): Array<{ view: FloatViewId; visible: boolean }> {
  return [...FLOAT_VIEWS.map((f) => f.view), 'detail'].map((view) => ({
    view: view as FloatViewId,
    visible: isFloatVisible(view as FloatViewId)
  }))
}

export function openFloat(
  view: FloatViewId,
  params?: FloatViewParams,
  emit = true
): BrowserWindow {
  if (view === 'monitor') {
    const w = openMonitorWindow()
    if (emit) emitChange()
    return w
  }
  const existing = getFloat(view)
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    if (emit) emitChange()
    return existing
  }
  const size = VIEW_SIZE[view]
  // 每视图记忆上次尺寸/位置（key: float.<view>）
  const saved = loadWindowState(`float.${view}`, {
    defaultWidth: size.width,
    defaultHeight: size.height,
    minWidth: 320,
    minHeight: 240
  })
  const win = new BrowserWindow({
    width: saved?.width ?? size.width,
    height: saved?.height ?? size.height,
    x: saved?.x,
    y: saved?.y,
    resizable: true,
    minWidth: 320,
    minHeight: 240,
    backgroundColor: '#0d0e10',
    autoHideMenuBar: true,
    show: false,
    title: `${VIEW_TITLE[view]} · LocalStock`,
    // 深色标题栏：hidden + 自绘控制按钮（测试需先 focus 窗口，见 main.ts 注）
    titleBarStyle: 'hidden',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  trackWindowState(win, `float.${view}`)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    floats.delete(view)
    floatParams.delete(view)
    if (emit) emitChange()
  })
  floats.set(view, win)
  if (params) floatParams.set(view, params)
  const query: Record<string, string> = { view }
  if (params?.secid) query.secid = params.secid
  if (params?.name) query.name = params.name
  if (process.env.ELECTRON_RENDERER_URL) {
    const q = new URLSearchParams(query)
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/float.html?${q.toString()}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/float.html'), { query })
  }
  if (emit) emitChange()
  return win
}

export function toggleFloat(view: FloatViewId, emit = true): void {
  if (view === 'monitor') {
    const w = getMonitorWindow()
    if (w && !w.isDestroyed()) {
      if (w.isVisible()) w.hide()
      else {
        w.show()
        w.focus()
      }
    } else {
      openMonitorWindow()
    }
    if (emit) emitChange()
    return
  }
  const w = getFloat(view)
  if (!w) {
    openFloat(view, undefined, emit)
    return
  }
  if (w.isVisible()) w.hide()
  else {
    w.show()
    w.focus()
  }
  if (emit) emitChange()
}

export function closeFloat(view: FloatViewId, emit = true): void {
  if (view === 'monitor') {
    const w = getMonitorWindow()
    if (w && !w.isDestroyed()) w.close()
    if (emit) emitChange()
    return
  }
  const w = getFloat(view)
  if (w) w.close()
  if (emit) emitChange()
}

/** 关闭全部浮窗 + 监盘窗（主窗关闭时调用，避免残留进程） */
export function closeAllFloats(): void {
  for (const w of floats.values()) {
    if (!w.isDestroyed()) w.close()
  }
  const m = getMonitorWindow()
  if (m && !m.isDestroyed()) m.close()
}
