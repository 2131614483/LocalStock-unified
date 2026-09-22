import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import type { MarketCategory, MarketListParams, MarketListResult, Quote } from '../../shared/types'
import { getDbPath } from './db-path'

/** 沪深A股列表本地化：从 stock_data.db 生成（每只股票最新日线），不依赖东财接口 */
let conn: Database.Database | null = null

function getConn(): Database.Database | null {
  if (conn) return conn
  const db = getDbPath()
  if (!db || !existsSync(db)) return null
  try {
    conn = new Database(db, { readonly: true })
    return conn
  } catch {
    return null
  }
}

/** 6 位代码 → 东财市场前缀（secid） */
function secidOf(code: string): string {
  // 上海股票、ETF 和 B 股分别常以 6/5/9 开头；其余 A 股、ETF、B 股归深市。
  return (/^[569]/.test(code) ? '1' : '0') + '.' + code
}

/** 按 secid 从本地库构建最新快照，供在线源缺股/离线时兜底。 */
export function getLocalQuotes(secids: string[]): Quote[] {
  const c = getConn()
  if (!c || !secids.length) return []
  const fundInfoJoin = hasFundInfo(c) ? 'LEFT JOIN fund_info i ON i.fund_code=d.fund_code' : ''
  const fundNameField = fundInfoJoin ? 'i.name AS name,' : 'NULL AS name,'
  const selectStock = c.prepare(
    `SELECT s.stock_code, s.name, d.trade_date, d.open_price, d.high_price, d.low_price,
            d.close_price, d.pre_close_price, d.volume, d.amount,
            d.mkt_cap_total, d.mkt_cap_float
     FROM stocks s
     JOIN stock_daily d ON d.stock_code = s.stock_code AND d.trade_date = s.last_trade_date
     WHERE s.stock_code = ?`
  )
  const selectFund = c.prepare(
    `SELECT d.fund_code, ${fundNameField} d.trade_date, d.open, d.high, d.low, d.close, d.volume, d.amount,
            (SELECT p.close FROM fund_daily p WHERE p.fund_code=d.fund_code
             AND p.trade_date < d.trade_date ORDER BY p.trade_date DESC LIMIT 1) AS pre_close
     FROM fund_daily d ${fundInfoJoin} WHERE d.fund_code=? ORDER BY d.trade_date DESC LIMIT 1`
  )
  const selectIndex = c.prepare(
    `SELECT d.index_code, d.trade_date, d.close_index,
            (SELECT p.close_index FROM index_daily p WHERE p.index_code=d.index_code
             AND p.trade_date < d.trade_date ORDER BY p.trade_date DESC LIMIT 1) AS pre_close
     FROM index_daily d WHERE d.index_code=? ORDER BY d.trade_date DESC LIMIT 1`
  )
  const result: Quote[] = []
  for (const secid of secids) {
    const code = secid.split('.').pop() ?? secid
    try {
      const r = selectStock.get(code) as {
        stock_code: string; name: string | null; trade_date: string
        open_price: number; high_price: number; low_price: number
        close_price: number; pre_close_price: number; volume: number; amount: number
        mkt_cap_total: number | null; mkt_cap_float: number | null
      } | undefined
      if (!r) {
        const fund = selectFund.get(code) as {
          fund_code: string; name: string | null; trade_date: string; open: number; high: number; low: number
          close: number; volume: number; amount: number; pre_close: number | null
        } | undefined
        if (fund) {
          const pre = fund.pre_close ?? fund.close ?? 0
          result.push({
            secid, code: fund.fund_code, name: fund.name?.trim() || `基金 ${fund.fund_code}`,
            price: fund.close ?? 0, change: pre > 0 ? Number((fund.close - pre).toFixed(3)) : 0,
            changePercent: pre > 0 ? Number((((fund.close - pre) / pre) * 100).toFixed(2)) : 0,
            open: fund.open ?? 0, high: fund.high ?? 0, low: fund.low ?? 0, preClose: pre,
            volume: fund.volume ?? 0, amount: fund.amount ?? 0, isIndex: false, time: fund.trade_date
          })
          continue
        }
        const index = selectIndex.get(code) as {
          index_code: string; trade_date: string; close_index: number; pre_close: number | null
        } | undefined
        if (!index) continue
        const pre = index.pre_close ?? index.close_index ?? 0
        result.push({
          secid, code: index.index_code, name: INDEX_NAMES[index.index_code] ?? `指数 ${index.index_code}`,
          price: index.close_index ?? 0, change: pre > 0 ? Number((index.close_index - pre).toFixed(2)) : 0,
          changePercent: pre > 0 ? Number((((index.close_index - pre) / pre) * 100).toFixed(2)) : 0,
          open: index.close_index ?? 0, high: index.close_index ?? 0, low: index.close_index ?? 0,
          preClose: pre, volume: 0, amount: 0, isIndex: true, time: index.trade_date
        })
        continue
      }
      const pre = r.pre_close_price ?? r.close_price ?? 0
      result.push({
        secid,
        code: r.stock_code,
        name: r.name?.trim() || r.stock_code,
        price: r.close_price ?? 0,
        change: pre > 0 ? Number((r.close_price - pre).toFixed(2)) : 0,
        changePercent: pre > 0 ? Number((((r.close_price - pre) / pre) * 100).toFixed(2)) : 0,
        open: r.open_price ?? 0,
        high: r.high_price ?? 0,
        low: r.low_price ?? 0,
        preClose: pre,
        volume: r.volume ?? 0,
        amount: r.amount ?? 0,
        totalMv: r.mkt_cap_total ? r.mkt_cap_total * 1e4 : undefined,
        floatMv: r.mkt_cap_float ? r.mkt_cap_float * 1e4 : undefined,
        isIndex: false,
        time: r.trade_date
      })
    } catch {
      // 单只异常不影响其余股票兜底。
    }
  }
  return result
}

