import { create } from 'zustand'
import type { SelectionResult, SelectionRule } from '../../shared/types'

export function emptyRule(): SelectionRule {
  return {
    id: '',
    name: '',
    mode: 'rule',
    enabled: true,
    filters: [],
    sort: { field: 'changePercent', order: 'desc' },
    top: 30,
    scheduleMinutes: null,
    createdAt: Date.now()
  }
}

interface SelectionState {
  rules: SelectionRule[]
  results: SelectionResult[]
  scanning: boolean
  error: string | null

  load(): Promise<void>
  save(rule: Partial<SelectionRule>): Promise<void>
  remove(id: string): Promise<void>
  run(rule: SelectionRule): Promise<void>
}

export const useSelection = create<SelectionState>((set, get) => ({
  rules: [],
  results: [],
  scanning: false,
  error: null,

  load: async () => {
    try {
      const [rules, results] = await Promise.all([
        window.api.selection.listRules(),
        window.api.selection.getResults()
      ])
      set({ rules, results })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  save: async (rule) => {
    try {
      const rules = await window.api.selection.saveRule(rule)
      set({ rules })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  remove: async (id) => {
    try {
      const rules = await window.api.selection.deleteRule(id)
      set({ rules })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  run: async (rule) => {
    set({ scanning: true, error: null })
    try {
      const result = await window.api.selection.runScan(rule)
      set({
        scanning: false,
        results: [result, ...get().results.filter((r) => r.id !== result.id)].slice(0, 20)
      })
    } catch (err) {
      set({ scanning: false, error: String(err) })
    }
  }
}))
