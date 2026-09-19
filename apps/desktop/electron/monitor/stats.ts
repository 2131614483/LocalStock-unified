import type { MonitorPredictionStats, PerHourStat, PerStockStat, StockPrediction } from '../../shared/types'

/**
 * AI 预测命中率：纯函数（可单测）。
 * 判定规则：
 *  - up   ：实际价较参考价上涨超过 band → 命中
 *  - down ：下跌超过 band → 命中
 *  - flat ：|涨跌| <= 0.5% → 命中（震荡判对）
 */

export const DIRECTION_BAND_PCT = 0.3
export const FLAT_BAND_PCT = 0.5

export type PredictionOutcome = 'pending' | 'hit' | 'miss'

export function resolveOutcome(
  direction: StockPrediction['direction'],
  refPrice: number,
  actualPrice: number
): 'hit' | 'miss' {
  if (!refPrice || refPrice <= 0 || !Number.isFinite(actualPrice)) return 'miss'
  const move = ((actualPrice - refPrice) / refPrice) * 100
  if (direction === 'up') return move > DIRECTION_BAND_PCT ? 'hit' : 'miss'
  if (direction === 'down') return move < -DIRECTION_BAND_PCT ? 'hit' : 'miss'
  return Math.abs(move) <= FLAT_BAND_PCT ? 'hit' : 'miss'
}

export interface HistoryRow {
  direction: 'up' | 'down' | 'flat'
  confidence: number
  outcome: 'pending' | 'hit' | 'miss'
}

export function computeStats(rows: HistoryRow[]): MonitorPredictionStats {
  const resolved = rows.filter((r) => r.outcome === 'hit' || r.outcome === 'miss')
  const hit = resolved.filter((r) => r.outcome === 'hit').length
  const miss = resolved.filter((r) => r.outcome === 'miss').length
  const byDirection: MonitorPredictionStats['byDirection'] = {
    up: { total: 0, hit: 0, accuracy: 0 },
    down: { total: 0, hit: 0, accuracy: 0 },
    flat: { total: 0, hit: 0, accuracy: 0 }
  }
  for (const d of ['up', 'down', 'flat'] as const) {
    const grp = resolved.filter((r) => r.direction === d)
    byDirection[d].total = grp.length
    byDirection[d].hit = grp.filter((r) => r.outcome === 'hit').length
    byDirection[d].accuracy = grp.length ? byDirection[d].hit / grp.length : 0
  }
  const confOf = (o: 'hit' | 'miss'): number => {
    const grp = resolved.filter((r) => r.outcome === o)
    if (!grp.length) return 0
    return grp.reduce((s, r) => s + (Number.isFinite(r.confidence) ? r.confidence : 0), 0) / grp.length
  }
  return {
    total: rows.length,
    pending: rows.length - resolved.length,
    hit,
    miss,
    accuracy: hit + miss ? hit / (hit + miss) : 0,
    byDirection,
    avgConfidenceHit: confOf('hit'),
    avgConfidenceMiss: confOf('miss')
  }
}

/** 命中率按股票细分（已判定样本） */
export function computePerStock(
  rows: Array<{
    secid: string
    name: string
    code: string
    direction: 'up' | 'down' | 'flat'
    confidence: number
    outcome: 'pending' | 'hit' | 'miss'
  }>
): PerStockStat[] {
  const groups = new Map<string, { name: string; code: string; rows: typeof rows }>()
  for (const r of rows) {
    let g = groups.get(r.secid)
    if (!g) {
      g = { name: r.name, code: r.code, rows: [] }
      groups.set(r.secid, g)
    }
    g.rows.push(r)
  }
  const out: PerStockStat[] = []
  for (const [secid, g] of groups) {
    const s = computeStats(g.rows)
    out.push({
      secid,
      name: g.name || g.code || secid,
      code: g.code,
      total: s.total,
      hit: s.hit,
      miss: s.miss,
      accuracy: s.accuracy
    })
  }
  return out.sort((a, b) => b.total - a.total).slice(0, 20)
}

/** 命中率按小时（预测发起时刻）统计 */
export function computePerHour(
  rows: Array<{
    hour: number
    direction: 'up' | 'down' | 'flat'
    confidence: number
    outcome: 'pending' | 'hit' | 'miss'
  }>
): PerHourStat[] {
  const groups = new Map<number, typeof rows>()
  for (const r of rows) {
    let arr = groups.get(r.hour)
    if (!arr) {
      arr = []
      groups.set(r.hour, arr)
    }
    arr.push(r)
  }
  const out: PerHourStat[] = []
  for (const [hour, g] of groups) {
    const s = computeStats(g)
    out.push({ hour, total: s.total, hit: s.hit, miss: s.miss, accuracy: s.accuracy })
  }
  return out.sort((a, b) => a.hour - b.hour)
}
