import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { CHART_THEME, ensureChartTheme } from './chart-theme'

/**
 * ECharts 封装：自动 init / dispose / resize。
 * StrictMode 下安全（每次 mount 重新 init）。统一使用 localstock-dark 主题（A2）。
 */
export function useEChart(option: EChartsOption | null) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    ensureChartTheme()
    try {
      const chart = echarts.init(containerRef.current, CHART_THEME)
      chartRef.current = chart
    } catch {
      // echarts 初始化失败时静默，图表区显示空态
    }
    return () => {
      try {
        chartRef.current?.dispose()
      } catch {
        // echarts 内部节点可能已被 React 移除，忽略，避免中断 React 渲染
      }
      chartRef.current = null
    }
  }, [])

  // 窗口尺寸变化 + 容器尺寸变化（拖分栏/面板把手/宽高比缩放）都要 resize，
  // 否则 canvas 被 CSS 拉伸模糊错位。ResizeObserver + rAF 节流。
  useEffect(() => {
    let raf = 0
    const doResize = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try {
          chartRef.current?.resize()
        } catch {
          // dispose 竞态时 resize 可能抛错，忽略
        }
      })
    }
    window.addEventListener('resize', doResize)
    const ro = new ResizeObserver(doResize)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => {
      window.removeEventListener('resize', doResize)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    if (option && chartRef.current) {
      try {
        chartRef.current.setOption(option, true)
      } catch (error) {
        // 保留错误日志，避免配置异常时只剩空白图表而无法定位。
        console.error('[chart] setOption failed', error)
      }
    }
  }, [option])

  return { ref: containerRef, chart: chartRef }
}
