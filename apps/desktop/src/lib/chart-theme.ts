import * as echarts from 'echarts'

/**
 * LocalStock 统一 ECharts 深色主题（A2）：
 * 三处图表（K线/分时/回测）从此共享同一份配色，不再各自硬编码色值。
 * 与 globals.css 的 CSS 变量同源，未来换肤只改这一处。
 */
export const CHART_THEME = 'localstock-dark'

export const CHART_COLORS = {
  bg: '#0d0e10', // 页面底
  panel: '#15171b',
  panel2: '#1a1d22',
  border: '#2e333c',
  axisLabel: '#6b7280',
  axisLine: '#2e333c',
  splitLine: '#1a1d22',
  text: '#c9ced6',
  legend: '#8b929c',
  up: '#f5222d', // 红涨
  down: '#14b143', // 绿跌
  // 指标线：MA + 副图，与界面一致
  ma: ['#f5c542', '#2f81f7', '#e879f9', '#34d399'],
  dif: '#e879f9',
  dea: '#2f81f7',
  k: '#f5c542',
  d: '#2f81f7',
  j: '#e879f9',
  rsi: ['#f5c542', '#2f81f7', '#e879f9'],
  avg: '#f5c542',
  priceLine: '#e8e9ec',
  tooltipBg: '#1a1d22',
  tooltipBorder: '#2e333c',
  // dataZoom 滑块（实色深底，半透明白会被当实色渲染成白条）
  dzBg: '#1a1d22',
  dzFiller: 'rgba(47,129,247,0.4)',
  dzHandle: '#8b929c',
  dzDataShadow: '#3a4048',
  // 分时价格填充渐变（上方淡色 → 底部近透明）
  dzFillerR18: 'rgba(47,129,247,0.18)',
  dzFillerR02: 'rgba(47,129,247,0.02)',
  // 回测收益/回撤曲线填充
  dzFillerR08: 'rgba(47,129,247,0.08)',
  upArea15: 'rgba(245,34,45,0.15)'
} as const

/** 初始化：注册主题（幂等，electron-vite 单构建 init 只跑一次） */
let registered = false
export function ensureChartTheme(): void {
  if (registered) return
  registered = true
  echarts.registerTheme(CHART_THEME, {
    backgroundColor: CHART_COLORS.bg,
    textStyle: { color: CHART_COLORS.text },
    title: { textStyle: { color: CHART_COLORS.text } }
  })
}