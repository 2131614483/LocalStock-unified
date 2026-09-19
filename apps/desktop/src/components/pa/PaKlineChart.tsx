import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import type { PaKlineResult, PaTradeDecision } from '../../../shared/types'
import { useEChart } from '../../lib/useEChart'
import { CHART_COLORS } from '../../lib/chart-theme'

interface Props {
  kline: PaKlineResult | null
  loading?: boolean
  /** 来自阶段二决策的参考线 */
  decision?: PaTradeDecision | null
}

const EMA_PERIOD = 20
const MA_COLORS = [CHART_COLORS.ma[0], CHART_COLORS.ma[1]]

/** 指数移动平均；窗口未满返回 null */
function calcEMA(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const out: (number | null)[] = []
  let prev: number | null = null
  values.forEach((v, i) => {
    if (i < period - 1) {
      out.push(null)
      return
    }
    if (prev === null) {
      // 首值用前 period 个的简单平均做种子
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += values[j]
      prev = sum / period
    } else {
      prev = v * k + prev * (1 - k)
    }
    out.push(Number(prev.toFixed(3)))
  })
  return out
}

const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(2)

export default function PaKlineChart({ kline, loading, decision }: Props) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!kline || kline.bars.length === 0) return null
    const bars = kline.bars
    const times = bars.map((b) => b.time)
    const candles = bars.map((b) => [b.open, b.close, b.low, b.high])
    const closes = bars.map((b) => b.close)
    const volumes = bars.map((b, i) => ({
      value: b.volume,
      itemStyle: {
        color: b.close >= b.open ? CHART_COLORS.up : CHART_COLORS.down,
        opacity: 0.55
      },
      // 用索引占位，保证与蜡烛对齐
      name: String(i)
    }))

    const ema20 = calcEMA(closes, EMA_PERIOD)

    // 阶段二给出的入场/止盈/止损参考线（价格可能为 null）
    const refLines: { label: string; price: number; color: string }[] = []
    if (decision) {
      const push = (label: string, price: number | null | undefined, color: string): void => {
        if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
          refLines.push({ label, price, color })
        }
      }
      push('入场', decision.entry_price, CHART_COLORS.ma[1])
      push('止盈', decision.take_profit_price, CHART_COLORS.up)
      push('止损', decision.stop_loss_price, CHART_COLORS.down)
    }

    const markLines = refLines.map((l) => ({
      yAxis: l.price,
      label: {
        formatter: `${l.label} ${l.price.toFixed(2)}`,
        position: 'insideEndTop' as const,
        color: l.color,
        fontSize: 10
      },
      lineStyle: { color: l.color, type: 'dashed' as const, width: 1 }
    }))

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: [
        { left: 52, right: 16, top: 12, height: '62%' },
        { left: 52, right: 16, top: '78%', height: '15%' }
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: CHART_COLORS.panel2 } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: CHART_COLORS.tooltipBg,
        borderColor: CHART_COLORS.tooltipBorder,
        textStyle: { color: CHART_COLORS.text, fontSize: 11 }
      },
      legend: {
        data: [`EMA${EMA_PERIOD}`],
        top: 0,
        right: 12,
        textStyle: { color: CHART_COLORS.legend, fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8
      },
      xAxis: [
        {
          type: 'category',
          data: times,
          gridIndex: 0,
          boundaryGap: true,
          axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
          axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 10 },
          splitLine: { show: false }
        },
        {
          type: 'category',
          data: times,
          gridIndex: 1,
          axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
          axisLabel: { show: false },
          splitLine: { show: false }
        }
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
          axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 10 },
          splitLine: { lineStyle: { color: CHART_COLORS.splitLine } }
        },
        {
          gridIndex: 1,
          axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
          axisLabel: { show: false },
          splitLine: { show: false }
        }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 55, end: 100 },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          bottom: 4,
          height: 16,
          start: 55,
          end: 100,
          backgroundColor: CHART_COLORS.dzBg,
          fillerColor: CHART_COLORS.dzFiller,
          handleStyle: { color: CHART_COLORS.dzHandle },
          borderColor: CHART_COLORS.border,
          textStyle: { color: CHART_COLORS.axisLabel, fontSize: 9 }
        }
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: candles,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: CHART_COLORS.up,
            color0: CHART_COLORS.down,
            borderColor: CHART_COLORS.up,
            borderColor0: CHART_COLORS.down
          },
          markLine: markLines.length
            ? {
                symbol: 'none',
                silent: true,
                data: markLines
              }
            : undefined
        },
        {
          name: `EMA${EMA_PERIOD}`,
          type: 'line',
          data: ema20,
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.4, color: MA_COLORS[0] },
          itemStyle: { color: MA_COLORS[0] }
        },
        {
          name: '成交量',
          type: 'bar',
          data: volumes,
          xAxisIndex: 1,
          yAxisIndex: 1,
          barWidth: '60%'
        }
      ]
    }
  }, [kline, decision])

  const { ref } = useEChart(option)

  // 注意：图表容器必须始终挂载。useEChart 只在 mount 时 init 一次，
  // 若数据未到时提前 return 掉容器，ref 为 null 且后续不会再 init，
  // 数据到达后 canvas 永远不出现。因此空态只换文案，不换结构。
  const empty = !kline || kline.bars.length === 0
  const last = empty ? null : kline!.bars[kline!.bars.length - 1]

  return (
    <div className="chart-box pa-chart">
      <div className="pa-chart-head">
        {empty ? (
          <span className="pa-chart-empty-hint">
            {loading ? '加载行情…' : '选择股票后点击「开始分析」'}
          </span>
        ) : (
          <>
            <strong>{kline!.name || kline!.symbol}</strong>
            <span className="pa-chart-code">{kline!.symbol}</span>
            <span className="pa-chart-price">{fmt(last!.close)}</span>
            <span className="pa-chart-meta">
              {kline!.timeframe} · 共 {kline!.bars.length} 根 · 最新 {last!.time}
            </span>
          </>
        )}
      </div>
      <div ref={ref} className="pa-chart-canvas" />
    </div>
  )
}