/** 排序字段取值 */
function sortValue(fid: string, q: Quote): number {
  if (fid === 'f12') return Number(q.code) || 0
  const key: keyof Quote =
    fid === 'f2'
      ? 'price'
      : fid === 'f5'
        ? 'volume'
        : fid === 'f6'
          ? 'amount'
          : fid === 'f4'
            ? 'change'
            : fid === 'f21'
              ? 'totalMv'
              : fid === 'f20'
                ? 'floatMv'
                : 'changePercent'
  return Number(q[key]) || 0
}

const STOCK_MARKETS: Partial<Record<MarketCategory, number[]>> = {
  a_share: [1, 4, 16, 32, 64],
  shanghai: [1],
  shenzhen: [4],
  chinext: [16],
  star: [32],
  beijing: [64],
  b_share: [2, 8]
}

const INDEX_NAMES: Record<string, string> = {
  '000001': '上证指数', '000002': '上证A指', '000003': '上证B指', '000010': '上证180',
  '000016': '上证50', '000020': '上证中型', '000300': '沪深300', '000852': '中证1000',
  '000902': '中证流通', '000903': '中证100', '000905': '中证500', '399001': '深证成指',
  '399004': '深证100', '399005': '中小100', '399006': '创业板指', '399106': '深证综指',
  '399107': '深证A指', '399108': '深证B指', '399303': '国证2000', '399329': '深证治理',
  '399903': '中证100'
}

// 每种本地分类独立缓存；首次按 stocks → (stock_code, trade_date) 复合索引定点读取，缓存后秒回。
const listCache = new Map<MarketCategory, { ts: number; all: Quote[] }>()
const CACHE_TTL_MS = 5 * 60 * 1000

/** 兼容尚未同步基金名称的旧行情库。 */
function hasFundInfo(c: Database.Database): boolean {
  try {
    return !!c
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fund_info' LIMIT 1")
      .get()
  } catch {
    return false
  }
}

function localFundRows(c: Database.Database): Quote[] {
  const fundInfoJoin = hasFundInfo(c) ? 'LEFT JOIN fund_info i ON i.fund_code=d.fund_code' : ''
  const fundNameField = fundInfoJoin ? 'i.name AS name,' : 'NULL AS name,'
  const rows = c.prepare(
    `SELECT d.fund_code, ${fundNameField} d.trade_date, d.open, d.high, d.low, d.close, d.volume, d.amount,
            (SELECT p.close FROM fund_daily p
             WHERE p.fund_code=d.fund_code AND p.trade_date < d.trade_date
             ORDER BY p.trade_date DESC LIMIT 1) AS pre_close
     FROM fund_daily d
     ${fundInfoJoin}
     JOIN (SELECT fund_code, MAX(trade_date) AS trade_date FROM fund_daily GROUP BY fund_code) last
       ON last.fund_code=d.fund_code AND last.trade_date=d.trade_date`
  ).all() as Array<{
    fund_code: string; name: string | null; trade_date: string; open: number; high: number; low: number; close: number
    volume: number; amount: number; pre_close: number | null
  }>
  return rows.map((r) => {
    const pre = r.pre_close ?? r.close ?? 0
    return {
      secid: secidOf(r.fund_code), code: r.fund_code, name: r.name?.trim() || `基金 ${r.fund_code}`,
      price: r.close ?? 0, change: pre > 0 ? Number((r.close - pre).toFixed(3)) : 0,
      changePercent: pre > 0 ? Number((((r.close - pre) / pre) * 100).toFixed(2)) : 0,
      open: r.open ?? 0, high: r.high ?? 0, low: r.low ?? 0, preClose: pre,
      volume: r.volume ?? 0, amount: r.amount ?? 0, isIndex: false, time: r.trade_date
    }
  })
}

