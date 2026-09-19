import type { QuantServiceStatus } from '../../shared/types'
import { loadQuantConfig } from './config'

interface ApiEnvelope<T> {
  code: number
  data: T
  message?: string
  total?: number
}

export interface QuantCapabilities {
  connected: true
  baseUrl: string
  checkedAt: number
  dataRange: unknown
  stats: unknown
  engineDocs: unknown
  factors: unknown[]
}

let capabilityCache: { expiresAt: number; value: QuantCapabilities } | null = null

export async function quantRequest<T>(
  pathname: string,
  init: RequestInit = {},
  timeoutOverrideSec?: number
): Promise<T> {
  const cfg = loadQuantConfig()
  if (!cfg.enabled) throw new Error('聚宽本地量化服务未启用，请到设置 → AI 数据与量化服务开启')
  const baseUrl = cfg.baseUrl.replace(/\/$/, '')
  const url = `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), (timeoutOverrideSec ?? cfg.timeoutSec) * 1000)
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
      throw new Error(`量化服务返回了非 JSON 数据（HTTP ${response.status}）`)
    }
    if (!response.ok || envelope.code !== 0) {
      throw new Error(envelope.message || `量化服务请求失败（HTTP ${response.status}）`)
    }
    return envelope.data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`量化服务请求超时（${timeoutOverrideSec ?? cfg.timeoutSec} 秒）`)
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
      throw new Error(`无法连接聚宽本地服务 ${baseUrl}，请先在聚宽-local目录运行 npm start`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function getQuantCapabilities(refresh = false): Promise<QuantCapabilities> {
  if (!refresh && capabilityCache && capabilityCache.expiresAt > Date.now()) return capabilityCache.value
  const cfg = loadQuantConfig()
  const [engineDocs, factors, stats, dataRange] = await Promise.all([
    quantRequest<unknown>('/api/ai/engine-docs'),
    quantRequest<unknown[]>('/api/factors'),
    quantRequest<unknown>('/api/stats'),
    quantRequest<unknown>('/api/calendar/range')
  ])
  const value: QuantCapabilities = {
    connected: true,
    baseUrl: cfg.baseUrl,
    checkedAt: Date.now(),
    dataRange,
    stats,
    engineDocs,
    factors
  }
  capabilityCache = { expiresAt: Date.now() + 10 * 60_000, value }
  return value
}

export function clearQuantCapabilityCache(): void {
  capabilityCache = null
}

export async function testQuantConnection(refresh = true): Promise<QuantServiceStatus> {
  const cfg = loadQuantConfig()
  const started = Date.now()
  try {
    const caps = await getQuantCapabilities(refresh)
    const range = caps.dataRange as Record<string, unknown> | null
    const stats = caps.stats as Record<string, unknown> | null
    const engine = caps.engineDocs as { strategyApi?: Record<string, unknown> } | null
    return {
      connected: true,
      baseUrl: cfg.baseUrl,
      checkedAt: Date.now(),
      latencyMs: Date.now() - started,
      dateFrom: String(range?.min_date ?? range?.minDate ?? '') || null,
      dateTo: String(range?.max_date ?? range?.maxDate ?? '') || null,
      stocksCount: Number(stats?.stocks ?? stats?.stocksCount ?? 0) || undefined,
      factorsCount: caps.factors.length,
      engineApiCount: Object.keys(engine?.strategyApi ?? {}).length
    }
  } catch (error) {
    return {
      connected: false,
      baseUrl: cfg.baseUrl,
      checkedAt: Date.now(),
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
