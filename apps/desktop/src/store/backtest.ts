import { create } from 'zustand'
import type {
  BacktestDataStatus,
  BacktestResult,
  DownloadProgressMsg
} from '../../shared/types'

const now = new Date()
const endDateDefault = now.toISOString().slice(0, 10)
const startDateDefault = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())
  .toISOString()
  .slice(0, 10)

interface BacktestState {
  dataStatus: BacktestDataStatus | null
  downloading: boolean
  downloadMsg: DownloadProgressMsg | null
  templates: Array<{ name: string; code: string }>
  selectedTemplate: string
  code: string
  startDate: string
  endDate: string
  capital: number
  running: boolean
  result: BacktestResult | null
  error: string | null

  loadDataStatus(): Promise<void>
  loadTemplates(): Promise<void>
  startDownload(): Promise<void>
  setDownloadProgress(msg: DownloadProgressMsg): void
  applyTemplate(name: string, code: string): void
  setCode(code: string): void
  /** 从 settings 重读自动保存的策略代码（AI 写入后刷新用） */
  reloadCode(): Promise<void>
  resetToTemplate(): void
  setParams(p: { startDate?: string; endDate?: string; capital?: number }): void
  runBacktest(): Promise<void>
  resetResult(): void
}

export const useBacktest = create<BacktestState>((set, get) => ({
  dataStatus: null,
  downloading: false,
  downloadMsg: null,
  templates: [],
  selectedTemplate: 'dual_ma',
  code: '',
  startDate: startDateDefault,
  endDate: endDateDefault,
  capital: 1000000,
  running: false,
  result: null,
  error: null,

  loadDataStatus: async () => {
    try {
      const st = await window.api.backtest.getDataStatus()
      set({ dataStatus: st })
    } catch (err) {
      set({ dataStatus: { exists: false, error: String(err) } })
    }
  },

  loadTemplates: async () => {
    try {
      const list = await window.api.backtest.listTemplates()
      set({ templates: list })
      // 恢复上次自动保存的策略代码（若有），否则载入默认模板
      const saved = await window.api.settings.get('backtest.code')
      if (list.length > 0) {
        if (saved) {
          set({ code: saved })
        } else {
          const first = list.find((t) => t.name === 'dual_ma') ?? list[0]
          set({ selectedTemplate: first.name, code: first.code })
        }
      }
    } catch (err) {
      console.error('[backtest] loadTemplates', err)
    }
  },

  startDownload: async () => {
    set({ downloading: true, downloadMsg: null })
    try {
      const res = await window.api.backtest.downloadData()
      if (!res.started) {
        set({ downloading: false, error: `下载未启动：${res.reason ?? ''}` })
      }
    } catch (err) {
      set({ downloading: false, error: String(err) })
    }
  },

  setDownloadProgress: (msg) => {
    if (msg.type === 'exit') {
      set({ downloading: false, downloadMsg: msg })
      void get().loadDataStatus()
      return
    }
    if (msg.type === 'error') {
      set({ downloading: false, downloadMsg: msg, error: msg.message })
      return
    }
    if (msg.type === 'done') {
      set({ downloading: false, downloadMsg: msg })
      void get().loadDataStatus()
      return
    }
    set({ downloadMsg: msg })
  },

  applyTemplate: (name, code) => set({ selectedTemplate: name, code }),

  setCode: (code) => set({ code }),

  reloadCode: async () => {
    const saved = await window.api.settings.get('backtest.code')
    if (saved !== null) set({ code: saved })
  },

  resetToTemplate: () => {
    const st = get()
    const t = st.templates.find((x) => x.name === st.selectedTemplate)
    if (t) {
      set({ code: t.code })
      void window.api.settings.set('backtest.code', '').catch(() => {})
    }
  },

  setParams: (p) =>
    set({
      startDate: p.startDate ?? get().startDate,
      endDate: p.endDate ?? get().endDate,
      capital: p.capital ?? get().capital
    }),

  runBacktest: async () => {
    if (!get().code.trim()) {
      set({ error: '请先选择策略模板或编写策略代码' })
      return
    }
    set({ running: true, error: null, result: null })
    try {
      const result = await window.api.backtest.run({
        code: get().code,
        startDate: get().startDate,
        endDate: get().endDate,
        capital: get().capital
      })
      if (result.code !== 0) {
        set({
          running: false,
          error: result.error || result.message || '回测失败',
          result: null
        })
        return
      }
      set({ running: false, result })
    } catch (err) {
      set({ running: false, error: String(err), result: null })
    }
  },

  resetResult: () => set({ result: null, error: null })
}))
