import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiConfig, PaServerStatus, PaStreamEvent } from '../../shared/types'

const mocks = vi.hoisted(() => ({
  config: { enabled: true, baseUrl: '', timeoutSec: 30 },
  server: {
    state: 'ready',
    baseUrl: 'http://127.0.0.1:3210',
    port: 3210,
    error: null,
    log: [],
    python: 'python',
    serviceDir: '',
    venvDir: '',
    logFile: ''
  } as PaServerStatus
}))

vi.mock('./config', () => ({ loadPaConfig: () => mocks.config }))
vi.mock('./server', () => ({
  getPaServerStatus: () => mocks.server,
  // 与真实实现同语义：手工覆盖优先，否则用托管地址
  requirePaBaseUrl: (override?: string | null) => {
    const manual = override?.trim()
    if (manual) return manual.replace(/\/$/, '')
    if (mocks.server.state === 'ready' && mocks.server.baseUrl) return mocks.server.baseUrl
    throw new Error(mocks.server.error ?? '价格行为服务未运行')
  }
}))

import { PaServiceError, getPaKline, searchPaSymbols, streamPaAnalysis, testPaConnection } from './client'

const AI: AiConfig = {
  provider: 'openai',
  apiKey: '',
  model: 'qwen2.5:7b-instruct',
  baseUrl: 'http://localhost:11434/v1',
  writeMode: 'auto',
  allowWatchlistWrite: false
}

