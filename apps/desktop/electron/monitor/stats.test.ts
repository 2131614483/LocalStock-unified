import { describe, expect, it } from 'vitest'
import { computePerHour, computePerStock, computeStats, resolveOutcome } from './stats'

describe('AI 预测命中率判定（resolveOutcome）', () => {
  it('up：实际上涨超过 0.3% 命中，否则落空', () => {
    expect(resolveOutcome('up', 100, 100.4)).toBe('hit')
    expect(resolveOutcome('up', 100, 100.2)).toBe('miss')
    expect(resolveOutcome('up', 100, 99)).toBe('miss')
  })

  it('down：实际下跌超过 0.3% 命中', () => {
    expect(resolveOutcome('down', 100, 99.5)).toBe('hit')
    expect(resolveOutcome('down', 100, 99.9)).toBe('miss')
    expect(resolveOutcome('down', 100, 101)).toBe('miss')
  })

  it('flat：|涨跌| <= 0.5% 命中（震荡判对）', () => {
    expect(resolveOutcome('flat', 100, 100.4)).toBe('hit')
    expect(resolveOutcome('flat', 100, 99.6)).toBe('hit')
    expect(resolveOutcome('flat', 100, 100.6)).toBe('miss')
    expect(resolveOutcome('flat', 100, 99.4)).toBe('miss')
    expect(resolveOutcome('flat', 100, 102)).toBe('miss')
  })

  it('无效参考价/价格判落空', () => {
    expect(resolveOutcome('up', 0, 101)).toBe('miss')
    expect(resolveOutcome('up', 100, NaN)).toBe('miss')
  })
})

describe('computeStats', () => {
  it('统计总数/待定/命中率/各方向/置信', () => {
    const stats = computeStats([
      { direction: 'up', confidence: 0.8, outcome: 'hit' },
      { direction: 'up', confidence: 0.9, outcome: 'hit' },
      { direction: 'down', confidence: 0.7, outcome: 'miss' },
      { direction: 'flat', confidence: 0.5, outcome: 'hit' },
      { direction: 'up', confidence: 0.6, outcome: 'pending' }
    ])
    expect(stats.total).toBe(5)
    expect(stats.pending).toBe(1)
    expect(stats.hit).toBe(3)
    expect(stats.miss).toBe(1)
    expect(stats.accuracy).toBeCloseTo(0.75)
    expect(stats.byDirection.up.accuracy).toBeCloseTo(1)
    expect(stats.byDirection.down.accuracy).toBe(0)
    expect(stats.avgConfidenceHit).toBeCloseTo((0.8 + 0.9 + 0.5) / 3)
    expect(stats.avgConfidenceMiss).toBe(0.7)
  })

  it('无已判定样本时命中率为 0', () => {
    const stats = computeStats([{ direction: 'up', confidence: 0.6, outcome: 'pending' }])
    expect(stats.accuracy).toBe(0)
    expect(stats.hit).toBe(0)
    expect(stats.miss).toBe(0)
  })
})

describe('命中率细分（computePerStock / computePerHour）', () => {
  it('按股票聚合并按次数排序', () => {
    const out = computePerStock([
      { secid: '1.600519', name: '贵州茅台', code: '600519', direction: 'up', confidence: 0.8, outcome: 'hit' },
      { secid: '1.600519', name: '贵州茅台', code: '600519', direction: 'up', confidence: 0.7, outcome: 'miss' },
      { secid: '0.000858', name: '五粮液', code: '000858', direction: 'down', confidence: 0.6, outcome: 'hit' },
      { secid: '1.600519', name: '贵州茅台', code: '600519', direction: 'flat', confidence: 0.5, outcome: 'pending' }
    ])
    expect(out).toHaveLength(2)
    const mt = out.find((x) => x.secid === '1.600519')!
    expect(mt.total).toBe(3)
    expect(mt.hit).toBe(1)
    expect(mt.miss).toBe(1)
    expect(mt.accuracy).toBeCloseTo(0.5)
    const wl = out.find((x) => x.secid === '0.000858')!
    expect(wl.accuracy).toBe(1)
    // 按 total 降序：茅台(4) 在前
    expect(out[0].secid).toBe('1.600519')
  })

  it('按小时聚合并按小时升序', () => {
    const out = computePerHour([
      { hour: 10, direction: 'up', confidence: 0.8, outcome: 'hit' },
      { hour: 9, direction: 'down', confidence: 0.6, outcome: 'hit' },
      { hour: 10, direction: 'up', confidence: 0.7, outcome: 'miss' }
    ])
    expect(out.map((x) => x.hour)).toEqual([9, 10])
    const h10 = out.find((x) => x.hour === 10)!
    expect(h10.total).toBe(2)
    expect(h10.accuracy).toBeCloseTo(0.5)
    const h9 = out.find((x) => x.hour === 9)!
    expect(h9.accuracy).toBe(1)
  })
})
