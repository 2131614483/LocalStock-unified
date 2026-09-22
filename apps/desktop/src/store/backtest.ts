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

// React StrictMode 和切换页面都可能触发多次加载；同一次工作区只恢复一次，
// 否则较慢的设置读取会覆盖用户刚刚选入的股票。
let workspaceLoadPromise: Promise<void> | null = null

interface BacktestState {
  dataStatus: BacktestDataStatus | null
  downloading: boolean
  downloadMsg: DownloadProgressMsg | null
  templates: Array<{ name: string; code: string }>
  selectedTemplate: string
  code: string
  /** 已从本地工作区恢复，避免异步恢复覆盖刚选中的股票。 */
  workspaceReady: boolean
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
  saveCode(code?: string): Promise<void>
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
  workspaceReady: false,
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
    if (get().workspaceReady) return
    if (workspaceLoadPromise) return workspaceLoadPromise

    workspaceLoadPromise = (async () => {
      try {
        const [list, savedCode, savedWorkspace] = await Promise.all([
          window.api.backtest.listTemplates(),
          window.api.settings.get('backtest.code'),
          window.api.settings.get('backtest.workspace')
        ])
        let workspace: Partial<Pick<BacktestState, 'selectedTemplate' | 'startDate' | 'endDate' | 'capital'>> = {}
        if (savedWorkspace) {
          try {
            workspace = JSON.parse(savedWorkspace) as typeof workspace
          } catch {
            // 兼容旧版本或手动修改过的设置：忽略无效工作区数据。
          }
        }
        if (list.length > 0) {
          const selectedTemplate = list.some((t) => t.name === workspace.selectedTemplate)
            ? workspace.selectedTemplate!
            : (list.find((t) => t.name === 'dual_ma') ?? list[0]).name
          const template = list.find((t) => t.name === selectedTemplate)!
          set({
            templates: list,
            selectedTemplate,
            code: savedCode?.trim() ? savedCode : template.code,
            startDate: workspace.startDate || startDateDefault,
            endDate: workspace.endDate || endDateDefault,
            capital: Number.isFinite(workspace.capital) && workspace.capital! > 0
              ? workspace.capital!
              : 1000000,
            workspaceReady: true
          })
        } else {
          set({ templates: list, workspaceReady: true })
        }
      } catch (err) {
        console.error('[backtest] loadTemplates', err)
      } finally {
        workspaceLoadPromise = null
      }
    })()
    return workspaceLoadPromise
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

  applyTemplate: (name, code) => {
    set({ selectedTemplate: name, code })
    void window.api.settings.set('backtest.code', code).catch(() => {})
    void window.api.settings.set(
      'backtest.workspace',
      JSON.stringify({
        selectedTemplate: name,
        startDate: get().startDate,
        endDate: get().endDate,
        capital: get().capital
      })
    ).catch(() => {})
  },

  setCode: (code) => set({ code }),

  saveCode: async (code = get().code) => {
    await window.api.settings.set('backtest.code', code)
  },

  reloadCode: async () => {
    const saved = await window.api.settings.get('backtest.code')
    if (saved !== null) set({ code: saved })
  },

  resetToTemplate: () => {
    const st = get()
    const t = st.templates.find((x) => x.name === st.selectedTemplate)
    if (t) {
      set({ code: t.code })
      void get().saveCode(t.code).catch(() => {})
    }
  },

  setParams: (p) => {
    const next = {
      startDate: p.startDate ?? get().startDate,
      endDate: p.endDate ?? get().endDate,
      capital: p.capital ?? get().capital
    }
    set(next)
    void window.api.settings.set(
      'backtest.workspace',
      JSON.stringify({ selectedTemplate: get().selectedTemplate, ...next })
    ).catch(() => {})
  },

  runBacktest: async () => {
    if (!get().code.trim()) {
      set({ error: '请先选择策略模板或编写策略代码' })
      return
    }
    // 即使用户在防抖时间内立刻点击运行，也先保存本次策略。
    void get().saveCode().catch(() => {})
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
