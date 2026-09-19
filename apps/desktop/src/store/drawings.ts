import { create } from 'zustand'
import type { Drawing, DrawingType, DrawingVersion, KlineResult } from '../../shared/types'
import { DEFAULT_COLOR } from '../lib/drawing'

interface DrawingsState {
  secid: string | null
  /** 全部画线（含隐藏与回收站；visible/deleted 标记在 Drawing 上） */
  drawings: Drawing[]
  history: DrawingVersion[]
  /** 当前画线工具（null 表示关闭） */
  tool: DrawingType | null
  color: string
  loading: boolean

  load(secid: string): Promise<void>
  setTool(tool: DrawingType | null): void
  setColor(color: string): void
  addDrawing(d: Drawing): void
  /** 显示/隐藏切换 */
  toggleVisible(id: string): void
  /** 删除 → 回收站（soft delete） */
  removeDrawing(id: string): void
  /** 从回收站恢复 */
  restoreFromTrash(id: string): void
  /** 从回收站彻底删除 */
  deletePermanently(id: string): void
  /** 清空 → 全部进回收站 */
  clearAll(scope?: string): void
  save(): Promise<void>
  restoreVersion(version: number): Promise<void>
  runAlgo(code: string, kline: KlineResult, scope: string): Promise<{ ok: boolean; count?: number; error?: string }>
}

export const useDrawings = create<DrawingsState>((set, get) => ({
  secid: null,
  drawings: [],
  history: [],
  tool: null,
  color: DEFAULT_COLOR,
  loading: false,

  load: async (secid) => {
    set({ secid, loading: true })
    try {
      const r = await window.api.drawings.get(secid)
      set({ drawings: r.current, history: r.history, loading: false })
    } catch (err) {
      console.error('[drawings] load', err)
      set({ drawings: [], history: [], loading: false })
    }
  },

  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),

  addDrawing: (d) => set({ drawings: [...get().drawings, d] }),
  toggleVisible: (id) =>
    set({
      drawings: get().drawings.map((d) =>
        d.id === id ? { ...d, visible: d.visible === false ? undefined : false } : d
      )
    }),
  removeDrawing: (id) =>
    set({ drawings: get().drawings.map((d) => (d.id === id ? { ...d, deleted: true } : d)) }),
  restoreFromTrash: (id) =>
    set({ drawings: get().drawings.map((d) => (d.id === id ? { ...d, deleted: false } : d)) }),
  deletePermanently: (id) =>
    set({ drawings: get().drawings.filter((d) => d.id !== id) }),
  clearAll: (scope) =>
    set({
      drawings: get().drawings.map((d) =>
        !scope || (d.scope ?? 'kline:day') === scope ? { ...d, deleted: true } : d
      )
    }),

  save: async () => {
    const { secid, drawings } = get()
    if (!secid) return
    try {
      await window.api.drawings.save(secid, drawings)
      const r = await window.api.drawings.get(secid)
      set({ history: r.history })
    } catch (err) {
      console.error('[drawings] save', err)
    }
  },

  restoreVersion: async (version) => {
    const { secid } = get()
    if (!secid) return
    try {
      const drawings = await window.api.drawings.restore(secid, version)
      if (drawings) set({ drawings })
    } catch (err) {
      console.error('[drawings] restore', err)
    }
  },

  runAlgo: async (code, kline, scope) => {
    const { secid } = get()
    if (!secid) return { ok: false, error: '无当前股票' }
    try {
      const r = await window.api.drawings.runAlgo(secid, code, kline)
      if (r.ok && r.drawings) {
        const scoped = r.drawings.map((drawing) => ({ ...drawing, scope }))
        set({ drawings: [...get().drawings, ...scoped] })
        await get().save()
        return { ok: true, count: r.drawings.length }
      }
      return { ok: false, error: r.error }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }
}))

/** 图表应显示的画线：未删除且未隐藏 */
export function selectActiveDrawings(drawings: Drawing[]): Drawing[] {
  return drawings.filter((d) => !d.deleted && d.visible !== false)
}
