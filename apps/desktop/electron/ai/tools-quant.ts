import { loadQuantConfig } from '../quant/config'
import { getQuantCapabilities, quantRequest } from '../quant/client'
import type { AiTool } from './tools'

type Section = 'summary' | 'returns' | 'trades' | 'positions' | 'benchmark' | 'logs' | 'code'

const STOCK_FIELDS = new Set([
  'stock_code', 'trade_date', 'open_price', 'high_price', 'low_price', 'close_price',
  'pre_close_price', 'volume', 'amount', 'dretwd', 'adj_close_wd', 'mkt_cap_total'
])

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function normalizeCode(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase()
  const withoutMarket = raw.includes('.') ? raw.split('.').find((part) => /^\d{6}$/.test(part)) ?? '' : raw
  if (!/^\d{6}$/.test(withoutMarket)) throw new Error(`证券代码格式错误: ${raw}（需要 6 位代码/secid/.XSHG 格式）`)
  return withoutMarket
}

function validDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const date = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${field} 必须是 YYYY-MM-DD`)
  return date
}

function paginateArray<T>(items: T[], offset: number, limit: number) {
  return {
    items: items.slice(offset, offset + limit),
    page: { offset, limit, total: items.length, hasMore: offset + limit < items.length }
  }
}

function paginateSeries(value: unknown, offset: number, limit: number): unknown {
  if (Array.isArray(value)) return paginateArray(value, offset, limit)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const dates = Array.isArray(record.dates) ? record.dates : null
  if (!dates) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    result[key] = Array.isArray(item) && item.length === dates.length
      ? item.slice(offset, offset + limit)
      : item
  }
  result.page = { offset, limit, total: dates.length, hasMore: offset + limit < dates.length }
  return result
}

function summarizeRows(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const values = rows
    .map((row) => Number(row.close_price ?? row.close_index ?? row.close ?? row.price))
    .filter(Number.isFinite)
  const dates = rows.map((row) => String(row.trade_date ?? row.date ?? '')).filter(Boolean)
  if (values.length < 2) return { rows: rows.length, dateFrom: dates[0] ?? null, dateTo: dates.at(-1) ?? null }
  const returns: number[] = []
  let peak = values[0]
  let maxDrawdown = 0
  for (let i = 1; i < values.length; i++) {
    returns.push(values[i] / values[i - 1] - 1)
    peak = Math.max(peak, values[i])
    maxDrawdown = Math.min(maxDrawdown, values[i] / peak - 1)
  }
  const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length
  const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  return {
    rows: rows.length,
    dateFrom: dates[0] ?? null,
    dateTo: dates.at(-1) ?? null,
    startClose: values[0],
    endClose: values.at(-1),
    totalReturn: values.at(-1)! / values[0] - 1,
    annualizedVolatility: Math.sqrt(variance) * Math.sqrt(252),
    maxDrawdown
  }
}

const PATHS: Record<Section, (id: string, level?: string) => string> = {
  summary: (id) => `/api/backtest/${encodeURIComponent(id)}/summary`,
  returns: (id) => `/api/backtest/${encodeURIComponent(id)}/returns`,
  trades: (id) => `/api/backtest/${encodeURIComponent(id)}/trades`,
  positions: (id) => `/api/backtest/${encodeURIComponent(id)}/positions`,
  benchmark: (id) => `/api/backtest/${encodeURIComponent(id)}/benchmark`,
  logs: (id, level) => `/api/backtest/${encodeURIComponent(id)}/logs${level ? `?level=${encodeURIComponent(level)}` : ''}`,
  code: (id) => `/api/backtest/${encodeURIComponent(id)}/code`
}

export const QUANT_READ_TOOLS: AiTool[] = [
  {
    name: 'get_quant_capabilities',
    description:
      '读取聚宽本地研究/回测服务能力：数据日期范围、数据库规模、策略 API 规范、口径限制和 25 个因子。写策略或因子研究前应先调用一次；结果缓存 10 分钟。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        include: { type: 'array', items: { type: 'string', enum: ['engine', 'factors', 'stats', 'calendar'] } },
        refresh: { type: 'boolean' }
      }
    },
    handler: async (args) => {
      const caps = await getQuantCapabilities(args.refresh === true)
      const requested = new Set(asStringArray(args.include))
      const all = requested.size === 0
      return {
        connected: true,
        baseUrl: caps.baseUrl,
        checkedAt: caps.checkedAt,
        ...(all || requested.has('calendar') ? { dataRange: caps.dataRange } : {}),
        ...(all || requested.has('stats') ? { stats: caps.stats } : {}),
        ...(all || requested.has('engine') ? { engineDocs: caps.engineDocs } : {}),
        ...(all || requested.has('factors') ? { factors: caps.factors } : {})
      }
    }
  },
  {
    name: 'get_historical_market_data',
    description:
      '从聚宽本地历史库读取股票、指数或交易日历。assetType=stock/index/calendar；mode=summary 默认返回区间收益/波动/回撤摘要，rows 返回分页原始行。股票代码可传 600519、1.600519 或 600519.XSHG。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        assetType: { type: 'string', enum: ['stock', 'index', 'calendar'] },
        codes: { type: 'array', items: { type: 'string' } },
        start: { type: 'string' },
        end: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['summary', 'rows'] },
        offset: { type: 'number' },
        limit: { type: 'number' }
      },
      required: ['assetType']
    },
    handler: async (args) => {
      const cfg = loadQuantConfig()
      const assetType = String(args.assetType)
      if (!['stock', 'index', 'calendar'].includes(assetType)) throw new Error('assetType 必须是 stock/index/calendar')
      const mode = args.mode === 'rows' ? 'rows' : 'summary'
      const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)))
      const limit = Math.max(1, Math.min(cfg.maxRows, Math.floor(Number(args.limit ?? 100))))
      const start = validDate(args.start, 'start')
      const end = validDate(args.end, 'end')
      if (start && end && start > end) throw new Error('start 不能晚于 end')

      if (assetType === 'calendar') {
        if (!start && !end) return quantRequest('/api/calendar/range')
        const fromYear = Number((start ?? end)!.slice(0, 4))
        const toYear = Number((end ?? start)!.slice(0, 4))
        if (toYear - fromYear > 20) throw new Error('交易日历单次查询最多 20 年')
        const days = (await Promise.all(
          Array.from({ length: toYear - fromYear + 1 }, (_, index) => quantRequest<string[]>(`/api/calendar?year=${fromYear + index}`))
        )).flat().filter((date) => (!start || date >= start) && (!end || date <= end))
        return paginateArray(days, offset, limit)
      }

      const codes = asStringArray(args.codes).map(normalizeCode)
      if (!codes.length) throw new Error('codes 至少需要一个证券代码')
      if (codes.length > 50) throw new Error('单次最多查询 50 个证券代码')
      if (codes.length > 1 && (!start || !end)) throw new Error('批量历史查询必须同时提供 start 和 end，避免无界全库读取')
      let data: unknown
      if (assetType === 'index') {
        if (codes.length !== 1) throw new Error('指数历史单次只支持一个代码')
        const query = new URLSearchParams()
        if (start) query.set('start', start)
        if (end) query.set('end', end)
        data = await quantRequest(`/api/index/${codes[0]}/daily?${query}`)
      } else if (codes.length === 1) {
        const query = new URLSearchParams()
        if (start) query.set('start', start)
        if (end) query.set('end', end)
        const fields = asStringArray(args.fields)
        const invalidFields = fields.filter((field) => !STOCK_FIELDS.has(field))
        if (invalidFields.length) throw new Error(`不支持的历史字段: ${invalidFields.join(', ')}`)
        if (fields.length) query.set('fields', fields.join(','))
        data = await quantRequest(`/api/stock/${codes[0]}/daily?${query}`)
      } else {
        data = await quantRequest('/api/stock/batch/daily', {
          method: 'POST',
          body: JSON.stringify({ codes, start, end })
        })
      }

      if (mode === 'summary') {
        if (Array.isArray(data)) return { [codes[0]]: summarizeRows(data as Array<Record<string, unknown>>) }
        const grouped = data as Record<string, Array<Record<string, unknown>>>
        return Object.fromEntries(Object.entries(grouped).map(([code, rows]) => [code, summarizeRows(rows)]))
      }
      const flat = Array.isArray(data)
        ? data
        : Object.entries(data as Record<string, unknown[]>).flatMap(([code, rows]) => rows.map((row) => ({ code, ...(row as object) })))
      return paginateArray(flat, offset, limit)
    }
  },
  {
    name: 'get_backtest_result',
    description:
      '按 backtestId 读取聚宽持久化回测结果。sections 可选 summary/returns/trades/positions/benchmark/logs/code；默认 summary。明细自动分页，避免超出上下文。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        backtestId: { type: 'string' },
        sections: { type: 'array', items: { type: 'string', enum: ['summary', 'returns', 'trades', 'positions', 'benchmark', 'logs', 'code'] } },
        offset: { type: 'number' },
        limit: { type: 'number' },
        level: { type: 'string', enum: ['info', 'warning', 'error'] }
      },
      required: ['backtestId']
    },
    handler: async (args) => {
      const id = String(args.backtestId ?? '').trim()
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new Error('backtestId 格式无效')
      const requested = asStringArray(args.sections)
      const sections = (requested.length ? requested : ['summary']) as Section[]
      if (sections.length > 4) throw new Error('单次最多读取 4 个 section，请分批读取')
      const valid = new Set<Section>(['summary', 'returns', 'trades', 'positions', 'benchmark', 'logs', 'code'])
      if (sections.some((section) => !valid.has(section))) throw new Error('sections 包含未知项')
      const cfg = loadQuantConfig()
      const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)))
      const limit = Math.max(1, Math.min(cfg.maxRows, Math.floor(Number(args.limit ?? 100))))
      const values = await Promise.all(sections.map(async (section) => {
        const value = await quantRequest(PATHS[section](id, String(args.level ?? '')))
        return [section, ['returns', 'trades', 'positions', 'benchmark', 'logs'].includes(section)
          ? paginateSeries(value, offset, limit)
          : value] as const
      }))
      return { backtestId: id, sections: Object.fromEntries(values) }
    }
  }
]
