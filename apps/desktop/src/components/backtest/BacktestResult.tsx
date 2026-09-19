import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import type { BacktestResult } from '../../../shared/types'
import { useBacktest } from '../../store/backtest'
import { useEChart } from '../../lib/useEChart'
import { CHART_COLORS } from '../../lib/chart-theme'
import ResizableChartShell from '../ResizableChartShell'

const METRICS: Array<{ key: string; label: string; kind: 'pct' | 'num' | 'int' }> = [
  { key: 'totalReturns', label: '总收益', kind: 'pct' },
  { key: 'annualReturns', label: '年化收益', kind: 'pct' },
  { key: 'maxDrawdown', label: '最大回撤', kind: 'pct' },
  { key: 'sharpe', label: '夏普比率', kind: 'num' },
  { key: 'volatility', label: '波动率', kind: 'pct' },
  { key: 'winRate', label: '胜率', kind: 'pct' },
  { key: 'tradesCount', label: '交易次数', kind: 'int' },
  { key: 'benchmarkTotalReturns', label: '基准收益', kind: 'pct' },
  { key: 'alpha', label: 'Alpha', kind: 'num' },
  { key: 'beta', label: 'Beta', kind: 'num' }
]

function fmtMetric(kind: string, v: number | undefined): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '--'
  if (kind === 'pct') return `${(v * 100).toFixed(2)}%`
  if (kind === 'int') return String(Math.round(v))
  return v.toFixed(2)
}

