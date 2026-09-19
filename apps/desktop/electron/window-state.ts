import { app, screen, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

/**
 * 窗口尺寸/位置记忆：bounds 存 userData/window-state.json，关闭时保存、创建时恢复。
 * 恢复前校验 bounds 与某显示器有交集，防止拔掉显示器后窗口出现在屏幕外不可见。
 */

interface Bounds {
  x: number
  y: number
  width: number
  height: number
  maximized?: boolean
}

const FILE = 'window-state.json'
const cache = new Map<string, Bounds>()
let dirty = false

function fileOf(): string {
  return join(app.getPath('userData'), FILE)
}

function loadAll(): void {
  if (cache.size) return
  try {
    const raw = JSON.parse(readFileSync(fileOf(), 'utf-8')) as Record<string, Bounds>
    for (const [k, v] of Object.entries(raw)) cache.set(k, v)
  } catch {
    // 首次运行/文件损坏：从空开始
  }
}

function flush(): void {
  if (!dirty) return
  try {
    mkdirSync(dirname(fileOf()), { recursive: true })
    const obj: Record<string, Bounds> = {}
    for (const [k, v] of cache.entries()) obj[k] = v
    writeFileSync(fileOf(), JSON.stringify(obj, null, 2))
    dirty = false
  } catch {
    // 写失败不致命（只影响记忆）
  }
}

/** 校验 bounds 与任一显示器工作区有交集，否则返回 null */
function sanitize(b: Bounds): Bounds | null {
  const area = screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    // 至少 80x60 像素可见才算有效
    return (
      b.x + b.width > wa.x + 80 &&
      b.x < wa.x + wa.width - 80 &&
      b.y + b.height > wa.y + 60 &&
      b.y < wa.y + wa.height - 60
    )
  })
  return area ? b : null
}

export interface WindowStateOptions {
  defaultWidth: number
  defaultHeight: number
  minWidth?: number
  minHeight?: number
}

/** 读取记忆的窗口状态（不存在/无效返回 null，调用方用默认值创建） */
export function loadWindowState(key: string, opts: WindowStateOptions): Bounds | null {
  loadAll()
  const b = cache.get(key)
  if (!b) return null
  const ok =
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    b.width >= (opts.minWidth ?? 400) &&
    b.height >= (opts.minHeight ?? 300)
  return ok ? sanitize(b) : null
}

/** 创建窗口后调用：关闭时保存 bounds（含最大化状态） */
export function trackWindowState(win: BrowserWindow, key: string): void {
  const save = (): void => {
    try {
      if (win.isDestroyed()) return
      // 最大化时不存还原后的 bounds（无意义），只记 maximized 标记
      if (win.isMaximized()) {
        const prev = cache.get(key)
        if (prev) {
          cache.set(key, { ...prev, maximized: true })
          dirty = true
        }
        return
      }
      const b = win.getBounds()
      cache.set(key, { ...b, maximized: false })
      dirty = true
    } catch {
      // 窗口销毁竞态，忽略
    }
  }
  win.on('close', save)
  app.on('before-quit', flush)
  win.on('closed', flush)
}

/** 恢复时是否应最大化 */
export function wasMaximized(key: string): boolean {
  return !!cache.get(key)?.maximized
}

export { flush as flushWindowState }