function sse(chunks: string[]): Response {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(enc.encode(chunk))
        c.close()
      }
    }),
    { status: 200 }
  )
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('pa-agent 客户端', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.config = { enabled: true, baseUrl: '', timeoutSec: 30 }
    mocks.server = {
      state: 'ready',
      baseUrl: 'http://127.0.0.1:3210',
      port: 3210,
      error: null,
      log: [],
      python: 'python',
      serviceDir: '',
      venvDir: '',
      logFile: ''
    }
  })

  it('健康检查成功时返回行情库信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          code: 0,
          data: { ok: true, dbPath: 'D:/x/stock_data.db', symbolCount: 5973, timeframes: ['1d'] }
        })
      )
    )
    const status = await testPaConnection()
    expect(status.connected).toBe(true)
    expect(status.symbolCount).toBe(5973)
    expect(status.dbPath).toBe('D:/x/stock_data.db')
    expect(status.baseUrl).toBe('http://127.0.0.1:3210')
  })

  it('健康检查失败时把错误交给界面而非抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed') }))
    const status = await testPaConnection()
    expect(status.connected).toBe(false)
    expect(status.error).toMatch(/无法连接价格行为服务/)
  })

  it('服务未启用时直接抛错', async () => {
    mocks.config = { enabled: false, baseUrl: '', timeoutSec: 30 }
    await expect(searchPaSymbols('600519')).rejects.toThrow(PaServiceError)
  })

  it('托管服务未就绪时抛出服务端给的原因', async () => {
    mocks.server = { ...mocks.server, state: 'no-deps', baseUrl: null, error: '运行环境不完整' }
    await expect(searchPaSymbols('600519')).rejects.toThrow('运行环境不完整')
  })

  it('配置里的手工地址优先于托管地址', async () => {
    mocks.config = { enabled: true, baseUrl: 'http://127.0.0.1:9999', timeoutSec: 30 }
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url))
        return json({ code: 0, data: [] })
      })
    )
    await searchPaSymbols('600519')
    expect(calls[0]).toContain('127.0.0.1:9999')
  })

  it('接口返回 code!==0 时抛出 message 原文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: -1, message: '缺少 symbol 参数' })))
    await expect(getPaKline('', '1d', 100)).rejects.toThrow('缺少 symbol 参数')
  })

  it('搜索与K线走对应的查询参数', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/api/symbols')
        ? json({ code: 0, data: [{ symbol: '600519', name: '贵州茅台' }] })
        : json({ code: 0, data: { symbol: '600519', name: '贵州茅台', timeframe: '1d', bars: [] } })
    )
    vi.stubGlobal('fetch', fetchMock)

    await searchPaSymbols('茅台', 20)
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=%E8%8C%85%E5%8F%B0')
    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=20')

    await getPaKline('600519', '1w', 300)
    expect(String(fetchMock.mock.calls[1][0])).toContain('timeframe=1w')
    expect(String(fetchMock.mock.calls[1][0])).toContain('bars=300')
  })

  it('分析请求把桌面端 AI 配置映射成 llm 载荷', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return sse(['event: closed\ndata: {}\n\n'])
    })
    vi.stubGlobal('fetch', fetchMock)

    await streamPaAnalysis(
      { symbol: '600519', timeframe: '1d', barCount: 60, analysisMode: 'original' },
      AI,
      () => {}
    )

    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.symbol).toBe('600519')
    expect(body.barCount).toBe(60)
    expect(body.llm).toEqual({
      provider: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5:7b-instruct'
    })
  })

  it('把 SSE 事件映射为界面可用的事件对象', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'event: started\ndata: {"jobId":"j1"}\n\n',
          'event: frame_ready\ndata: {"symbol":"600519","name":"贵州茅台","timeframe":"1d","barCount":60,"lastClose":1275.16}\n\n',
          'event: stage_event\ndata: {"event":"Stage1Started"}\n\n',
          'event: stage1_content\ndata: {"text":"第一段"}\n\n',
          'event: stage1_content\ndata: {"text":"第二段"}\n\n',
          'event: stage2_files\ndata: {"files":["下跌通道交易策略.txt"]}\n\n',
          'event: done\ndata: {"record":{"meta":{"symbol":"600519"}}}\n\n',
          'event: closed\ndata: {}\n\n'
        ])
      )
    )

    const events: PaStreamEvent[] = []
    await streamPaAnalysis(
      { symbol: '600519', timeframe: '1d', barCount: 60, analysisMode: 'original' },
      AI,
      (e) => events.push(e)
    )

    expect(events.map((e) => e.type)).toEqual([
      'started',
      'frame_ready',
      'stage_event',
      'stage1_content',
      'stage1_content',
      'stage2_files',
      'done',
      'closed'
    ])
    const frame = events[1] as Extract<PaStreamEvent, { type: 'frame_ready' }>
    expect(frame.name).toBe('贵州茅台')
    expect(frame.lastClose).toBe(1275.16)
    const done = events[6] as Extract<PaStreamEvent, { type: 'done' }>
    expect(done.record.meta?.symbol).toBe('600519')
  })

  it('error 事件保留类型信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse(['event: error\ndata: {"message":"上下文不足","type":"exceed_context_size_error"}\n\n'])
      )
    )
    const events: PaStreamEvent[] = []
    await streamPaAnalysis(
      { symbol: '600519', timeframe: '1d', barCount: 60, analysisMode: 'original' },
      AI,
      (e) => events.push(e)
    )
    expect(events[0]).toEqual({
      type: 'error',
      message: '上下文不足',
      errorType: 'exceed_context_size_error'
    })
  })

  it('未知事件名被忽略，坏 JSON 不中断流', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'event: 未知事件\ndata: {"a":1}\n\n',
          'event: stage1_content\ndata: 这不是JSON\n\n',
          'event: closed\ndata: {}\n\n'
        ])
      )
    )
    const events: PaStreamEvent[] = []
    await streamPaAnalysis(
      { symbol: '600519', timeframe: '1d', barCount: 60, analysisMode: 'original' },
      AI,
      (e) => events.push(e)
    )
    expect(events).toEqual([{ type: 'closed' }])
  })

  it('HTTP 非 200 时抛出服务端返回的文本', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('缺少 symbol（股票代码）', { status: 400 })))
    await expect(
      streamPaAnalysis(
        { symbol: '', timeframe: '1d', barCount: 60, analysisMode: 'original' },
        AI,
        () => {}
      )
    ).rejects.toThrow('缺少 symbol（股票代码）')
  })
})
