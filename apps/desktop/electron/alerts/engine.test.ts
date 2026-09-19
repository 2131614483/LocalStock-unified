import { describe, expect, it } from 'vitest'
import { evaluateRule, type AlertRule } from './engine'

const rule = (type: AlertRule['type'], extra: Partial<AlertRule> = {}): AlertRule => ({
  id: 'r1',
  secid: '1.600036',
  name: '测试',
  type,
  enabled: true,
  ...extra
})

describe('预警规则引擎', () => {
  it('price_above：现价高于阈值触发', () => {
    const r = evaluateRule(
      rule('price_above', { threshold: 1200 }),
      [1000, 1100, 1250],
      [1, 1, 1]
    )
    expect(r.fired).toBe(true)
    expect(r.signal).toBe('1250.00>1200')
  })

  it('price_above：低于阈值不触发', () => {
    const r = evaluateRule(
      rule('price_above', { threshold: 1300 }),
      [1000, 1100, 1250],
      [1, 1, 1]
    )
    expect(r.fired).toBe(false)
  })

  it('price_below：现价跌破阈值触发', () => {
    const r = evaluateRule(
      rule('price_below', { threshold: 1050 }),
      [1100, 1080, 1020],
      [1, 1, 1]
    )
    expect(r.fired).toBe(true)
  })

  it('ma_cross 金叉：快线在最后一根上穿慢线', () => {
    // 24 根 10 + 最后一根 100：MA5 从 10 跳到 28，MA20 仅 14.5 → 最后一根金叉
    const closes = [...Array(24).fill(10), 100]
    const r = evaluateRule(rule('ma_cross', { fast: 5, slow: 20 }), closes, closes.map(() => 1))
    expect(r.fired).toBe(true)
    expect(r.signal).toBe('golden5/20')
  })

  it('ma_cross 死叉：快线在最后一根下穿慢线', () => {
    // 24 根 100 + 最后一根 10：MA5 从 100 跳到 28，MA20 仅 85.5 → 最后一根死叉
    const closes = [...Array(24).fill(100), 10]
    const r = evaluateRule(rule('ma_cross', { fast: 5, slow: 20 }), closes, closes.map(() => 1))
    expect(r.fired).toBe(true)
    expect(r.signal).toBe('death5/20')
  })

  it('ma_cross：均线数据不足时不触发', () => {
    const r = evaluateRule(rule('ma_cross', { fast: 5, slow: 20 }), [10, 11, 12], [1, 1, 1])
    expect(r.fired).toBe(false)
  })

  it('volume_spike：末量超过 N 倍均量触发', () => {
    const volumes = [...Array(20).fill(100), 1000] // 21 根：前 20 根均量 100，末量 1000（10 倍）
    const r = evaluateRule(rule('volume_spike', { fast: 20, threshold: 2 }), volumes.map(() => 10), volumes)
    expect(r.fired).toBe(true)
    expect(r.signal).toBe('1000>200')
  })

  it('volume_spike：量能不足不触发', () => {
    const volumes = [...Array(21).fill(100)]
    const r = evaluateRule(rule('volume_spike', { fast: 20, threshold: 2 }), volumes.map(() => 10), volumes)
    expect(r.fired).toBe(false)
  })
})
