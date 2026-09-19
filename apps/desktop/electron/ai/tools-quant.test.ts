import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn(), capabilities: vi.fn() }))

vi.mock('../quant/config', () => ({
  loadQuantConfig: () => ({ enabled: true, baseUrl: 'http://127.0.0.1:3000', timeoutSec: 30, maxRows: 500 })
}))
vi.mock('../quant/client', () => ({
  quantRequest: (...args: unknown[]) => mocks.request(...args),
  getQuantCapabilities: (...args: unknown[]) => mocks.capabilities(...args)
}))

import { QUANT_READ_TOOLS } from './tools-quant'

function tool(name: string) {
  const found = QUANT_READ_TOOLS.find((item) => item.name === name)
  if (!found) throw new Error(`missing tool ${name}`)
  return found
}

const ctx = { emit: () => {}, refresh: () => {}, pushMinute: () => {} }

describe('AI 聚宽只读领域工具', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.capabilities.mockReset()
  })

  it('能力发现可按 include 只返回需要的数据', async () => {
    mocks.capabilities.mockResolvedValue({
      connected: true,
      baseUrl: 'http://127.0.0.1:3000',
      checkedAt: 1,
      dataRange: { min_date: '1991-06-01' },
      stats: { stocks: 5973 },
      engineDocs: { strategyApi: {} },
      factors: [{ name: 'mom_6m' }]
    })
    const result = await tool('get_quant_capabilities').handler({ include: ['factors'] }, ctx) as Record<string, unknown>
    expect(result.factors).toEqual([{ name: 'mom_6m' }])
    expect(result.engineDocs).toBeUndefined()
  })

  it('历史行情 summary 在主进程计算收益、波动和回撤', async () => {
    mocks.request.mockResolvedValue([
      { trade_date: '2026-01-01', close_price: 10 },
      { trade_date: '2026-01-02', close_price: 12 },
      { trade_date: '2026-01-03', close_price: 9 }
    ])
    const result = await tool('get_historical_market_data').handler({ assetType: 'stock', codes: ['1.600519'], mode: 'summary' }, ctx) as Record<string, Record<string, number>>
    expect(result['600519'].totalReturn).toBeCloseTo(-0.1)
    expect(result['600519'].maxDrawdown).toBeCloseTo(-0.25)
  })

  it('历史字段使用白名单，阻断外部接口的 SQL 字段注入', async () => {
    await expect(tool('get_historical_market_data').handler({
      assetType: 'stock',
      codes: ['600519'],
      fields: ['close_price FROM stock_daily --'],
      mode: 'rows'
    }, ctx)).rejects.toThrow(/不支持的历史字段/)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('回测净值按对齐数组分页且保留指标', async () => {
    mocks.request.mockResolvedValue({
      totalReturns: 0.3,
      dates: ['d1', 'd2', 'd3'],
      dailyReturns: [0.1, 0.2, 0.3],
      cumulativeReturns: [0.1, 0.32, 0.71]
    })
    const result = await tool('get_backtest_result').handler({
      backtestId: '4b091338c82863ae5fa98986a2f2e62d',
      sections: ['returns'],
      offset: 1,
      limit: 1
    }, ctx) as { sections: { returns: { dates: string[]; dailyReturns: number[]; page: { hasMore: boolean } } } }
    expect(result.sections.returns.dates).toEqual(['d2'])
    expect(result.sections.returns.dailyReturns).toEqual([0.2])
    expect(result.sections.returns.page.hasMore).toBe(true)
  })
})
