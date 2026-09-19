import { describe, expect, it } from 'vitest'
import { buildPredictionFromAnnotations, parseAnnotations } from './minute-ai-parse'

describe('分时预测标注解析（parseAnnotations）', () => {
  it('解析合法标注并保留类型/坐标/标签', () => {
    const r = parseAnnotations(
      {
        opinion: '短期偏弱，关注 38.5 支撑',
        annotations: [
          { type: 'hline', x1: 0, y1: 38.5, label: '支撑' },
          { type: 'segment', x1: 100, y1: 39, x2: 180, y2: 38.6 },
          { type: 'markPoint', x1: 123, y1: 38.2, label: '目标' }
        ]
      },
      120
    )
    expect(r.opinion).toContain('支撑')
    expect(r.annotations).toHaveLength(3)
    expect(r.annotations[0].type).toBe('hline')
    expect(r.annotations[0].y1).toBe(38.5)
    expect(r.annotations[2].type).toBe('markPoint')
  })

  it('坐标越界被 clamp，离谱未来被丢弃', () => {
    const r = parseAnnotations(
      {
        opinion: 'x',
        annotations: [
          { type: 'hline', x1: 300, y1: 40 }, // x>239 → clamp 239，但 239 > nowIdx+4 会被丢弃
          { type: 'hline', x1: 121, y1: 40 } // 仅未来 1 点（nowIdx=120）→ 保留
        ]
      },
      120
    )
    expect(r.annotations).toHaveLength(1)
    expect(r.annotations[0].x1).toBe(121)
  })

  it('非法价格/非数组被跳过或给默认', () => {
    expect(parseAnnotations(null, 0).annotations).toEqual([])
    expect(parseAnnotations({ annotations: 'x' }, 0).annotations).toEqual([])
    const r = parseAnnotations({ annotations: [{ type: 'markPoint', x1: 100, y1: -5 }] }, 0)
    expect(r.annotations).toHaveLength(0)
    const r2 = parseAnnotations({ annotations: [{ x1: 0, y1: 100 }] }, 0)
    expect(r2.annotations[0].type).toBe('hline')
  })
})

describe('分时预测接入监盘统计（buildPredictionFromAnnotations）', () => {
  it('有上方目标 → up，带目标价/支撑阻力', () => {
    const p = buildPredictionFromAnnotations(
      '1.600519',
      '贵州茅台',
      [
        { id: 'a', type: 'markPoint', x1: 200, y1: 1400, color: '#2f81f7', label: '目标' },
        { id: 'b', type: 'hline', x1: 0, y1: 1330, color: '#14b143', label: '支撑' },
        { id: 'c', type: 'hline', x1: 0, y1: 1420, color: '#f5222d', label: '压力' }
      ],
      '看涨至 1400',
      1340
    )
    expect(p.direction).toBe('up')
    expect(p.targetPrice).toBe(1400)
    expect(p.support).toBe(1330)
    expect(p.resistance).toBe(1420)
    expect(p.reason).toContain('看涨')
  })

  it('下方目标更多 → down；无目标仅区间 → flat', () => {
    const down = buildPredictionFromAnnotations(
      '0.000858',
      '五粮液',
      [
        { id: 'a', type: 'markPoint', x1: 220, y1: 120, color: '#2f81f7' },
        { id: 'b', type: 'markPoint', x1: 210, y1: 122, color: '#2f81f7' }
      ],
      '下行',
      125
    )
    expect(down.direction).toBe('down')
    expect(down.targetPrice).toBe(122) // 取下方最高目标

    const flat = buildPredictionFromAnnotations(
      '0.000858',
      '五粮液',
      [{ id: 'a', type: 'hline', x1: 0, y1: 124, color: '#14b143' }],
      '区间震荡',
      125
    )
    expect(flat.direction).toBe('flat')
    expect(flat.support).toBe(124)
    expect(flat.targetPrice).toBeUndefined()
  })
})
