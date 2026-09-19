import type { AiToolCall } from '../../shared/types'
import { getQuotesSafe } from '../market/quotes'
import { searchStocks, getMarketList } from '../market/eastmoney'
import { getOrderBook } from '../market/tencent'
import { getLocalMarketListAsync } from '../market/sqlite-worker-client'
import { resolveKline } from '../market/kline-resolver'
import { resolveMinute } from '../market/minute-resolver'
import { getDrawings, getSetting, listWatchlist } from '../db'
import { listAlertRules } from '../alerts'
import { getDataStatus, listStrategyTemplates } from '../backtest'
import { getDataCatalog, queryReadOnly } from './query-db'
import { analyzeMinute } from '../minute-ai'
import { WRITE_TOOLS } from './tools-write'
import { SELECTION_READ_TOOLS } from './tools-selection'
import type { LlmTool } from './types'
import { QUANT_READ_TOOLS } from './tools-quant'
import { STRATEGY_KNOWLEDGE_TOOLS } from './strategy-knowledge'

/** 工具执行上下文（写入工具记录审计、推送状态等；只读工具只用 emit） */
export interface ToolCtx {
  emit(call: AiToolCall): void
  /** 写操作后推送 ai:refresh，让渲染层刷新回测代码/画线/审计列表 */
  refresh(): void
  /** 推送分时标注到渲染层（apply_minute_annotations 用） */
  pushMinute(secid: string): void
}

