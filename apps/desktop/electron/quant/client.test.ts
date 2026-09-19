import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: {
    enabled: true,
    baseUrl: 'http://127.0.0.1:3000',
    timeoutSec: 30,
    maxRows: 500
  }
}))

vi.mock('./config', () => ({ loadQuantConfig: () => mocks.config }))

import { clearQuantCapabilityCache, getQuantCapabilities, quantRequest, testQuantConnection } from './client'

describe('聚宽本地 HTTP 客户端', () => {
  beforeEach(() => {
    clearQuantCapabilityCache()
    vi.restoreAllMocks()
  })

  it('校验统一响应并返回 data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { ok: true }, message: 'success' }))))
    await expect(quantRequest('/api/stats')).resolves.toEqual({ ok: true })
  })

  it('把接口错误 message 原样交给 AI 自纠', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: -1, data: null, message: '日期超出数据范围' }), { status: 400 })))
    await expect(quantRequest('/api/test')).rejects.toThrow(/日期超出数据范围/)
  })

  it('一次聚合引擎、因子、统计和日历并缓存', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const data = url.includes('engine-docs') ? { strategyApi: { run_daily: {} } }
        : url.includes('factors') ? [{ name: 'mom_6m' }]
          : url.includes('stats') ? { stocks: 5973 }
            : { min_date: '1991-06-01', max_date: '2026-08-25' }
      return new Response(JSON.stringify({ code: 0, data, message: 'success' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await getQuantCapabilities()
    const second = await getQuantCapabilities()
    expect(first.factors).toHaveLength(1)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('连接检测返回日期、因子和策略 API 数量', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const data = url.includes('engine-docs') ? { strategyApi: { a: {}, b: {} } }
        : url.includes('factors') ? [{ name: 'x' }]
          : url.includes('stats') ? { stocks: 10 }
            : { min_date: '2020-01-01', max_date: '2026-01-01' }
      return new Response(JSON.stringify({ code: 0, data }))
    }))
    const status = await testQuantConnection()
    expect(status).toMatchObject({ connected: true, dateFrom: '2020-01-01', dateTo: '2026-01-01', factorsCount: 1, engineApiCount: 2 })
  })
})
