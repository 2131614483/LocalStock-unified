import { useEffect } from 'react'
import { useApp } from '../store/app'
import {
  CHART_SHORTCUT_CONFIG_EVENT,
  CHART_SHORTCUT_LOCAL_KEY,
  CHART_SHORTCUT_SETTING_KEY,
  DEFAULT_CHART_SHORTCUT_CONFIG,
  emitChartShortcut,
  parseChartShortcutConfig,
  type ChartShortcutCommand,
  type ChartShortcutConfig
} from './chart-shortcuts'

/**
 * 全局快捷键：
 * - Ctrl+F / F：聚焦搜索框
 * - F5 / Ctrl+R：刷新当前列表（自选重拉 / 市场重拉）
 */
export function useShortcuts(): void {
  useEffect(() => {
    let chartConfig: ChartShortcutConfig = DEFAULT_CHART_SHORTCUT_CONFIG
    chartConfig = parseChartShortcutConfig(localStorage.getItem(CHART_SHORTCUT_LOCAL_KEY))
    void window.api.settings.get(CHART_SHORTCUT_SETTING_KEY).then((raw) => {
      chartConfig = parseChartShortcutConfig(raw)
      localStorage.setItem(CHART_SHORTCUT_LOCAL_KEY, JSON.stringify(chartConfig))
    })
    const onConfig = (event: Event): void => {
      chartConfig = (event as CustomEvent<ChartShortcutConfig>).detail
    }

    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const inInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable ||
        Boolean(target?.closest('.cm-editor'))

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search-input')?.focus()
        return
      }
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        const st = useApp.getState()
        if (st.view.type === 'market') void st.loadMarketList()
        else void st.loadWatchlist()
        return
      }
      // 输入框内不响应数字/字母快捷键
      if (inInput) return
      if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search-input')?.focus()
        return
      }

      // 设置可能在独立窗口中修改；共享 localStorage 让主窗口下一次按键立即读取新值。
      chartConfig = parseChartShortcutConfig(localStorage.getItem(CHART_SHORTCUT_LOCAL_KEY))
      if (!chartConfig.enabled || useApp.getState().view.type !== 'detail') return

      const key = e.key.toLowerCase()
      let command: ChartShortcutCommand | null = null
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const drawingKeys: Record<string, ChartShortcutCommand> = {
          t: 'drawing-segment',
          h: 'drawing-hline',
          r: 'drawing-rect',
          y: 'drawing-ray',
          f: 'drawing-fib',
          c: 'drawing-channel',
          x: 'cancel'
        }
        command = drawingKeys[key] ?? null
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'z') {
        command = 'undo-drawing'
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const common: Record<string, ChartShortcutCommand> = {
          arrowleft: 'pan-left',
          arrowright: 'pan-right',
          arrowup: 'zoom-in',
          arrowdown: 'zoom-out',
          home: 'latest',
          end: 'future',
          '+': 'zoom-in',
          '=': 'zoom-in',
          '-': 'zoom-out',
          escape: 'cancel',
          '[': 'previous-period',
          ']': 'next-period'
        }
        command = common[key] ?? null
        if (!command && chartConfig.mode === 'professional') {
          const professional: Record<string, ChartShortcutCommand> = {
            a: 'pan-left',
            d: 'pan-right',
            w: 'zoom-in',
            s: 'zoom-out',
            r: 'latest',
            f: 'future',
            '1': 'period-minute',
            '2': 'period-day',
            '3': 'period-week',
            '4': 'period-month',
            '5': 'period-quarter'
          }
          command = professional[key] ?? null
        }
      }
      if (!command) return
      // 分时折线没有横向留白；平移/缩放命令只在 K 线画布可见时接管按键。
      const chartOnly = ['pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'latest', 'future'].includes(command)
      if (chartOnly && !document.querySelector('.chart-pane:not(.pane-hidden) .kline-chart-box')) return
      e.preventDefault()
      emitChartShortcut({ command, accelerated: e.shiftKey, config: chartConfig })
    }
    window.addEventListener(CHART_SHORTCUT_CONFIG_EVENT, onConfig)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(CHART_SHORTCUT_CONFIG_EVENT, onConfig)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}