export interface AiTool extends LlmTool {
  permission: 'read' | 'write'
  handler(args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown>
}

/** 由 handler 抛错或返回对象统一序列化成工具结果（agent 回填给 LLM） */
export async function runTool(
  tool: AiTool,
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<{ content: string; isError: boolean }> {
  try {
    const result = await tool.handler(args, ctx)
    return { content: JSON.stringify(result), isError: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: JSON.stringify({ error: msg }), isError: true }
  }
}

const READ_TOOLS: AiTool[] = [
  {
    name: 'get_data_catalog',
    description: '动态读取本地 SQLite 的真实表名与字段定义，不返回数据值。database 为 stock_data 或 localstock；可选 table 查看单表。查询陌生数据前优先调用，避免猜字段。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        database: { type: 'string', enum: ['stock_data', 'localstock'] },
        table: { type: 'string' }
      },
      required: ['database']
    },
    handler: async (a) => getDataCatalog(a.database as 'stock_data' | 'localstock', a.table ? String(a.table) : undefined)
  },
  {
    name: 'get_quotes',
    description:
      '获取实时行情快照（现价/涨跌/量额/市盈率/总市值/行业等）。参数 secids 为证券代码数组，如 ["1.600519","0.000858"]（市场.代码）。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { secids: { type: 'array', items: { type: 'string' }, description: 'secid 数组' } },
      required: ['secids']
    },
    handler: async (a) => getQuotesSafe(asStrArray(a.secids))
  },
  {
    name: 'search_stock',
    description: '按代码/名称/拼音搜索 A 股股票，返回 { code, name, secid, type } 列表。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { keyword: { type: 'string' } },
      required: ['keyword']
    },
    handler: async (a) => searchStocks(String(a.keyword ?? ''))
  },
  {
    name: 'get_kline',
    description:
      '获取 K 线。klt 周期：1/5/15/30/60/120=分钟线，101=日K，102=周K，103=月K，104=季K；fqt 复权：0=不复权 1=前复权 2=后复权。返回 { time, open, close, high, low, volume, amount }[]。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        secid: { type: 'string' },
        klt: { type: 'number' },
        fqt: { type: 'number' }
      },
      required: ['secid', 'klt', 'fqt']
    },
    handler: async (a) => resolveKline(String(a.secid), Number(a.klt ?? 101), Number(a.fqt ?? 1))
  },
  {
    name: 'get_minute',
    description: '获取分时数据（当日逐分钟；days=5 可拿最近 5 个交易日）。返回 { time, price, avg, volume, amount }[]。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { secid: { type: 'string' }, days: { type: 'number' } },
      required: ['secid']
    },
    handler: async (a) => resolveMinute(String(a.secid), Number(a.days ?? 1))
  },
  {
    name: 'get_orderbook',
    description: '获取盘口五档（买一~五/卖一~五 + 现价 + 市盈率/市值等）。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { secid: { type: 'string' } },
      required: ['secid']
    },
    handler: async (a) => getOrderBook(String(a.secid))
  },
  {
    name: 'get_market_list',
    description:
      '获取沪深 A 股市场列表（分页，默认按涨跌幅排序）。fid 排序字段：f3=涨跌幅 f6=成交额 f5=成交量 f2=现价 f12=代码；pn 页码从 1 开始，pz 每页条数。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        pn: { type: 'number' },
        pz: { type: 'number' },
        fid: { type: 'string' },
        order: { type: 'string', enum: ['asc', 'desc'] }
      }
    },
    handler: async (a) => {
      const params = {
        pn: Number(a.pn ?? 1),
        pz: Number(a.pz ?? 50),
        fid: String(a.fid ?? 'f3'),
        order: (a.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
      }
      const local = await getLocalMarketListAsync(params)
      if (local) return local
      return getMarketList(params)
    }
  },
  {
    name: 'get_watchlist',
    description: '获取自选股列表 { secid, code, name }[]。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listWatchlist()
  },
  {
    name: 'get_drawings',
    description: '获取某只股票的画线数据（当前 + 历史版本）。secid 如 "1.600519"。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { secid: { type: 'string' } },
      required: ['secid']
    },
    handler: async (a) => getDrawings(String(a.secid))
  },
  {
    name: 'get_alert_rules',
    description: '获取预警规则列表。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listAlertRules()
  },
  {
    name: 'get_data_status',
    description: '获取本地行情库状态（是否就绪、股票数、日线行数、数据日期范围）。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => getDataStatus()
  },
  {
    name: 'get_strategy_code',
    description: '获取回测页当前保存的策略 Python 代码。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => getSetting('backtest.code')
  },
  {
    name: 'list_strategy_templates',
    description: '获取内置量化策略模板（买入持有/双均线/布林带/海龟等）的 Python 代码。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listStrategyTemplates()
  },
  {
    name: 'query_db',
    description:
      '只读 SQL 查询，可读任何库内数据（覆盖所有信息）。database 取 "stock_data"（本地行情库）或 "localstock"（应用库）。仅支持单条 SELECT，自动限制行数。\n'
      + 'stock_data 库常用表与列：stocks(stock_code, market_type, market_name, name, first_trade_date, last_trade_date, status)；'
      + 'stock_daily(stock_code, trade_date, open_price, high_price, low_price, close_price, pre_close_price, volume, amount, dretwd, adj_close_wd)；'
      + 'trade_calendar(trade_date, is_trading_day)；index_daily(index_code, trade_date, close_index)；stock_minute(stock_code, trade_date, trade_time, price, avg, volume, amount)。\n'
      + 'localstock 库常用表：watchlist(secid, code, name, sort_order)；settings 仅允许读取 key（value 受敏感信息保护）；drawings(secid, data, version)；alert_rules(id, secid, name, type, ...)；'
      + 'quote_history(secid, price, change_percent, volume, amount, ts)；ai_predictions(secid, prediction)；prediction_history(secid, direction, confidence, ...)。\n'
      + '股票代码统一 6 位（如 600519），不带 .XSHG 后缀。若报 "no such column"，错误里会附带可用表与列名，据此修正重试。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        database: { type: 'string', enum: ['stock_data', 'localstock'] },
        sql: { type: 'string' }
      },
      required: ['database', 'sql']
    },
    handler: async (a) =>
      queryReadOnly(a.database as 'stock_data' | 'localstock', String(a.sql))
  },
  {
    name: 'minute_analyze',
    description:
      '分析某股票的当日分时走势并生成画线预测（支撑/压力/目标/趋势）。返回 { opinion, annotations }，annotations 坐标 x=每日分钟序号 0..239、y=价格。intent 可指定分析目标（如「预测收盘」「支撑压力」「剩余走势」「次日」）。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        secid: { type: 'string' },
        intent: { type: 'string' }
      },
      required: ['secid']
    },
    handler: async (a) => analyzeMinute(String(a.secid), String(a.intent ?? ''))
  },
  ...SELECTION_READ_TOOLS,
  ...QUANT_READ_TOOLS,
  ...STRATEGY_KNOWLEDGE_TOOLS
]

export function allTools(): AiTool[] {
  return [...READ_TOOLS, ...WRITE_TOOLS]
}

export function llmTools(permission: 'read' | 'write' | 'all' = 'all'): LlmTool[] {
  return allTools()
    .filter((t) => permission === 'all' || t.permission === permission)
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}

export function findTool(name: string): AiTool | undefined {
  return allTools().find((t) => t.name === name)
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : []
}
