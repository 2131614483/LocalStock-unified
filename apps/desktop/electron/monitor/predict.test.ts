import { describe, expect, it } from 'vitest'
import { parsePredictions } from './predict'

describe('监盘 AI 预测解析（parsePredictions）', () => {
  it('解析合法数组并回填字段', () => {
    const out = parsePredictions({
      predictions: [
        {
          secid: '1.600519',
          direction: 'up',
          confidence: 0.8,
          targetPrice: 1380,
          support: 1330,
          resistance: 1400,
          reason: '放量突破平台'
        }
      ]
    })
    expect(out).toHaveLength(1)
    expect(out[0].direction).toBe('up')
    expect(out[0].confidence).toBe(0.8)
    expect(out[0].reason).toContain('突破')
  })

  it('confidence 越界被 clamp 到 0~1，非法 direction 归为 up', () => {
    const out = parsePredictions({
      predictions: [
        { secid: 'a', direction: 'surge', confidence: 1.8 },
        { secid: 'b', direction: 'down', confidence: -0.5 }
      ]
    })
    expect(out[0].confidence).toBe(1)
    expect(out[0].direction).toBe('up')
    expect(out[1].confidence).toBe(0)
    expect(out[1].direction).toBe('down')
  })

  it('非数组/缺字段被跳过或给默认值', () => {
    expect(parsePredictions(null)).toEqual([])
    expect(parsePredictions({ predictions: 'x' })).toEqual([])
    expect(parsePredictions({ predictions: [null, 'bad'] })).toEqual([])
    const out = parsePredictions({ predictions: [{ secid: 'a' }] })
    expect(out[0].confidence).toBe(0.5)
    expect(out[0].reason).toBe('')
  })

  it('数据不足（非有限数值）的 target/support 丢弃', () => {
    const out = parsePredictions({
      predictions: [{ secid: 'a', direction: 'flat', targetPrice: NaN }]
    })
    expect(out[0].targetPrice).toBeUndefined()
  })
})
