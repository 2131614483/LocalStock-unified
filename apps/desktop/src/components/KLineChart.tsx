import { useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import type { Drawing, DrawingPoint, DrawingType, KlineResult } from '../../shared/types'
import { useEChart } from '../lib/useEChart'
import { DEFAULT_COLOR, newDrawing } from '../lib/drawing'
import { calcKDJ, calcMACD, calcRSI, DEFAULT_INDICATORS, type IndicatorConfig } from '../lib/indicators'
import { DOWN_COLOR, UP_COLOR } from '../lib/format'
import { CHART_COLORS } from '../lib/chart-theme'
import {
  CHART_SHORTCUT_EVENT,
  type ChartShortcutDetail
} from '../lib/chart-shortcuts'

// MA 线与指标副图配色 → 统一主题常量（A2 主题集中，改 chart-theme 一处生效）
const MA_COLORS = [CHART_COLORS.ma[0], CHART_COLORS.ma[2], CHART_COLORS.ma[1], CHART_COLORS.ma[3]]

/** 简单移动平均线；窗口未满返回 null 占位 */
function calcMA(closes: number[], n: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < n - 1) return null
    let sum = 0
    for (let j = i - n + 1; j <= i; j++) sum += closes[j]
    return Number((sum / n).toFixed(2))
  })
}

/** #rrggbb → rgba(...,alpha)，供矩形填充 */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** 在 times 中定位画线点的时间：先精确匹配，再按日期前缀互认（"YYYY-MM-DD" ↔ "YYYY-MM-DD HH:MM"） */
function idxOfTime(times: string[], t: string): number {
  const exact = times.indexOf(t)
  if (exact >= 0) return exact
  const date = t.slice(0, 10)
  return times.findIndex((x) => x.slice(0, 10) === date)
}

/** 画线 custom series 的 renderItem：把 (索引, 价格) 数据坐标转像素。
 *  注意：x 轴是 category（日期字符串），a.coord 需要传类别值而非索引，
 *  否则 coord 对数字索引解析失败返回 NaN，导致所有用 x 的图形（线段/射线/矩形/斐波那契/通道）不渲染。
 *  因此先通过 times[索引] 取日期，再交给 coord。 */
function makeRenderDrawingItem(times: string[], drawings: Drawing[]) {
  return function renderDrawingItem(params: unknown, api: unknown): unknown {
    const idx = (params as { dataIndex?: number }).dataIndex ?? 0
    const drawing = drawings[idx]
    const a = api as {
      coord(p: (string | number)[]): number[]
      getWidth(): number
    }
    if (!drawing || !drawing.points.length) return null
    const pts = drawing.points
    const px = (p: DrawingPoint): number[] => {
      const idx = p.t !== undefined ? idxOfTime(times, p.t) : Math.round(p.x)
      const cat = idx >= 0 ? times[idx] : String(p.x)
      return a.coord([cat, p.y])
    }
    try {
  const style = { stroke: drawing.color, lineWidth: 2, fill: 'transparent' }
  switch (drawing.type) {
    case 'hline': {
      const y = px(pts[0])[1]
      return {
        type: 'line',
        shape: { x1: 0, y1: y, x2: a.getWidth(), y2: y },
        style
      }
    }
    case 'segment': {
      const p1 = px(pts[0])
      const p2 = px(pts[1])
      return { type: 'polyline', shape: { points: [p1, p2] }, style }
    }
    case 'ray': {
      const p1 = px(pts[0])
      const p2 = px(pts[1])
      const dx = p2[0] - p1[0]
      const dy = p2[1] - p1[1]
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.001) return { type: 'polyline', shape: { points: [p1, p2] }, style }
      const ext = 5000 / len
      return {
        type: 'polyline',
        shape: { points: [p1, [p1[0] + dx * ext, p1[1] + dy * ext]] },
        style
      }
    }
    case 'rect': {
      const p1 = px(pts[0])
      const p2 = px(pts[1])
      return {
        type: 'rect',
        shape: {
          x: Math.min(p1[0], p2[0]),
          y: Math.min(p1[1], p2[1]),
          width: Math.abs(p2[0] - p1[0]),
          height: Math.abs(p2[1] - p1[1])
        },
        style: { ...style, fill: hexToRgba(drawing.color, 0.5) }
      }
    }
    case 'fib': {
      const p1 = px(pts[0])
      const p2 = px(pts[1])
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
      const children = levels.map((lv) => {
        const y = p1[1] + (p2[1] - p1[1]) * lv
        return {
          type: 'line',
          shape: {
            x1: Math.min(p1[0], p2[0]),
            y1: y,
            x2: Math.max(p1[0], p2[0]),
            y2: y
          },
          style
        }
      })
      return { type: 'group', children }
    }
    case 'channel': {
      const p1 = px(pts[0])
      const p2 = px(pts[1])
      const dx = p2[0] - p1[0]
      const dy = p2[1] - p1[1]
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const off = 24
      const nx = (-dy / len) * off
      const ny = (dx / len) * off
      return {
        type: 'group',
        children: [
          {
            type: 'polyline',
            shape: { points: [[p1[0] + nx, p1[1] + ny], [p2[0] + nx, p2[1] + ny]] },
            style
          },
          {
            type: 'polyline',
            shape: { points: [[p1[0] - nx, p1[1] - ny], [p2[0] - nx, p2[1] - ny]] },
            style
          }
        ]
      }
    }
  }
  } catch (e) {
    console.log('[DRAW-RENDER-ERR]', String(e))
    return null
  }
  }
}

