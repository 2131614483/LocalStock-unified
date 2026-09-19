import { describe, expect, it } from 'vitest'
import {
  evaluateTechnicalFilters,
  isFundamentalFilter,
  isTechnicalFilter,
  type DailyBar
} from './rules'

function barsFromCloses(closes: number[]): DailyBar[] {
  return closes.map((c, i) => ({
    time: `2026-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    close: c,
    high: c,
    low: c,
    volume: 1000 + i,
    amount: (1000 + i) * c
  }))
}

describe('选股技术筛选评估', () => {
  it('分类：ma_cross 是技术面，pe_range 是基本面', () => {
    expect(isTechnicalFilter({ kind: 'ma_cross', fast: 5, slow: 20 })).toBe(true)
    expect(isTechnicalFilter({ kind: 'pe_range', min: 1, max: 40 })).toBe(false)
    expect(isFundamentalFilter({ kind: 'pe_range', min: 1, max: 40 })).toBe(true)
  })

  it('ma_cross：快线上穿慢线触发金叉', () => {
    // 慢线在高位盘整后急跌触底、末日大阳拉起 → 快线在最后一根上穿慢线
    const closes = [20, 20, 20, 20, 20, 20, 20, 20, 5, 5, 5, 5, 5, 5, 25]
    const res = evaluateTechnicalFilters([{ kind: 'ma_cross', fast: 3, slow: 8 }], barsFromCloses(closes))
    expect(res.pass).toBe(true)
    expect(res.reasons[0]).toContain('金叉')
  })

  it('price_breakout：突破 N 日新高', () => {
    const closes = [10, 11, 10.5, 10.8, 10.2, 10.1, 9.9, 12] // 第 8 根突破
    const res = evaluateTechnicalFilters([{ kind: 'price_breakout', lookback: 5 }], barsFromCloses(closes))
    expect(res.pass).toBe(true)
  })

  it('volume_surge：量比超过阈值', () => {
    const bars = barsFromCloses(Array(10).fill(10))
    bars[9] = { ...bars[9], volume: 5000 } // 末日量 5000，前 9 日均量约 1000
    const res = evaluateTechnicalFilters([{ kind: 'volume_surge', ratio: 3 }], bars)
    expect(res.pass).toBe(true)
  })

  it('rsi_range：超卖区间命中', () => {
    // 连续下跌制造低 RSI
    const closes = Array.from({ length: 20 }, (_, i) => 20 - i)
    const res = evaluateTechnicalFilters([{ kind: 'rsi_range', period: 14, max: 30 }], barsFromCloses(closes))
    expect(res.pass).toBe(true)
  })

  it('AND 语义：任一条件不满足即失败', () => {
    const closes = [10, 11, 10.5, 10.8, 10.2, 10.1, 9.9, 12]
    const res = evaluateTechnicalFilters(
      [
        { kind: 'price_breakout', lookback: 5 },
        { kind: 'rsi_range', period: 14, min: 80 } // 必然不满足
      ],
      barsFromCloses(closes)
    )
    expect(res.pass).toBe(false)
  })

  it('数据不足返回不通过', () => {
    const res = evaluateTechnicalFilters([{ kind: 'ma_cross', fast: 5, slow: 20 }], barsFromCloses([1, 2, 3]))
    expect(res.pass).toBe(false)
  })
})
