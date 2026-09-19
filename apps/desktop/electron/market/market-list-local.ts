import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import type { MarketListParams, MarketListResult, Quote } from '../../shared/types'
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
  return (code.startsWith('6') ? '1' : '0') + '.' + code
}

/** 按 secid 从本地库构建最新快照，供在线源缺股/离线时兜底。 */
export function getLocalQuotes(secids: string[]): Quote[] {
  const c = getConn()
  if (!c || !secids.length) return []
  const selectStock = c.prepare(
    `SELECT s.stock_code, s.name, d.trade_date, d.open_price, d.high_price, d.low_price,
            d.close_price, d.pre_close_price, d.volume, d.amount,
            d.mkt_cap_total, d.mkt_cap_float
     FROM stocks s
     JOIN stock_daily d ON d.stock_code = s.stock_code AND d.trade_date = s.last_trade_date
     WHERE s.stock_code = ?`
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
      if (!r) continue
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

// 全量列表缓存：首次按 stocks → (stock_code, trade_date) 复合索引定点读取，缓存后秒回
let listCache: { ts: number; all: Quote[] } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

export function getLocalMarketList(params: MarketListParams): MarketListResult | null {
  const c = getConn()
  if (!c) return null

  // CROSS JOIN 固定驱动顺序：先扫约 6000 只 stocks，再用复合索引定点读取最新行。
  // 普通 JOIN 会被 SQLite 误规划成扫描近 1900 万行 stock_daily，实测约 25 秒。
  if (!listCache || Date.now() - listCache.ts > CACHE_TTL_MS) {
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
             ON s2.stock_code = st.stock_code AND s2.trade_date = st.last_trade_date`
        )
        .all() as typeof rows
    } catch {
      return null
    }
    if (!rows.length) return null

    listCache = {
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
  }

  const list = [...listCache.all]

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