interface Props {
  data: KlineResult | null
  scope: string
  /** 画线相关（可选，回测结果等场景不传） */
  secid?: string
  drawings?: Drawing[]
  tool?: DrawingType | null
  color?: string
  onDrawingComplete?: (d: Drawing) => void
  /** 指标副图显示开关（默认关） */
  indicators?: IndicatorConfig
  /** 十字光标所在K线日期，用于新闻等外部面板联动 */
  onHoverDate?: (date: string) => void
}

export default function KLineChart({
  data,
  scope,
  drawings = [],
  tool = null,
  color = DEFAULT_COLOR,
  onDrawingComplete,
  indicators = DEFAULT_INDICATORS,
  onHoverDate
}: Props) {
  const pendingRef = useRef<DrawingPoint | null>(null)
  const [preview, setPreview] = useState<Drawing | null>(null)
  // 记录用户手动缩放/平移的 dataZoom 状态，避免 option 重建（画线/切工具/数据更新）时复位
  const zoomRef = useRef<{ start: number; end: number; len: number } | null>(null)
  // dataZoom 改变时重建 custom series 的可视锚点；真实缩放值仍放 ref，避免额外状态来源。
  const [zoomRevision, setZoomRevision] = useState(0)
  const [shortcutHint, setShortcutHint] = useState('')
  const shortcutHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const wrapRef = useRef<HTMLDivElement>(null)
  // K线看板：主图/副图分割可拖拽（↕）；图表总高度由外层 StockDetail 的底部把手控制
  const [pricePct, setPricePct] = useState<number | null>(null)
  const indKeys = (['macd', 'kdj', 'rsi'] as const).filter((k) => indicators[k])
  const paneCount = 1 + indKeys.length
  const effPricePct = pricePct ?? Math.max(28, 78 - paneCount * 11)
  const subPanePct = Math.max(8, (78 - effPricePct) / paneCount)
  // legend 固定占顶部 28px（折算容器百分比），价格主图与副图在剩余高度里按比例分
  const wrapH = wrapRef.current?.offsetHeight ?? 480
  const legendPct = (28 / wrapH) * 100
  const restPct = Math.max(20, 100 - legendPct)
  const renderedDrawings = preview ? [...drawings, preview] : drawings

  const onSplitDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startPct = effPricePct
    const move = (ev: MouseEvent): void => {
      const h = wrapRef.current?.offsetHeight ?? 480
      setPricePct(Math.max(24, Math.min(72, startPct + ((ev.clientY - startY) / h) * 100)))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-row')
    }
    document.body.classList.add('resizing-row')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const option = useMemo<EChartsOption | null>(() => {
    if (!data || data.points.length === 0) return null
    const { points } = data
    const len = points.length
    const visible = Math.min(120, len)
    // 在真实行情末尾补半个当前窗口的“未来槽位”。默认窗口仍结束在最新 K 线；
    // 用户向右拖到底后，最新 K 线会位于画面中央附近，右半屏可用于延伸画线。
    const futureSlots = Math.max(1, Math.ceil(visible / 2))
    const actualTimes = points.map((p) => p.time)
    const times = [
      ...actualTimes,
      ...Array.from({ length: futureSlots }, (_, i) => `__future_${i + 1}`)
    ]
    const axisLen = times.length
    const kData = points.map((p) => [p.open, p.close, p.low, p.high])
    const closes = points.map((p) => p.close)
    const vols = points.map((p) => ({
      value: p.volume,
      itemStyle: { color: p.close >= p.open ? UP_COLOR : DOWN_COLOR }
    }))

    const highs = points.map((p) => p.high)
    const lows = points.map((p) => p.low)
    const inds = {
      macd: indicators.macd ? calcMACD(closes) : null,
      kdj: indicators.kdj ? calcKDJ(highs, lows, closes) : null,
      rsi: indicators.rsi
        ? { r6: calcRSI(closes, 6), r12: calcRSI(closes, 12), r24: calcRSI(closes, 24) }
        : null
    }
    // 指标副图 series（grid 2 起：0=价格 1=成交量）
    const IND_LABELS: Record<'macd' | 'kdj' | 'rsi', string[]> = {
      macd: ['DIF', 'DEA', 'MACD'],
      kdj: ['K', 'D', 'J'],
      rsi: ['RSI6', 'RSI12', 'RSI24']
    }
    const indSeries: unknown[] = []
    let indGrid = 2 // grid 2 起：0=价格 1=成交量
    if (inds.macd) {
      indSeries.push(
        { name: 'DIF', type: 'line', data: inds.macd.dif, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.dif }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } },
        { name: 'DEA', type: 'line', data: inds.macd.dea, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.dea }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } },
        { name: 'MACD', type: 'bar', data: inds.macd.macd.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? UP_COLOR : DOWN_COLOR } })), xAxisIndex: indGrid, yAxisIndex: indGrid, barWidth: '60%' }
      )
      indGrid++
    }
    if (inds.kdj) {
      indSeries.push(
        { name: 'K', type: 'line', data: inds.kdj.k, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.dea }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } },
        { name: 'D', type: 'line', data: inds.kdj.d, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.d }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } },
        { name: 'J', type: 'line', data: inds.kdj.j, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.dif }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } }
      )
      indGrid++
    }
    if (inds.rsi) {
      indSeries.push(
        { name: 'RSI6', type: 'line', data: inds.rsi.r6, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.dea }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } },
        { name: 'RSI12', type: 'line', data: inds.rsi.r12, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.d }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } },
        { name: 'RSI24', type: 'line', data: inds.rsi.r24, symbol: 'none', lineStyle: { width: 1, color: CHART_COLORS.dif }, xAxisIndex: indGrid, yAxisIndex: indGrid, connectNulls: false, emphasis: { disabled: true } }
      )
      indGrid++
    }

    const zoomStart = ((len - visible) / axisLen) * 100
    const zoomEnd = (len / axisLen) * 100
    // 同一数据长度下沿用用户缩放；切换周期（长度变化）则复位默认最后 120 根
    const userZoom = zoomRef.current
    const keepZoom = !!userZoom && userZoom.len === len
    const dzStart = keepZoom ? userZoom!.start : zoomStart
    const dzEnd = keepZoom ? userZoom!.end : zoomEnd

    const series: unknown[] = [
      {
        type: 'candlestick',
        name: 'K线',
        data: kData,
        itemStyle: {
          color: UP_COLOR,
          color0: DOWN_COLOR,
          borderColor: UP_COLOR,
          borderColor0: DOWN_COLOR
        }
      },
      ...MA_COLORS.map((c, mi) => ({
        name: `MA${[5, 10, 20, 60][mi]}`,
        type: 'line' as const,
        data: calcMA(closes, [5, 10, 20, 60][mi]),
        symbol: 'none',
        lineStyle: { width: 1, color: c },
        connectNulls: false,
        emphasis: { disabled: true }
      })),
      {
        type: 'bar',
        name: '成交量',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: vols,
        barWidth: '60%'
      },
      ...indSeries
    ]
    // 画线 series（custom）的 data 只负责触发 renderItem：统一锚在当前 dataZoom 窗口中央。
    // 若直接用画线端点作 data，窗口外锚点会被 filter 删除；若用 none/empty，又会让全历史行情
    // 参与当前 yAxis 范围。动态可视锚点同时避免两者，真实线坐标仍由 drawings + api.coord 计算。
    if (renderedDrawings.length > 0) {
      const anchorIndex = Math.max(0, Math.min(axisLen - 1, Math.round((dzStart + dzEnd) * axisLen / 200)))
      const anchorY = closes[Math.min(anchorIndex, len - 1)] ?? closes[len - 1] ?? 0
      series.push({
        type: 'custom',
        renderItem: makeRenderDrawingItem(times, renderedDrawings),
        data: renderedDrawings.map((d) => ({
          value: [anchorIndex, anchorY],
          d
        })),
        encode: { x: 0, y: 1 },
        silent: true,
        z: 50,
        xAxisIndex: 0,
        yAxisIndex: 0
      })
    }

    // 副图布局：价格主图 + 成交量 + 各指标，从上到下按百分比堆叠（主图高度可拖拽）。
    // 主图 top 固定 28px 给 legend 让位（legend top:0，避免图例压住蜡烛/最高价），
    // 28px 折算成容器高度百分比 legendPct，主图与副图在剩余高度里按比例堆叠。
    let gtopPct = legendPct
    const grids: Array<{ left: number; right: number; top: number | string; height: string }> = [
      { left: 56, right: 16, top: 28, height: `${(effPricePct / 100) * restPct}%` }
    ]
    gtopPct += (effPricePct / 100) * restPct
    for (let gi = 0; gi < paneCount; gi++) {
      const h = (subPanePct / 100) * restPct
      grids.push({ left: 56, right: 16, top: `${gtopPct}%`, height: `${h}%` })
      gtopPct += h
    }
    const xAxis = grids.map((_, gi) => ({
      type: 'category' as const,
      gridIndex: gi,
      data: times,
      boundaryGap: true,
      axisLabel: gi === 0
        ? {
            color: CHART_COLORS.axisLabel,
            fontSize: 11,
            hideOverlap: true,
            formatter: (value: string) => value.startsWith('__future_') ? '' : value
          }
        : { show: false },
      axisLine: { lineStyle: { color: CHART_COLORS.border } },
      axisTick: { show: false }
    }))
    const yAxis = grids.map((_, gi) => ({
      type: 'value' as const,
      gridIndex: gi,
      scale: gi !== 1,
      axisLabel: { show: gi === 0, color: CHART_COLORS.axisLabel, fontSize: 11 },
      splitLine: gi === 0 ? { lineStyle: { color: CHART_COLORS.panel2 } } : { show: false }
    }))

    return {
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }], label: { show: false } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: CHART_COLORS.panel2,
        borderColor: CHART_COLORS.border,
        textStyle: { color: CHART_COLORS.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as Array<{ dataIndex: number }>
          const i = arr[0]?.dataIndex ?? 0
          const p = points[i]
          if (!p) return ''
          const ref0 = data.preClose ?? p.open
          const chg = ref0 ? ((p.close - ref0) / ref0) * 100 : 0
          const c = p.close >= p.open ? UP_COLOR : DOWN_COLOR
          const fmt = (v: number): string => (Number.isFinite(v) ? Number(v).toFixed(2) : '-')
          let html =
            `<div>${p.time}</div>` +
            `<div><span style="color:${c}">开 ${p.open.toFixed(2)}</span>　高 ${p.high.toFixed(2)}</div>` +
            `<div><span style="color:${c}">收 ${p.close.toFixed(2)}</span>　低 ${p.low.toFixed(2)}</div>` +
            `<div>成交量 ${p.volume.toLocaleString()}手</div>` +
            `<div>涨跌 ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</div>`
          if (inds.macd) html += `<div>DIF ${fmt(inds.macd.dif[i])}　DEA ${fmt(inds.macd.dea[i])}　MACD ${fmt(inds.macd.macd[i])}</div>`
          if (inds.kdj) html += `<div>K ${fmt(inds.kdj.k[i])}　D ${fmt(inds.kdj.d[i])}　J ${fmt(inds.kdj.j[i])}</div>`
          if (inds.rsi) html += `<div>RSI6 ${fmt(inds.rsi.r6[i])}　RSI12 ${fmt(inds.rsi.r12[i])}　RSI24 ${fmt(inds.rsi.r24[i])}</div>`
          return html
        }
      },
      legend: {
        data: ['MA5', 'MA10', 'MA20', 'MA60', ...indKeys.map((k) => IND_LABELS[k]).flat()],
        top: 0,
        left: 8,
        itemWidth: 14,
        textStyle: { color: CHART_COLORS.legend, fontSize: 11 }
      },
      grid: grids,
      xAxis,
      yAxis,
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: grids.map((_, i) => i),
          start: dzStart,
          end: dzEnd,
          filterMode: 'filter',
          disabled: !!tool
        },
        {
          type: 'slider',
          xAxisIndex: grids.map((_, i) => i),
          start: dzStart,
          end: dzEnd,
          filterMode: 'filter',
          bottom: 2,
          height: 18,
          borderColor: CHART_COLORS.border,
          // 深色实底（半透明 rgba 白会被滑块按实色渲染成白条）
          backgroundColor: CHART_COLORS.panel2,
          fillerColor: CHART_COLORS.dzFiller,
          handleStyle: { color: CHART_COLORS.legend, borderColor: CHART_COLORS.border },
          // 成交量阴影预览默认浅色渐变，深底上像一条白带，压暗
          showDataShadow: true,
          dataShadow: {
            lineStyle: { color: CHART_COLORS.dzDataShadow },
            areaStyle: { color: 'rgba(255,255,255,0.04)' }
          },
          textStyle: { color: CHART_COLORS.legend, fontSize: 10 },
          disabled: !!tool
        }
      ],
      series: series as EChartsOption['series']
    }
  }, [data, renderedDrawings, tool, indicators, effPricePct, subPanePct, zoomRevision])

  const { ref, chart } = useEChart(option)

  // 键盘平移/缩放。统一通过 dataZoom action 驱动，因此滑块、鼠标拖动与快捷键状态始终同步。
  useEffect(() => {
    const showHint = (message: string): void => {
      setShortcutHint(message)
      if (shortcutHintTimer.current) clearTimeout(shortcutHintTimer.current)
      shortcutHintTimer.current = setTimeout(() => setShortcutHint(''), 900)
    }
    const onShortcut = (event: Event): void => {
      const detail = (event as CustomEvent<ChartShortcutDetail>).detail
      const command = detail?.command
      if (!['pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'latest', 'future'].includes(command)) return
      const instance = chart?.current
      const currentData = dataRef.current
      if (!instance || !currentData?.points.length) return
      const currentOption = instance.getOption() as {
        xAxis?: Array<{ data?: unknown[] }>
        dataZoom?: Array<{ start?: number; end?: number }>
      }
      const axisLen = currentOption.xAxis?.[0]?.data?.length ?? currentData.points.length
      const zoom = currentOption.dataZoom?.[0]
      let start = Number(zoom?.start ?? 0)
      let end = Number(zoom?.end ?? 100)
      const span = Math.max(0.01, end - start)
      const latestEnd = (currentData.points.length / axisLen) * 100
      const clampWindow = (nextStart: number, nextEnd: number): [number, number] => {
        const width = Math.min(100, nextEnd - nextStart)
        if (nextStart < 0) return [0, width]
        if (nextEnd > 100) return [100 - width, 100]
        return [nextStart, nextEnd]
      }

      if (command === 'pan-left' || command === 'pan-right') {
        const bars = detail.config.panBars * (detail.accelerated ? detail.config.shiftMultiplier : 1)
        const delta = (bars / axisLen) * 100 * (command === 'pan-left' ? -1 : 1)
        ;[start, end] = clampWindow(start + delta, end + delta)
        showHint(`${command === 'pan-left' ? '向左' : '向右'}平移 ${bars} 根`)
      } else if (command === 'zoom-in' || command === 'zoom-out') {
        const percentage = detail.config.zoomPercent * (detail.accelerated ? 2 : 1)
        const factor = command === 'zoom-in' ? 1 - percentage / 100 : 1 + percentage / 100
        const minSpan = (10 / axisLen) * 100
        const nextSpan = Math.max(minSpan, Math.min(100, span * factor))
        const center = (start + end) / 2
        ;[start, end] = clampWindow(center - nextSpan / 2, center + nextSpan / 2)
        showHint(`${command === 'zoom-in' ? '放大' : '缩小'} ${percentage}%`)
      } else if (command === 'latest') {
        end = latestEnd
        start = Math.max(0, end - span)
        showHint('回到最新行情')
      } else if (command === 'future') {
        end = 100
        start = Math.max(0, end - span)
        showHint('右侧半屏留白')
      }
      instance.dispatchAction({ type: 'dataZoom', start, end })
    }
    window.addEventListener(CHART_SHORTCUT_EVENT, onShortcut)
    return () => {
      window.removeEventListener(CHART_SHORTCUT_EVENT, onShortcut)
      if (shortcutHintTimer.current) clearTimeout(shortcutHintTimer.current)
    }
  }, [chart])

  useEffect(() => {
    const c = chart?.current
    if (!c || !onHoverDate) return
    let last = ''
    const onPointer = (payload: unknown): void => {
      const info = payload as { axesInfo?: Array<{ axisIndex?: number; value?: number | string }> }
      const axis = info.axesInfo?.find((item) => (item.axisIndex ?? 0) === 0)
      const raw = axis?.value
      const index = Math.round(Number(raw))
      const date = typeof raw === 'string' && raw.includes('-')
        ? raw.slice(0, 10)
        : dataRef.current?.points?.[index]?.time?.slice(0, 10)
      if (date && date !== last) { last = date; onHoverDate(date) }
    }
    c.on('updateAxisPointer', onPointer)
    return () => { c.off('updateAxisPointer', onPointer) }
  }, [chart, onHoverDate])

  // 记录用户缩放/平移状态（inside 或 slider），供 option 重建时保持
  useEffect(() => {
    const c = chart?.current
    if (!c) return
    const onZoom = (e: unknown) => {
      const event = e as { start?: number; end?: number; batch?: Array<{ start?: number; end?: number }> }
      // slider/inside 在不同 ECharts 路径下可能给直接 start/end，也可能放在 batch[0]。
      const zoom = event.batch?.[0] ?? event
      if (typeof zoom.start === 'number' && dataRef.current) {
        zoomRef.current = { start: zoom.start, end: zoom.end ?? 100, len: dataRef.current.points.length }
        setZoomRevision((value) => value + 1)
      }
    }
    c.on('datazoom', onZoom)
    return () => {
      c.off('datazoom', onZoom)
    }
  }, [chart])

  // 画线鼠标交互（工具激活时）
  useEffect(() => {
    const zr = chart?.current?.getZr()
    if (!zr || !tool) return

    const toCoord = (e: { offsetX: number; offsetY: number }): DrawingPoint | null => {
      if (!chart?.current) return null
      const c = chart.current.convertFromPixel(
        { xAxisIndex: 0, yAxisIndex: 0 },
        [e.offsetX, e.offsetY]
      )
      if (!c) return null
      const idx = Math.round(c[0])
      const t = dataRef.current?.points?.[idx]?.time
      return { x: c[0], y: c[1], ...(t ? { t } : {}) }
    }

    const onDown = (e: { offsetX: number; offsetY: number }): void => {
      const c = toCoord(e)
      if (!c) return
      if (tool === 'hline') {
        // 水平线：点击即画
        onDrawingComplete?.(newDrawing(tool, [c], color, 'manual', scope))
        return
      }
      pendingRef.current = c
      setPreview(null)
    }
    const onMove = (e: { offsetX: number; offsetY: number }): void => {
      const start = pendingRef.current
      if (!start) return
      const current = toCoord(e)
      if (current) setPreview(newDrawing(tool, [start, current], color, 'manual', scope))
    }
    const onUp = (e: { offsetX: number; offsetY: number }): void => {
      const start = pendingRef.current
      if (!start) return
      const current = toCoord(e)
      if (current) onDrawingComplete?.(newDrawing(tool, [start, current], color, 'manual', scope))
      pendingRef.current = null
      setPreview(null)
    }

    zr.on('mousedown', onDown)
    zr.on('mousemove', onMove)
    zr.on('mouseup', onUp)
    return () => {
      zr.off('mousedown', onDown)
      zr.off('mousemove', onMove)
      zr.off('mouseup', onUp)
      pendingRef.current = null
      setPreview(null)
    }
  }, [chart, tool, color, scope, onDrawingComplete])

  const empty = !data || data.points.length === 0
  // 分割把手位置 = legend(28px) + 主图占剩余高度的比例
  const splitTop = 28 + (effPricePct / 100) * restPct * (wrapH / 100) - 5

  return (
    <>
      <div ref={wrapRef} className="chart-resize-wrap">
        <div ref={ref} className={`chart-box kline-chart-box ${tool ? 'drawing-active' : ''}`} />
        {shortcutHint && <div className="chart-shortcut-toast">{shortcutHint}</div>}
        {!empty && !tool && (
          <div
            className="chart-h-split"
            style={{ top: splitTop }}
            onMouseDown={onSplitDrag}
            title="拖拽调整主图/副图高度（↕）"
          />
        )}
      </div>
      {empty && <div className="empty chart-empty-overlay">暂无K线数据</div>}
    </>
  )
}
