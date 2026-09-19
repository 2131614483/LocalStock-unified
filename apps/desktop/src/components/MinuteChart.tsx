import { useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import type { Drawing, DrawingPoint, DrawingType, MinuteAnnotation, MinuteResult } from '../../shared/types'
import { useEChart } from '../lib/useEChart'
import { newDrawing } from '../lib/drawing'
import { makeDrawingRenderItem } from '../lib/drawing-render'
import { DOWN_COLOR, UP_COLOR } from '../lib/format'
import { CHART_COLORS } from '../lib/chart-theme'
import { chartIndexFor, minuteTimeAt } from '../../shared/market-session'

const PRICE_COLOR = CHART_COLORS.priceLine
const AVG_COLOR = CHART_COLORS.avg
/** 单日分时固定 240 分钟（09:30~15:00，午休 11:30-13:00 压缩不计宽） */
const DAY_SLOTS = 240
/* 午休压缩轴上 11:30(idx119) 与 13:00(idx120) 相邻，两个都显示会叠字，只留 11:30 */
const SHOW_LABELS = ['09:30', '10:30', '11:30', '14:00', '14:30', '15:00']

interface Props {
  data: MinuteResult | null
  /** AI 预测标注（x=每日分钟序号 0..239，可超出当前数据=未来） */
  annotations?: MinuteAnnotation[]
  drawings?: Drawing[]
  tool?: DrawingType | null
  color?: string
  scope: string
  onDrawingComplete?: (drawing: Drawing) => void
}

export default function MinuteChart({
  data,
  annotations = [],
  drawings = [],
  tool = null,
  color = '#ffffff',
  scope,
  onDrawingComplete
}: Props) {
  // 价格/量能分割可拖拽（↕）
  const [pricePct, setPricePct] = useState(56)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const pendingRef = useRef<DrawingPoint | null>(null)
  const [preview, setPreview] = useState<Drawing | null>(null)
  const renderedDrawings = preview ? [...drawings, preview] : drawings

  const onSplitDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startPct = pricePct
    const move = (ev: MouseEvent): void => {
      const h = wrapRef.current?.offsetHeight ?? 480
      setPricePct(Math.max(35, Math.min(78, startPct + ((ev.clientY - startY) / h) * 100)))
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
    const { points, preClose } = data
    const multiDay = points.some((p) => p.time.includes(' '))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customSeries = (times: string[], anchorIndex: number, anchorY: number): any[] =>
      renderedDrawings.length
        ? [{
            type: 'custom',
            renderItem: makeDrawingRenderItem(times, renderedDrawings),
            data: renderedDrawings.map((drawing) => ({ value: [anchorIndex, anchorY], drawing })),
            encode: { x: 0, y: 1 },
            silent: true,
            z: 50,
            xAxisIndex: 0,
            yAxisIndex: 0
          }]
        : []

    // ---- 单日：固定 240 分钟轴，数据按绝对序号落位（框始终=全天，午休压缩） ----
    if (!multiDay) {
      const labels = Array.from({ length: DAY_SLOTS }, (_, i) => minuteTimeAt(i))
      labels[119] = '11:30'
      labels[239] = '15:00'
      const prices: (number | null)[] = Array(DAY_SLOTS).fill(null)
      const avgs: (number | null)[] = Array(DAY_SLOTS).fill(null)
      const vols: Array<{ value: number | null; itemStyle: { color: string } }> = Array(DAY_SLOTS)
        .fill(null)
        .map(() => ({ value: null, itemStyle: { color: 'transparent' } }))
      const pointAt = new Map<number, (typeof points)[number]>()
      for (const p of points) {
        const idx = chartIndexFor(p.time)
        if (idx < 0 || idx >= DAY_SLOTS) continue
        prices[idx] = p.price
        avgs[idx] = p.avg
        const base = p.preClose ?? preClose
        vols[idx] = { value: p.volume, itemStyle: { color: p.price >= base ? UP_COLOR : DOWN_COLOR } }
        pointAt.set(idx, p)
      }

      // 标注：x 已是绝对分钟序号，直接映射到轴索引
      const validAnn = annotations.filter((a) => Number.isFinite(a.x1) && a.x1 >= 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markLines: any[] = [{ yAxis: preClose, lineStyle: { type: 'dashed', color: CHART_COLORS.axisLabel, width: 1 }, label: { show: false } }]
      // 实时数据截止点标记（盘中说明右侧为未到/未开盘）
      if (pointAt.size > 0) {
        const lastIdx = Math.max(...pointAt.keys())
        if (lastIdx < DAY_SLOTS - 1) {
          markLines.push({
            xAxis: lastIdx,
            lineStyle: { type: 'dashed', color: CHART_COLORS.axisLabel, width: 1 },
            label: { formatter: '实时止于此', color: CHART_COLORS.legend, fontSize: 10, position: 'insideEndTop' }
          })
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markAreas: any[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markPoints: any[] = []
      const idxOf = (x: number): number => Math.max(0, Math.min(DAY_SLOTS - 1, Math.round(x)))
      for (const a of validAnn) {
        const lineStyle = { color: a.color, width: 1.6, type: a.type === 'segment' ? 'solid' : 'dashed' }
        if (a.type === 'markPoint') {
          markPoints.push({ coord: [idxOf(a.x1), a.y1], value: a.label ?? a.y1, itemStyle: { color: a.color } })
        } else if (a.type === 'markArea') {
          markAreas.push([
            { xAxis: idxOf(a.x1), yAxis: a.y1 },
            { xAxis: idxOf(a.x2 ?? a.x1), yAxis: a.y2 ?? a.y1 }
          ])
        } else if (a.type === 'hline') {
          markLines.push({
            yAxis: a.y1,
            lineStyle,
            label: a.label ? { formatter: a.label, color: a.color, position: 'insideEndTop', fontSize: 10 } : { show: false }
          })
        } else {
          markLines.push([
            { xAxis: idxOf(a.x1), yAxis: a.y1 },
            { xAxis: idxOf(a.x2 ?? a.x1), yAxis: a.y2 ?? a.y1 }
          ])
        }
      }

      return {
        animation: false,
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'cross' },
          backgroundColor: CHART_COLORS.panel2,
          borderColor: CHART_COLORS.border,
          textStyle: { color: CHART_COLORS.text, fontSize: 12 },
          formatter: (params: unknown) => {
            const arr = params as Array<{ dataIndex: number }>
            const i = arr[0]?.dataIndex ?? 0
            const p = pointAt.get(i)
            const t = labels[i] ?? ''
            if (!p) return `<div>${t}</div><div>—（未开盘/未到）</div>`
            return (
              `<div>${t}</div>` +
              `<div>价格 ${p.price.toFixed(2)}（${p.price >= preClose ? '+' : ''}${((p.price - preClose) / preClose * 100).toFixed(2)}%）</div>` +
              `<div>均价 ${p.avg.toFixed(2)}</div>` +
              `<div>成交量 ${p.volume}手</div>`
            )
          }
        },
        legend: { data: ['价格', '均价'], top: 0, left: 8, itemWidth: 14, textStyle: { color: CHART_COLORS.legend, fontSize: 11 } },
        grid: [
          { left: 56, right: 16, top: 28, height: `${pricePct}%` },
          { left: 56, right: 16, top: `${2 + pricePct}%`, height: `${76 - pricePct}%` }
        ],
        xAxis: [
          {
            type: 'category',
            gridIndex: 0,
            data: labels,
            boundaryGap: false,
            axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11, interval: (_i: number, v: string) => SHOW_LABELS.includes(v) },
            axisLine: { lineStyle: { color: CHART_COLORS.border } },
            axisTick: { show: false }
          },
          {
            type: 'category',
            gridIndex: 1,
            data: labels,
            axisLabel: { show: false },
            axisLine: { lineStyle: { color: CHART_COLORS.border } },
            axisTick: { show: false }
          }
        ],
        yAxis: [
          { type: 'value', gridIndex: 0, scale: true, axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11 }, splitLine: { lineStyle: { color: CHART_COLORS.panel2 } } },
          { type: 'value', gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } }
        ],
        dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }],
        series: [
          {
            name: '价格',
            type: 'line',
            data: prices,
            symbol: 'none',
            lineStyle: { width: 1, color: PRICE_COLOR },
            areaStyle: {
              color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
                { offset: 0, color: CHART_COLORS.dzFillerR18 },
                { offset: 1, color: CHART_COLORS.dzFillerR02 }
              ] }
            },
            markLine: { silent: true, symbol: 'none', data: markLines },
            markArea: { silent: true, data: markAreas },
            markPoint: {
              symbol: 'pin',
              symbolSize: 44,
              data: markPoints,
              label: { show: true, formatter: (p: { value?: unknown }) => String(p.value ?? ''), fontSize: 10 },
              silent: true
            }
          },
          { name: '均价', type: 'line', data: avgs, symbol: 'none', lineStyle: { width: 1, color: AVG_COLOR } },
          { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: '60%' },
          ...customSeries(labels, Math.floor(DAY_SLOTS / 2), preClose)
        ]
      }
    }

    // ---- 多日分时（5日）：按数据时间轴，不固定 ----
    const times = points.map((p) => p.time)
    const prices = points.map((p) => p.price)
    const avgs = points.map((p) => p.avg)
    const vols = points.map((p) => {
      const base = p.preClose ?? preClose
      return { value: p.volume, itemStyle: { color: p.price >= base ? UP_COLOR : DOWN_COLOR } }
    })
    const labelShow = (v: string): boolean => v.length > 5 && v.endsWith(' 09:30')
    const validAnn = annotations.filter((a) => Number.isFinite(a.x1) && a.x1 >= 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markLines: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markAreas: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markPoints: any[] = []
    const idxOf = (x: number): number => Math.max(0, Math.min(points.length - 1, Math.round(x)))
    for (const a of validAnn) {
      const lineStyle = { color: a.color, width: 1.6, type: a.type === 'segment' ? 'solid' : 'dashed' }
      if (a.type === 'markPoint') markPoints.push({ coord: [idxOf(a.x1), a.y1], value: a.label ?? a.y1, itemStyle: { color: a.color } })
      else if (a.type === 'markArea') markAreas.push([{ xAxis: idxOf(a.x1), yAxis: a.y1 }, { xAxis: idxOf(a.x2 ?? a.x1), yAxis: a.y2 ?? a.y1 }])
      else if (a.type === 'hline') markLines.push({ yAxis: a.y1, lineStyle, label: a.label ? { formatter: a.label, color: a.color, position: 'insideEndTop', fontSize: 10 } : { show: false } })
      else markLines.push([{ xAxis: idxOf(a.x1), yAxis: a.y1 }, { xAxis: idxOf(a.x2 ?? a.x1), yAxis: a.y2 ?? a.y1 }])
    }
    return {
      animation: false,
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
          return (
            `<div>${p.time}</div>` +
            `<div>价格 ${p.price.toFixed(2)}（${p.price >= preClose ? '+' : ''}${((p.price - preClose) / preClose * 100).toFixed(2)}%）</div>` +
            `<div>均价 ${p.avg.toFixed(2)}</div>` +
            `<div>成交量 ${p.volume}手</div>`
          )
        }
      },
      legend: { data: ['价格', '均价'], top: 0, left: 8, itemWidth: 14, textStyle: { color: CHART_COLORS.legend, fontSize: 11 } },
      // 价格/量能分割与单日分支共用 pricePct（可拖拽，↕）；legend 固定 28px
      grid: [
        { left: 56, right: 16, top: 28, height: `${pricePct}%` },
        { left: 56, right: 16, top: `${2 + pricePct}%`, height: `${Math.max(8, 90 - pricePct)}%` }
      ],
      xAxis: [
        { type: 'category', gridIndex: 0, data: times, boundaryGap: false, axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11, interval: (_i: number, v: string) => labelShow(v) }, axisLine: { lineStyle: { color: CHART_COLORS.border } }, axisTick: { show: false } },
        { type: 'category', gridIndex: 1, data: times, axisLabel: { show: false }, axisLine: { lineStyle: { color: CHART_COLORS.border } }, axisTick: { show: false } }
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11 }, splitLine: { lineStyle: { color: CHART_COLORS.panel2 } } },
        { type: 'value', gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } }
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }],
      series: [
        {
          name: '价格',
          type: 'line',
          data: prices,
          symbol: 'none',
          lineStyle: { width: 1, color: PRICE_COLOR },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: CHART_COLORS.dzFillerR18 }, { offset: 1, color: CHART_COLORS.dzFillerR02 }] } },
          markLine: { silent: true, symbol: 'none', data: markLines },
          markArea: { silent: true, data: markAreas },
          markPoint: { symbol: 'pin', symbolSize: 44, data: markPoints, label: { show: true, formatter: (p: { value?: unknown }) => String(p.value ?? ''), fontSize: 10 }, silent: true }
        },
        { name: '均价', type: 'line', data: avgs, symbol: 'none', lineStyle: { width: 1, color: AVG_COLOR } },
        { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: '60%' },
        ...customSeries(times, Math.floor(times.length / 2), prices[Math.floor(prices.length / 2)] ?? preClose)
      ]
    }
  }, [data, annotations, renderedDrawings, pricePct])

  const { ref, chart } = useEChart(option)

  useEffect(() => {
    const zr = chart?.current?.getZr()
    if (!zr || !tool) return

    const toCoord = (event: { offsetX: number; offsetY: number }): DrawingPoint | null => {
      const currentData = dataRef.current
      if (!chart?.current || !currentData?.points.length) return null
      const coord = chart.current.convertFromPixel(
        { xAxisIndex: 0, yAxisIndex: 0 },
        [event.offsetX, event.offsetY]
      )
      if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null
      const index = Math.round(coord[0])
      const multiDay = currentData.points.some((point) => point.time.includes(' '))
      const time = multiDay ? currentData.points[index]?.time : minuteTimeAt(index)
      return { x: coord[0], y: coord[1], ...(time ? { t: time } : {}) }
    }

    const onDown = (event: { offsetX: number; offsetY: number }): void => {
      const point = toCoord(event)
      if (!point) return
      if (tool === 'hline') {
        onDrawingComplete?.(newDrawing(tool, [point], color, 'manual', scope))
        return
      }
      pendingRef.current = point
      setPreview(null)
    }
    const onMove = (event: { offsetX: number; offsetY: number }): void => {
      const start = pendingRef.current
      if (!start) return
      const current = toCoord(event)
      if (current) setPreview(newDrawing(tool, [start, current], color, 'manual', scope))
    }
    const onUp = (event: { offsetX: number; offsetY: number }): void => {
      const start = pendingRef.current
      if (!start) return
      const current = toCoord(event)
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

  return (
    <>
      <div ref={wrapRef} className="chart-resize-wrap">
        <div ref={ref} className={`chart-box ${tool ? 'drawing-active' : ''}`} />
        {!empty && (
          <div
            className="chart-h-split"
            style={{ top: 28 + (pricePct / 100) * (wrapRef.current?.offsetHeight ?? 480) - 5 }}
            onMouseDown={onSplitDrag}
            title="拖拽调整价格/量能高度（↕）"
          />
        )}
      </div>
      {empty && <div className="empty chart-empty-overlay">暂无分时数据</div>}
    </>
  )
}
