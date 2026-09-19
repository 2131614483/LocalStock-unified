import type { SelectionFilter } from '../../shared/types'
import { sma, macd, rsiLast } from './indicators'

/** 扫描用的日线柱（本地 stock_daily，时间升序） */
export interface DailyBar {
  time: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
}

/** 技术面筛选（本地行情库可算）；基本面筛选（PE/PB/市值/行业/换手）需市场快照，单独评估 */
export function isTechnicalFilter(f: SelectionFilter): boolean {
  return !['turnover_range', 'pe_range', 'pb_range', 'mv_range', 'industry_in'].includes(f.kind)
}

export function isFundamentalFilter(f: SelectionFilter): boolean {
  return !isTechnicalFilter(f)
}

export interface FilterEval {
  pass: boolean
  reason?: string
}

/** 评估一条技术筛选（bars 时间升序） */
function evalTechnicalFilter(f: SelectionFilter, bars: DailyBar[]): FilterEval {
  const n = bars.length
  if (n < 5) return { pass: false }
  const closes = bars.map((b) => b.close)
  const volumes = bars.map((b) => b.volume)
  const last = bars[n - 1]

  switch (f.kind) {
    case 'ma_cross': {
      const fast = f.fast
      const slow = f.slow
      const within = f.within ?? 1
      for (let i = 0; i < within; i++) {
        const j = n - 1 - i
        const fj = smaAt(closes, fast, j)
        const sj = smaAt(closes, slow, j)
        const fp = smaAt(closes, fast, j - 1)
        const sp = smaAt(closes, slow, j - 1)
        if (fj !== null && sj !== null && fp !== null && sp !== null && fp <= sp && fj > sj) {
          return { pass: true, reason: `MA${fast}金叉MA${slow}（${i === 0 ? '今日' : `${i}日前`}）` }
        }
      }
      return { pass: false }
    }
    case 'ma_align': {
      const shorts = f.shorts ?? [5, 10]
      const longs = f.longs ?? [20, 60]
      const vals: number[] = []
      const labels: string[] = []
      for (const p of [...shorts, ...longs]) {
        const v = smaAt(closes, p, n - 1)
        if (v === null) return { pass: false }
        vals.push(v)
        labels.push(String(p))
      }
      // 均线按周期升序排列即多头排列
      for (let i = 0; i < vals.length - 1; i++) {
        if (vals[i] <= vals[i + 1]) return { pass: false }
      }
      return { pass: true, reason: `均线多头排列（MA${labels.join('/')}）` }
    }
    case 'price_breakout': {
      const lookback = f.lookback
      const pct = f.pct ?? 0
      if (n <= lookback) return { pass: false }
      const prevHigh = Math.max(...closes.slice(n - 1 - lookback, n - 1))
      const need = prevHigh * (1 + pct / 100)
      if (last.close > need) {
        return { pass: true, reason: `突破近${lookback}日新高（收盘 ${last.close.toFixed(2)}）` }
      }
      return { pass: false }
    }
    case 'volume_surge': {
      if (n < 2) return { pass: false }
      const avg = avgOf(volumes.slice(0, n - 1))
      if (avg <= 0) return { pass: false }
      if (last.volume > avg * f.ratio) {
        return { pass: true, reason: `量比 ${(last.volume / avg).toFixed(1)} 倍` }
      }
      return { pass: false }
    }
    case 'volume_shrink': {
      if (n < 2) return { pass: false }
      const avg = avgOf(volumes.slice(0, n - 1))
      if (avg <= 0) return { pass: false }
      if (last.volume < avg * f.ratio) {
        return { pass: true, reason: `缩量至均量 ${(last.volume / avg).toFixed(2)} 倍` }
      }
      return { pass: false }
    }
    case 'macd_cross': {
      const m = macd(closes, f.fast, f.slow, f.signal)
      const lastDif = m.dif[n - 1]
      const lastDea = m.dea[n - 1]
      const prevDif = m.dif[n - 2]
      const prevDea = m.dea[n - 2]
      if (prevDif <= prevDea && lastDif > lastDea) {
        return { pass: true, reason: `MACD金叉（${f.fast}/${f.slow}/${f.signal}）` }
      }
      if (prevDif >= prevDea && lastDif < lastDea) {
        return { pass: true, reason: `MACD死叉（${f.fast}/${f.slow}/${f.signal}）` }
      }
      return { pass: false }
    }
    case 'rsi_range': {
      const r = rsiLast(closes, f.period ?? 14)
      if (r === null) return { pass: false }
      const minOk = f.min === undefined || r >= f.min
      const maxOk = f.max === undefined || r <= f.max
      if (minOk && maxOk) return { pass: true, reason: `RSI${f.period ?? 14}=${r.toFixed(1)}` }
      return { pass: false }
    }
    case 'change_pct_range': {
      if (n < 2) return { pass: false }
      const pre = bars[n - 2].close
      if (pre <= 0) return { pass: false }
      const pct = ((last.close - pre) / pre) * 100
      const minOk = f.min === undefined || pct >= f.min
      const maxOk = f.max === undefined || pct <= f.max
      if (minOk && maxOk) return { pass: true, reason: `涨幅 ${pct.toFixed(2)}%` }
      return { pass: false }
    }
    case 'amount_range': {
      const a = last.amount
      const minOk = f.min === undefined || a >= f.min
      const maxOk = f.max === undefined || a <= f.max
      if (minOk && maxOk) {
        return { pass: true, reason: `成交额 ${(a / 1e8).toFixed(2)} 亿` }
      }
      return { pass: false }
    }
    default:
      return { pass: true } // 基本面筛选由主进程单独评估
  }
}

