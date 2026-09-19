import type {
  AiConfig,
  PaAnalyzeRequest,
  PaOfflineExportRequest,
  PaOfflineExportResult,
  PaKlineResult,
  PaServiceStatus,
  PaStreamEvent,
  PaSymbol,
  PaTimeframe
} from '../../shared/types'
import { loadPaConfig } from './config'
import { getPaServerStatus, requirePaBaseUrl } from './server'
import { namedSseEvents } from './sse'

interface ApiEnvelope<T> {
  code: number
  data: T
  message?: string
  total?: number
}

export class PaServiceError extends Error {}

/** 取当前可用地址：配置里的手工覆盖优先，否则用托管的服务进程 */
function requireEnabled(): string {
  const cfg = loadPaConfig()
  if (!cfg.enabled) throw new PaServiceError('价格行为服务未启用')
  return requirePaBaseUrl(cfg.baseUrl)
}

/** 短请求（健康检查/搜索/K线）；分析流式请求不走这里 */
export async function paRequest<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = requireEnabled()
  const cfg = loadPaConfig()
  const url = `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutSec * 1000)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    })
    const text = await response.text()
    let envelope: ApiEnvelope<T>
    try {
      envelope = JSON.parse(text) as ApiEnvelope<T>
    } catch {
      throw new PaServiceError(`价格行为服务返回了非 JSON 数据（HTTP ${response.status}）`)
    }
    if (!response.ok || envelope.code !== 0) {
      throw new PaServiceError(envelope.message || `价格行为服务请求失败（HTTP ${response.status}）`)
    }
    return envelope.data
  } catch (error) {
    if (error instanceof PaServiceError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PaServiceError(`价格行为服务请求超时（${cfg.timeoutSec} 秒）`)
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(message)) {
      throw new PaServiceError(
        `无法连接价格行为服务 ${baseUrl}，请在「价格行为 AI」页检查服务状态或点击重启。`
      )
    }
    throw new PaServiceError(message)
  } finally {
    clearTimeout(timer)
  }
}

export async function testPaConnection(): Promise<PaServiceStatus> {
  const started = Date.now()
  const server = getPaServerStatus()
  const baseUrl = server.baseUrl ?? loadPaConfig().baseUrl ?? ''
  try {
    const data = await paRequest<{
      ok: boolean
      dbPath: string
      symbolCount: number
      timeframes: string[]
    }>('/api/health')
    return {
      connected: true,
      baseUrl,
      checkedAt: Date.now(),
      latencyMs: Date.now() - started,
      dbPath: data.dbPath,
      symbolCount: data.symbolCount,
      timeframes: data.timeframes
    }
  } catch (error) {
    return {
      connected: false,
      baseUrl,
      checkedAt: Date.now(),
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function searchPaSymbols(keyword: string, limit = 50): Promise<PaSymbol[]> {
  const params = new URLSearchParams({ q: keyword ?? '', limit: String(limit) })
  return paRequest<PaSymbol[]>(`/api/symbols?${params.toString()}`)
}

export function getPaKline(
  symbol: string,
  timeframe: PaTimeframe,
  bars: number
): Promise<PaKlineResult> {
  const params = new URLSearchParams({ symbol, timeframe, bars: String(bars) })
  return paRequest<PaKlineResult>(`/api/kline?${params.toString()}`)
}

/** 导出两阶段离线 TXT 包：只读取本地行情和当前版本的策略库，不调用大模型。 */
export function exportPaOffline(req: PaOfflineExportRequest): Promise<PaOfflineExportResult> {
  return paRequest<PaOfflineExportResult>('/api/export-offline', {
    method: 'POST',
    body: JSON.stringify(req)
  })
}

/** 把桌面端 AI 配置映射成服务端 llm 载荷（与 electron/ai/provider.ts 同源） */
function llmPayload(cfg: AiConfig): Record<string, unknown> {
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model
  }
}

const STAGE_EVENT_NAMES = new Set([
  'started',
  'frame_ready',
  'stage_event',
  'stage1_reasoning',
  'stage1_content',
  'stage2_reasoning',
  'stage2_content',
  'prompt',
  'stage2_files',
  'token_update',
  'done',
  'error',
  'closed'
])

function toStreamEvent(name: string, payload: Record<string, unknown>): PaStreamEvent | null {
  if (!STAGE_EVENT_NAMES.has(name)) return null
  switch (name) {
    case 'started':
      return { type: 'started', jobId: String(payload.jobId ?? '') }
    case 'frame_ready':
      return {
        type: 'frame_ready',
        symbol: String(payload.symbol ?? ''),
        name: String(payload.name ?? ''),
        timeframe: String(payload.timeframe ?? ''),
        barCount: Number(payload.barCount ?? 0),
        lastClose: payload.lastClose == null ? null : Number(payload.lastClose)
      }
    case 'stage_event':
      return { type: 'stage_event', event: String(payload.event ?? '') }
    case 'stage1_reasoning':
      return { type: 'stage1_reasoning', text: String(payload.text ?? '') }
    case 'stage1_content':
      return { type: 'stage1_content', text: String(payload.text ?? '') }
    case 'stage2_reasoning':
      return { type: 'stage2_reasoning', text: String(payload.text ?? '') }
    case 'stage2_content':
      return { type: 'stage2_content', text: String(payload.text ?? '') }
    case 'prompt':
      return { type: 'prompt', stage: String(payload.stage ?? ''), text: String(payload.text ?? '') }
    case 'stage2_files':
      return { type: 'stage2_files', files: (payload.files as string[]) ?? [] }
    case 'token_update':
      return { type: 'token_update', totals: (payload as Record<string, unknown>) ?? {} }
    case 'done':
      return { type: 'done', record: (payload.record as never) ?? {} }
    case 'error':
      return {
        type: 'error',
        message: String(payload.message ?? '分析失败'),
        errorType: payload.type ? String(payload.type) : undefined
      }
    case 'closed':
      return { type: 'closed' }
    default:
      return null
  }
}

export interface StreamHandle {
  abort: () => void
}

/**
 * 提交分析并流式回调事件。
 *
 * 不设总超时：本地大模型一次两阶段分析可能耗时数分钟到数十分钟；
 * 由用户显式取消（abort）或服务端结束来终止。
 */
export async function streamPaAnalysis(
  req: PaAnalyzeRequest,
  aiConfig: AiConfig,
  onEvent: (evt: PaStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = requireEnabled()
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ...req, llm: llmPayload(aiConfig) })
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new PaServiceError(text || `价格行为服务返回 HTTP ${response.status}`)
  }
  for await (const msg of namedSseEvents(response)) {
    let payload: Record<string, unknown> = {}
    if (msg.data) {
      try {
        payload = JSON.parse(msg.data) as Record<string, unknown>
      } catch {
        continue
      }
    }
    const evt = toStreamEvent(msg.event, payload)
    if (evt) onEvent(evt)
  }
}
