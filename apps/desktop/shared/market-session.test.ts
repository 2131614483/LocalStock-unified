import { describe, expect, it } from 'vitest'
import { chartIndexFor, getMarketStatus, isIndexSecid, minuteIndexFor, minuteTimeAt } from './market-session'

// 2026-08-12 是周三（工作日）
function at(hour: number, minute: number, day = 12): Date {
  return new Date(2026, 7, day, hour, minute)
}

describe('交易时段判定（getMarketStatus）', () => {
  it('上午交易中：9:30-11:30', () => {
    const s = getMarketStatus(at(10, 0))
    expect(s.phase).toBe('morning')
    expect(s.isTrading).toBe(true)
    expect(s.minutesElapsed).toBe(30)
    expect(s.minutesLeft).toBe(210)
  })

  it('午间休市：11:30-13:00', () => {
    const s = getMarketStatus(at(12, 0))
    expect(s.phase).toBe('lunch')
    expect(s.isTrading).toBe(false)
  })

  it('下午交易中：13:00-15:00，14:30 剩 30 分钟', () => {
    const s = getMarketStatus(at(14, 30))
    expect(s.phase).toBe('afternoon')
    expect(s.isTrading).toBe(true)
    expect(s.minutesLeft).toBe(30)
  })

  it('15:00 收盘：实时数据到此结束', () => {
    const s = getMarketStatus(at(15, 0))
    expect(s.phase).toBe('closed')
    expect(s.isTrading).toBe(false)
    expect(s.minutesElapsed).toBe(240)
    expect(s.minutesLeft).toBe(0)
    expect(s.label).toBe('已收盘')
    expect(s.nextLabel).toContain('次日')
  })

  it('周末休市', () => {
    const s = getMarketStatus(new Date(2026, 7, 15, 10, 0)) // 周六
    expect(s.phase).toBe('weekend')
    expect(s.isTrading).toBe(false)
  })

  it('开盘前', () => {
    const s = getMarketStatus(at(9, 0))
    expect(s.phase).toBe('pre')
    expect(s.isTrading).toBe(false)
  })
})

describe('指数 secid 识别（isIndexSecid）', () => {
  it('识别五大指数与常见指数', () => {
    expect(isIndexSecid('1.000001')).toBe(true) // 上证
    expect(isIndexSecid('1.000300')).toBe(true) // 沪深300
    expect(isIndexSecid('1.000688')).toBe(true) // 科创50
    expect(isIndexSecid('0.399001')).toBe(true) // 深成
    expect(isIndexSecid('0.399006')).toBe(true) // 创业板
  })

  it('个股不被误判为指数', () => {
    expect(isIndexSecid('0.000001')).toBe(false) // 平安银行
    expect(isIndexSecid('1.600519')).toBe(false) // 贵州茅台
    expect(isIndexSecid('0.300750')).toBe(false) // 宁德时代
  })
})

describe('分钟序号换算（跳过午休）', () => {
  it('minuteTimeAt：0→09:30，119→11:29，120→13:00，239→14:59', () => {
    expect(minuteTimeAt(0)).toBe('09:30')
    expect(minuteTimeAt(119)).toBe('11:29')
    expect(minuteTimeAt(120)).toBe('13:00')
    expect(minuteTimeAt(121)).toBe('13:01')
    expect(minuteTimeAt(239)).toBe('14:59')
  })

  it('minuteIndexFor：映射序号；午休/收盘后/开盘前返回 null', () => {
    expect(minuteIndexFor('09:30')).toBe(0)
    expect(minuteIndexFor('11:29')).toBe(119)
    expect(minuteIndexFor('13:00')).toBe(120)
    expect(minuteIndexFor('14:59')).toBe(239)
    expect(minuteIndexFor('11:30')).toBeNull()
    expect(minuteIndexFor('12:00')).toBeNull()
    expect(minuteIndexFor('15:00')).toBeNull()
    expect(minuteIndexFor('16:00')).toBeNull()
  })

  it('chartIndexFor（单日图固定轴）：11:30→119、15:00→239、午休并 119、非法 -1', () => {
    expect(chartIndexFor('09:30')).toBe(0)
    expect(chartIndexFor('11:29')).toBe(119)
    expect(chartIndexFor('11:30')).toBe(119) // 上午收盘并入
    expect(chartIndexFor('12:00')).toBe(119) // 午休并入 119（数据不应存在，容错）
    expect(chartIndexFor('13:00')).toBe(120)
    expect(chartIndexFor('14:59')).toBe(239)
    expect(chartIndexFor('15:00')).toBe(239) // 收盘并入
    expect(chartIndexFor('16:00')).toBe(239) // 收盘后钳到日末（容错）
    expect(chartIndexFor('09:00')).toBe(-1) // 开盘前非法
  })
})
