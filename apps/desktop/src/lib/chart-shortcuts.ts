import type { DrawingType } from '../../shared/types'

export const CHART_SHORTCUT_SETTING_KEY = 'chart.shortcuts'
export const CHART_SHORTCUT_LOCAL_KEY = 'localstock.chart.shortcuts'
export const CHART_SHORTCUT_EVENT = 'localstock:chart-shortcut'
export const CHART_SHORTCUT_CONFIG_EVENT = 'localstock:chart-shortcut-config'

export type ShortcutMode = 'standard' | 'professional'

export interface ChartShortcutConfig {
  enabled: boolean
  mode: ShortcutMode
  panBars: number
  zoomPercent: number
  shiftMultiplier: number
}

export const DEFAULT_CHART_SHORTCUT_CONFIG: ChartShortcutConfig = {
  enabled: true,
  mode: 'standard',
  panBars: 10,
  zoomPercent: 10,
  shiftMultiplier: 5
}

export type ChartShortcutCommand =
  | 'pan-left'
  | 'pan-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'latest'
  | 'future'
  | 'cancel'
  | 'undo-drawing'
  | 'previous-period'
  | 'next-period'
  | 'period-minute'
  | 'period-day'
  | 'period-week'
  | 'period-month'
  | 'period-quarter'
  | `drawing-${DrawingType}`

export interface ChartShortcutDetail {
  command: ChartShortcutCommand
  accelerated: boolean
  config: ChartShortcutConfig
}

export function parseChartShortcutConfig(raw: string | null | undefined): ChartShortcutConfig {
  if (!raw) return DEFAULT_CHART_SHORTCUT_CONFIG
  try {
    const value = JSON.parse(raw) as Partial<ChartShortcutConfig>
    return {
      enabled: value.enabled !== false,
      mode: value.mode === 'professional' ? 'professional' : 'standard',
      panBars: [1, 5, 10, 20, 30].includes(Number(value.panBars)) ? Number(value.panBars) : 10,
      zoomPercent: [5, 10, 15, 20, 25].includes(Number(value.zoomPercent)) ? Number(value.zoomPercent) : 10,
      shiftMultiplier: [2, 5, 10].includes(Number(value.shiftMultiplier)) ? Number(value.shiftMultiplier) : 5
    }
  } catch {
    return DEFAULT_CHART_SHORTCUT_CONFIG
  }
}

export function emitChartShortcut(detail: ChartShortcutDetail): void {
  window.dispatchEvent(new CustomEvent<ChartShortcutDetail>(CHART_SHORTCUT_EVENT, { detail }))
}

export function emitChartShortcutConfig(config: ChartShortcutConfig): void {
  window.dispatchEvent(new CustomEvent<ChartShortcutConfig>(CHART_SHORTCUT_CONFIG_EVENT, { detail: config }))
}
