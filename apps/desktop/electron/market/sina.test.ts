import { describe, expect, it } from 'vitest'
import { buildMinutePoints, parseSinaJsonp, symbolOf, type SinaMinute } from './minute-sina'

// 两个交易日的逐分钟样本（day, close, volume(股), amount(元)）
const fixture: SinaMinute[] = [
  { day: '2026-08-10 09:30', open: '100', high: '100.5', low: '99.5', close: '100', volume: '10000', amount: '1000000' },
  { day: '2026-08-10 09:31', open: '100', high: '101', low: '99.8', close: '101', volume: '10000', amount: '1010000' },
  { day: '2026-08-11 09:30', open: '102', high: '102.5', low: '101.5', close: '102', volume: '10000', amount: '1020000' },
  { day: '2026-08-11 09:31', open: '102', high: '103', low: '101.8', close: '103', volume: '10000', amount: '1030000' }
]

describe('新浪分钟线契约（JSONP + scale=1）', () => {
  it('北交所代码使用 bj 前缀', () => {
    expect(symbolOf('0.920870')).toBe('bj920870')
    expect(symbolOf('0.000858')).toBe('sz000858')
    expect(symbolOf('1.600519')).toBe('sh600519')
  })

  it('parseSinaJsonp：提取 JSON 数组', () => {
    const arr = parseSinaJsonp(`var _data=(${JSON.stringify(fixture)});`)
    expect(arr).toHaveLength(4)
    expect(arr[0].day).toBe('2026-08-10 09:30')
  })

  it('parseSinaJsonp：无匹配 → []', () => {
    expect(parseSinaJsonp('garbage no jsonp')).toEqual([])
  })

  it('parseSinaJsonp：畸形 JSON → []（解析失败不崩溃）', () => {
    expect(parseSinaJsonp('var _data=({bad json')).toEqual([])
  })

  it('buildMinutePoints：单日（days=1）取最近交易日，股→手、累计均价', () => {
    const { points, lastPreClose, lastDay } = buildMinutePoints(fixture, 1, 100)
    expect(lastDay).toBe('2026-08-11')
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({
      time: '09:30',
      price: 102,
      avg: 102,
      high: 102.5,
      low: 101.5,
      volume: 100, // 10000 股 → 100 手
      amount: 1020000,
      preClose: 100
    })
    // 第二根：累计均价 = (1020000+1030000)/(10000+10000) = 102.5
    expect(points[1].avg).toBe(102.5)
    expect(points[1].preClose).toBe(100)
    expect(lastPreClose).toBe(103)
  })

  it('buildMinutePoints：多日（days=5）点带日期，次日昨收 = 前日最后收盘', () => {
    const { points } = buildMinutePoints(fixture, 5, 100)
    expect(points).toHaveLength(4)
    expect(points[0].time).toBe('08-10 09:30')
    expect(points[0].preClose).toBe(100) // 首日昨收用传入值
    expect(points[2].time).toBe('08-11 09:30')
    expect(points[2].preClose).toBe(101) // 次日昨收 = 08-10 最后收盘 101
  })
})
