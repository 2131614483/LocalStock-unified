import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import type { KlinePoint, KlineResult } from '../../shared/types'
import { getDbPath } from './db-path'
import { isIndexSecid } from '../../shared/market-session'

/** 本地回测行情库（stock_data.db）的 K 线查询：日/周/月/季从日线直接读取或聚合，不受接口限流影响 */
interface DailyRow {
  trade_date: string
  open_price: number
  high_price: number
  low_price: number
  close_price: number
  volume: number
  amount: number
}

let localConn: Database.Database | null = null

function getConn(): Database.Database | null {
  if (localConn) return localConn
  const db = getDbPath()
  if (!db || !existsSync(db)) return null
  try {
    localConn = new Database(db, { readonly: true })
    return localConn
  } catch {
    return null
  }
}

/** 返回该日期所在周的周一日期（YYYY-MM-DD），作为周分组键 */
function weekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day // 周一到周日
  date.setDate(date.getDate() + diff)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

/** 季度分组键：YYYY-Qn（Q1=1-3月 … Q4=10-12月） */
function quarterKey(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}

/** 分钟级 klt（本地无分钟数据，返回 null 走在线源） */
export const MINUTE_KLTS = new Set([1, 5, 15, 30, 60, 120])

/** 提取 secid 中的 6 位代码（兼容 "0.000858" 和 "000858.XSHE"） */
export function codeOf(secid: string): string {
  const parts = secid.split('.')
  return parts.length > 1 && /^\d+$/.test(parts[1]) ? parts[1] : parts[0]
}

/** 本地库查询该股票最新一日的昨收价（分时基准线用） */
export function getLocalPreClose(secid: string): number {
  const conn = getConn()
  if (!conn) return 0
  try {
    const stock = conn
      .prepare(
        'SELECT pre_close_price FROM stock_daily WHERE stock_code=? ORDER BY trade_date DESC LIMIT 1'
      )
      .get(codeOf(secid)) as { pre_close_price: number } | undefined
    if (stock?.pre_close_price != null) return stock.pre_close_price
    const fund = conn
      .prepare(
        `SELECT close FROM fund_daily WHERE fund_code=? ORDER BY trade_date DESC LIMIT 1 OFFSET 1`
      )
      .get(codeOf(secid)) as { close: number } | undefined
    return fund?.close ?? 0
  } catch {
    return 0
  }
}

/** 从 DailyRow[] 构建 KlineResult（101 直出，102/103/104 聚合） */
function buildKline(secid: string, rows: DailyRow[], klt: number): KlineResult | null {
  const code = codeOf(secid)
  if (!rows.length) return null
  if (klt === 101) {
    const points: KlinePoint[] = rows.map((r) => ({
      time: r.trade_date,
      open: r.open_price,
      close: r.close_price,
      high: r.high_price,
      low: r.low_price,
      volume: r.volume,
      amount: r.amount
    }))
    return { secid, name: code, points }
  }
  // 周/月/季聚合（open=周期首日开, close=周期末日收, high/low=max/min, volume/amount=sum）
  const grouped = new Map<string, DailyRow[]>()
  for (const r of rows) {
    const key =
      klt === 102 ? weekKey(r.trade_date) : klt === 104 ? quarterKey(r.trade_date) : r.trade_date.slice(0, 7)
    const arr = grouped.get(key)
    if (arr) arr.push(r)
    else grouped.set(key, [r])
  }
  const points: KlinePoint[] = [...grouped.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, arr]) => {
      const first = arr[0]
      const last = arr[arr.length - 1]
      return {
        time: last.trade_date,
        open: first.open_price,
        close: last.close_price,
        high: Math.max(...arr.map((x) => x.high_price)),
        low: Math.min(...arr.map((x) => x.low_price)),
        volume: arr.reduce((s, x) => s + x.volume, 0),
        amount: arr.reduce((s, x) => s + x.amount, 0)
      }
    })
  return { secid, name: code, points }
}

/** 本地指数 K 线：index_daily 只存 close（close 线，非蜡烛），周/月/季聚合 */
export function getLocalIndexKline(secid: string, klt: number): KlineResult | null {
  if (MINUTE_KLTS.has(klt)) return null
  const conn = getConn()
  if (!conn) return null
  const code = codeOf(secid)
  let rows: Array<{ trade_date: string; close_index: number }>
  try {
    rows = conn
      .prepare('SELECT trade_date, close_index FROM index_daily WHERE index_code=? ORDER BY trade_date')
      .all(code) as typeof rows
  } catch {
    return null
  }
  if (!rows.length) return null
  const daily: DailyRow[] = rows.map((r) => ({
    trade_date: r.trade_date,
    open_price: r.close_index,
    close_price: r.close_index,
    high_price: r.close_index,
    low_price: r.close_index,
    volume: 0,
    amount: 0
  }))
  return buildKline(secid, daily, klt)
}

/** 从本地行情库读取 K 线（股票、基金和指数均可离线使用）。 */
export function getLocalKline(secid: string, klt: number): KlineResult | null {
  if (MINUTE_KLTS.has(klt)) return null // 本地无分钟数据
  if (isIndexSecid(secid)) return getLocalIndexKline(secid, klt) // 指数走 index_daily（close 线）
  const conn = getConn()
  if (!conn) return null
  const code = codeOf(secid)
  let rows: DailyRow[]
  try {
    rows = conn
      .prepare(
        `SELECT trade_date, open_price, high_price, low_price, close_price, volume, amount
         FROM stock_daily WHERE stock_code=? ORDER BY trade_date`
      )
      .all(code) as DailyRow[]
    if (!rows.length) {
      rows = conn
        .prepare(
          `SELECT trade_date, open AS open_price, high AS high_price, low AS low_price,
                  close AS close_price, volume, amount
           FROM fund_daily WHERE fund_code=? ORDER BY trade_date`
        )
        .all(code) as DailyRow[]
    }
  } catch {
    return null
  }
  return buildKline(secid, rows, klt)
}