function localIndexRows(c: Database.Database): Quote[] {
  const rows = c.prepare(
    `SELECT d.index_code, d.trade_date, d.close_index,
            (SELECT p.close_index FROM index_daily p
             WHERE p.index_code=d.index_code AND p.trade_date < d.trade_date
             ORDER BY p.trade_date DESC LIMIT 1) AS pre_close
     FROM index_daily d
     JOIN (SELECT index_code, MAX(trade_date) AS trade_date FROM index_daily GROUP BY index_code) last
       ON last.index_code=d.index_code AND last.trade_date=d.trade_date`
  ).all() as Array<{ index_code: string; trade_date: string; close_index: number; pre_close: number | null }>
  return rows.map((r) => {
    const pre = r.pre_close ?? r.close_index ?? 0
    return {
      secid: r.index_code.startsWith('399') ? `0.${r.index_code}` : `1.${r.index_code}`,
      code: r.index_code, name: INDEX_NAMES[r.index_code] ?? `指数 ${r.index_code}`,
      price: r.close_index ?? 0, change: pre > 0 ? Number((r.close_index - pre).toFixed(2)) : 0,
      changePercent: pre > 0 ? Number((((r.close_index - pre) / pre) * 100).toFixed(2)) : 0,
      open: r.close_index ?? 0, high: r.close_index ?? 0, low: r.close_index ?? 0, preClose: pre,
      volume: 0, amount: 0, isIndex: true, time: r.trade_date
    }
  })
}

export function getLocalMarketList(params: MarketListParams): MarketListResult | null {
  const c = getConn()
  if (!c) return null
  const category = params.category ?? 'a_share'

  let cached = listCache.get(category)
  if (!cached || Date.now() - cached.ts > CACHE_TTL_MS) {
    if (category === 'fund' || category === 'index') {
      const all = category === 'fund' ? localFundRows(c) : localIndexRows(c)
      cached = { ts: Date.now(), all }
      listCache.set(category, cached)
    } else {
      const marketTypes = STOCK_MARKETS[category]
      if (!marketTypes?.length) return { total: 0, list: [] }
    let rows: Array<{
      stock_code: string
      trade_date: string
      open_price: number
      high_price: number
      low_price: number
      close_price: number
      pre_close_price: number
      volume: number
      amount: number
      mkt_cap_total: number | null
      mkt_cap_float: number | null
      name: string
    }>
      try {
      rows = c
        .prepare(
          `SELECT s2.stock_code, s2.trade_date, s2.open_price, s2.high_price, s2.low_price,
                  s2.close_price, s2.pre_close_price, s2.volume, s2.amount,
                  s2.mkt_cap_total, s2.mkt_cap_float, st.name
           FROM stocks st
           CROSS JOIN stock_daily s2 INDEXED BY idx_sd_code_date
             ON s2.stock_code = st.stock_code AND s2.trade_date = st.last_trade_date
           WHERE st.market_type IN (${marketTypes.map(() => '?').join(',')})`
        )
        .all(...marketTypes) as typeof rows
      } catch {
        return null
      }
      if (!rows.length) return { total: 0, list: [] }

      cached = {
      ts: Date.now(),
      all: rows.map((r) => {
        const close = r.close_price ?? 0
        const pre = r.pre_close_price ?? close
        return {
          secid: secidOf(r.stock_code),
          code: r.stock_code,
          name: r.name || r.stock_code,
          price: close,
          change: pre > 0 ? Number((close - pre).toFixed(2)) : 0,
          changePercent: pre > 0 ? Number((((close - pre) / pre) * 100).toFixed(2)) : 0,
          open: r.open_price ?? 0,
          high: r.high_price ?? 0,
          low: r.low_price ?? 0,
          preClose: pre,
          volume: r.volume ?? 0,
          amount: r.amount ?? 0,
          // 本地库有市值（万元→元）；换手率/PE/量比/行业本地无数据源，留空（渲染层本地模式隐藏这些列）
          totalMv: r.mkt_cap_total ? r.mkt_cap_total * 1e4 : undefined,
          floatMv: r.mkt_cap_float ? r.mkt_cap_float * 1e4 : undefined,
          isIndex: false
        }
      })
      }
      listCache.set(category, cached)
    }
  }

  const list = [...cached.all]

  // 排序
  const fid = params.fid || 'f3'
  const dir = params.order === 'asc' ? 1 : -1
  list.sort((a, b) => dir * (sortValue(fid, a) - sortValue(fid, b)))

  // 分页
  const total = list.length
  const pz = params.pz || 100
  const pn = Math.max(1, params.pn || 1)
  const start = (pn - 1) * pz
  return { total, list: list.slice(start, start + pz) }
}
