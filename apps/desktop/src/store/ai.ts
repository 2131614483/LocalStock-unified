import { create } from 'zustand'
import type { AiAuditEntry, AiChatMessage, AiConfig, AiContext, AiToolCall } from '../../shared/types'
import { useBacktest } from './backtest'
import { useDrawings } from './drawings'
import { useSelection } from './selection'

interface AiState {
  messages: AiChatMessage[]
  running: boolean
  panelOpen: boolean
  config: AiConfig | null
  audit: AiAuditEntry[]
  inited: boolean

  init(): void
  send(text: string, ctx?: AiContext): Promise<void>
  cancel(): void
  reset(): void
  setPanelOpen(v: boolean): void
  loadConfig(): Promise<void>
  saveConfig(patch: Partial<AiConfig>): Promise<void>
  loadAudit(): Promise<void>
  rollback(id: string): Promise<{ ok: boolean; error?: string }>
}

let unsubs: Array<() => void> = []

export const useAi = create<AiState>((set, get) => ({
  messages: [],
  running: false,
  panelOpen: false,
  config: null,
  audit: [],
  inited: false,

  init: () => {
    if (get().inited) return
    set({ inited: true })
    const api = window.api.ai
    unsubs.push(
      api.onChunk((chunk) =>
        set((s) => {
          const msgs = s.messages.slice()
          const last = msgs[msgs.length - 1]
          if (last && last.role === 'assistant' && !last.finished) {
            msgs[msgs.length - 1] = { ...last, content: last.content + chunk }
          }
          return { messages: msgs }
        })
      ),
      api.onTool((call: AiToolCall) =>
        set((s) => {
          const msgs = s.messages.slice()
          const last = msgs[msgs.length - 1]
          if (last && last.role === 'assistant') {
            const toolCalls = (last.toolCalls ?? []).slice()
            const idx = toolCalls.findIndex((t) => t.id === call.id)
            if (idx >= 0) toolCalls[idx] = call
            else toolCalls.push(call)
            msgs[msgs.length - 1] = { ...last, toolCalls }
          }
          return { messages: msgs }
        })
      ),
      api.onDone(() =>
        set((s) => {
          const msgs = s.messages.slice()
          const last = msgs[msgs.length - 1]
          if (last && last.role === 'assistant') msgs[msgs.length - 1] = { ...last, finished: true }
          return { messages: msgs, running: false }
        })
      ),
      api.onRefresh(() => {
        // AI 写了策略/画线/选股后，刷新对应 store 与审计列表
        void useBacktest.getState().reloadCode()
        const d = useDrawings.getState()
        if (d.secid) void d.load(d.secid)
        void useSelection.getState().load()
        void get().loadAudit()
      }),
      api.onError((err) =>
        set((s) => {
          const msgs = s.messages.slice()
          const last = msgs[msgs.length - 1]
          if (last && last.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, error: err, finished: true }
          }
          return { messages: msgs, running: false }
        })
      )
    )
    void get().loadConfig()
    void get().loadAudit()
  },

  send: async (text, ctx) => {
    if (get().running || !text.trim()) return
    const userMsg: AiChatMessage = { role: 'user', content: text, finished: true }
    const asstMsg: AiChatMessage = { role: 'assistant', content: '', toolCalls: [], finished: false }
    set({ messages: [...get().messages, userMsg, asstMsg], running: true })
    const res = await window.api.ai.send(text, ctx)
    if (!res.ok) {
      set((s) => {
        const msgs = s.messages.slice()
        const last = msgs[msgs.length - 1]
        msgs[msgs.length - 1] = {
          ...last,
          error: res.error,
          finished: true,
          toolCalls: last.toolCalls ?? []
        }
        return { messages: msgs, running: false }
      })
    }
  },

  cancel: () => {
    void window.api.ai.cancel()
  },

  reset: () => {
    void window.api.ai.reset().then(() => set({ messages: [] }))
  },

  setPanelOpen: (v) => set({ panelOpen: v }),

  loadConfig: async () => {
    try {
      set({ config: await window.api.ai.getConfig() })
    } catch (err) {
      console.error('[ai] loadConfig', err)
    }
  },

  saveConfig: async (patch) => {
    try {
      const cfg = await window.api.ai.setConfig(patch)
      set({ config: cfg })
    } catch (err) {
      console.error('[ai] saveConfig', err)
    }
  },

  loadAudit: async () => {
    try {
      set({ audit: await window.api.ai.getAudit() })
    } catch (err) {
      console.error('[ai] loadAudit', err)
    }
  },

  rollback: async (id) => {
    const res = await window.api.ai.rollback(id)
    if (res.ok) void get().loadAudit()
    return res
  }
}))

/** 清理订阅（应用卸载时） */
export function disposeAi(): void {
  for (const u of unsubs) u()
  unsubs = []
}