/** 评估一条基本面筛选（quote 为市场快照） */
export function evalFundamentalFilter(
  f: SelectionFilter,
  quote: { price?: number; turnoverRate?: number; pe?: number; pb?: number; totalMv?: number; floatMv?: number; industry?: string }
): FilterEval {
  switch (f.kind) {
    case 'turnover_range': {
      const v = quote.turnoverRate
      if (v === undefined) return { pass: true } // 快照缺该字段则不拦截
      if ((f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)) {
        return { pass: true, reason: `换手 ${v.toFixed(2)}%` }
      }
      return { pass: false }
    }
    case 'pe_range': {
      const v = quote.pe
      if (v === undefined || v <= 0) return { pass: false }
      if ((f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)) {
        return { pass: true, reason: `PE ${v.toFixed(1)}` }
      }
      return { pass: false }
    }
    case 'pb_range': {
      const v = quote.pb
      if (v === undefined || v <= 0) return { pass: false }
      if ((f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)) {
        return { pass: true, reason: `PB ${v.toFixed(2)}` }
      }
      return { pass: false }
    }
    case 'mv_range': {
      const v = quote.totalMv ?? quote.floatMv
      if (v === undefined) return { pass: true }
      if ((f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)) {
        return { pass: true, reason: `市值 ${(v / 1e8).toFixed(1)} 亿` }
      }
      return { pass: false }
    }
    case 'industry_in': {
      const v = quote.industry
      if (v === undefined) return { pass: true }
      if (f.list.includes(v)) return { pass: true, reason: `行业 ${v}` }
      return { pass: false }
    }
    default:
      return { pass: true }
  }
}

/** 评估全部技术筛选（AND），返回命中的理由列表 */
export function evaluateTechnicalFilters(
  filters: SelectionFilter[],
  bars: DailyBar[]
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = []
  for (const f of filters) {
    if (!isTechnicalFilter(f)) continue
    const r = evalTechnicalFilter(f, bars)
    if (!r.pass) return { pass: false, reasons: [] }
    if (r.reason) reasons.push(r.reason)
  }
  return { pass: true, reasons }
}

function smaAt(values: number[], n: number, idx: number): number | null {
  if (idx + 1 < n) return null
  let sum = 0
  for (let i = idx - n + 1; i <= idx; i++) sum += values[i]
  return sum / n
}

function avgOf(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}
