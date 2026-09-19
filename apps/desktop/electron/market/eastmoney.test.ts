import { describe, expect, it } from 'vitest'
import { mapQuote, parseKlines, parseTrends } from './eastmoney'

describe('东财数据源契约', () => {
  it('mapQuote：字段映射 + 单位', () => {
    const q = mapQuote({
      f2: '1346.50',
      f3: '-0.17',
      f4: '-2.36',
      f12: '600519',
      f13: '1',
      f14: '贵州茅台',
      f15: '1355.00',
      f16: '1345.00',
      f17: '1349.00',
      f18: '1348.86',
      f20: '1984500000000',
      f21: '1550000000000',
      f5: '24157',
      f6: '3276129134',
      f7: '1.5',
      f8: '2.40',
      f9: '12.35',
      f10: '0.90',
      f23: '8.40',
      f100: '白酒'
    })
    expect(q).not.toBeNull()
    expect(q!.secid).toBe('1.600519')
    expect(q!.code).toBe('600519')
    expect(q!.name).toBe('贵州茅台')
    expect(q!.price).toBe(1346.5)
    expect(q!.change).toBe(-2.36)
    expect(q!.changePercent).toBe(-0.17)
    expect(q!.open).toBe(1349)
    expect(q!.high).toBe(1355)
    expect(q!.low).toBe(1345)
    expect(q!.preClose).toBe(1348.86)
    expect(q!.volume).toBe(24157)
    expect(q!.amount).toBe(3276129134)
    expect(q!.amplitude).toBe(1.5)
    expect(q!.turnoverRate).toBe(2.4)
    expect(q!.pe).toBe(12.35)
    expect(q!.pb).toBe(8.4)
    expect(q!.volumeRatio).toBe(0.9)
    expect(q!.totalMv).toBe(1984500000000)
    expect(q!.floatMv).toBe(1550000000000)
    expect(q!.industry).toBe('白酒')
  })

  it('mapQuote：缺失字段（-）→ undefined/0，不污染', () => {
    const q = mapQuote({ f2: '-', f14: '某股', f12: '000001', f13: '0' })
    expect(q!.price).toBe(0)
    expect(q!.changePercent).toBe(0)
    expect(q!.pe).toBeUndefined()
    expect(q!.isIndex).toBe(false)
  })

  it('parseKlines：K线行解析', () => {
    const pts = parseKlines(['2026-08-11,1345.00,1346.50,1355.00,1344.00,24157,3276129134'])
    expect(pts.length).toBe(1)
    expect(pts[0]).toEqual({
      time: '2026-08-11',
      open: 1345,
      close: 1346.5,
      high: 1355,
      low: 1344,
      volume: 24157,
      amount: 3276129134
    })
  })

  it('parseKlines：畸形行不崩溃（空 → 0，非法 → NaN）', () => {
    const pts = parseKlines(['2026-08-11,,,,,,', 'bad,,line,1,2,3,4'])
    expect(pts).toHaveLength(2)
    expect(pts[0].open).toBe(0)
    expect(Number.isNaN(pts[1].close)).toBe(true)
  })

  it('parseTrends：分时行解析（时间截到 HH:MM）', () => {
    const pts = parseTrends(['2026-08-11 09:30,1345.00,1344.00,1345.50,1344.00,100,134500'])
    expect(pts[0]).toEqual({
      time: '09:30',
      price: 1345,
      avg: 1344,
      high: 1345.5,
      low: 1344,
      volume: 100,
      amount: 134500
    })
  })
})