export default function BacktestResult() {
  const result = useBacktest((s) => s.result) as BacktestResult | null
  const [logFilter, setLogFilter] = useState('all')

  // 累计收益曲线（策略 vs 基准）
  const equityOption = useMemo<EChartsOption | null>(() => {
    if (!result?.dailyRecords?.length) return null
    const recs = result.dailyRecords
    const dates = recs.map((r) => r.date)
    const strategy = recs.map((r) => +((r.cumulative_return ?? 0) * 100).toFixed(2))
    let bench: number[] | null = null
    if (result.benchmark?.dates?.length) {
      let cum = 1
      bench = result.benchmark.dates.map((d, i) => {
        cum *= 1 + (result.benchmark!.dailyReturns[i] ?? 0)
        return +((cum - 1) * 100).toFixed(2)
      })
    }
    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: CHART_COLORS.panel2,
        borderColor: CHART_COLORS.border,
        textStyle: { color: CHART_COLORS.text, fontSize: 12 }
      },
      legend: { data: ['策略收益', '基准收益'], top: 0, textStyle: { color: CHART_COLORS.legend, fontSize: 11 } },
      grid: { left: 50, right: 16, top: 30, bottom: 28 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11, hideOverlap: true },
        axisLine: { lineStyle: { color: CHART_COLORS.border } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: CHART_COLORS.panel2 } }
      },
      dataZoom: [{ type: 'inside' }],
      series: [
        {
          name: '策略收益',
          type: 'line',
          data: strategy,
          symbol: 'none',
          lineStyle: { width: 1.5, color: CHART_COLORS.d },
          areaStyle: { color: CHART_COLORS.dzFillerR08 }
        },
        ...(bench
          ? [
              {
                name: '基准收益',
                type: 'line' as const,
                data: bench,
                symbol: 'none',
                lineStyle: { width: 1, color: CHART_COLORS.dea }
              }
            ]
          : [])
      ]
    }
  }, [result])

  // 回撤曲线
  const drawdownOption = useMemo<EChartsOption | null>(() => {
    if (!result?.dailyRecords?.length) return null
    const recs = result.dailyRecords
    let peak = -Infinity
    const dates = recs.map((r) => r.date)
    const dd = recs.map((r) => {
      const cum = r.cumulative_return ?? 0
      peak = Math.max(peak, cum)
      return +((cum - peak) * 100).toFixed(2)
    })
    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: CHART_COLORS.panel2,
        borderColor: CHART_COLORS.border,
        textStyle: { color: CHART_COLORS.text, fontSize: 12 }
      },
      grid: { left: 50, right: 16, top: 20, bottom: 28 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11, hideOverlap: true },
        axisLine: { lineStyle: { color: CHART_COLORS.border } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: CHART_COLORS.axisLabel, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: CHART_COLORS.panel2 } }
      },
      dataZoom: [{ type: 'inside' }],
      series: [
        {
          name: '回撤',
          type: 'line',
          data: dd,
          symbol: 'none',
          lineStyle: { width: 1, color: CHART_COLORS.up },
          areaStyle: { color: CHART_COLORS.upArea15 }
        }
      ]
    }
  }, [result])

  const { ref: equityRef } = useEChart(equityOption)
  const { ref: drawdownRef } = useEChart(drawdownOption)

  if (!result) return null

  const data = result.data ?? {}
  const trades = result.trades ?? []
  const logs = result.logs ?? []
  const visibleLogs = logFilter === 'all' ? logs : logs.filter((l) => l.level === logFilter)

  return (
    <div className="backtest-result">
      <div className="result-head">
        <span className="table-title">回测结果</span>
        <span className="result-message">{result.message || ''}</span>
      </div>

      <div className="metric-grid">
        {METRICS.map((m) => (
          <div key={m.key} className="metric-card">
            <div className="metric-card-label">{m.label}</div>
            <div
              className={`metric-card-value ${
                m.key === 'totalReturns' || m.key === 'annualReturns'
                  ? data[m.key] !== undefined && data[m.key]! >= 0
                    ? 'up'
                    : 'down'
                  : ''
              }`}
            >
              {fmtMetric(m.kind, data[m.key] as number)}
            </div>
          </div>
        ))}
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <div className="chart-head">
            <span className="table-title">累计收益（%）</span>
          </div>
          <ResizableChartShell chartRef={equityRef} />
        </div>
        <div className="chart-card">
          <div className="chart-head">
            <span className="table-title">回撤（%）</span>
          </div>
          <ResizableChartShell chartRef={drawdownRef} />
        </div>
      </div>

      <div className="result-tables">
        <div className="chart-card">
          <div className="chart-head">
            <span className="table-title">交易记录（{trades.length} 笔）</span>
          </div>
          {trades.length === 0 ? (
            <div className="empty">无交易</div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th className="left">日期</th>
                  <th className="left">股票</th>
                  <th className="left">方向</th>
                  <th>价格</th>
                  <th>数量</th>
                  <th>金额</th>
                  <th>手续费</th>
                  <th>盈亏</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(-200).map((t, i) => (
                  <tr key={i}>
                    <td className="left">{t.date}</td>
                    <td className="left">{t.stock}</td>
                    <td className={`left ${t.direction === 'buy' ? 'up' : 'down'}`}>
                      {t.direction === 'buy' ? '买入' : '卖出'}
                    </td>
                    <td>{t.price?.toFixed(2)}</td>
                    <td>{t.volume?.toLocaleString()}</td>
                    <td>{t.amount?.toLocaleString()}</td>
                    <td>{t.commission?.toFixed(2)}</td>
                    <td className={t.profit > 0 ? 'up' : 'down'}>{t.profit?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="chart-card">
          <div className="chart-head">
            <span className="table-title">日志</span>
            <div className="chart-tabs">
              {['all', 'info', 'warning', 'error'].map((lv) => (
                <div
                  key={lv}
                  className={`tab ${logFilter === lv ? 'active' : ''}`}
                  onClick={() => setLogFilter(lv)}
                >
                  {lv === 'all' ? '全部' : lv}
                </div>
              ))}
            </div>
          </div>
          <div className="log-box">
            {visibleLogs.length === 0 ? (
              <div className="empty">无日志</div>
            ) : (
              visibleLogs.map((l, i) => (
                <div key={i} className={`log-line log-${l.level}`}>
                  <span className="log-level">[{l.level}]</span> {l.message}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
