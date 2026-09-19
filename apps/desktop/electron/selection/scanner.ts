import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import type { SelectionFilter, SelectionHit } from '../../shared/types'
import { getDbPath } from '../market/db-path'
import { evaluateTechnicalFilters, type DailyBar } from './rules'

/**
 * 全市场技术面扫描（在 sqlite-worker 线程执行，不阻塞主进程）。
 * 对每只股票取最近 ~250 根日线，评估技术筛选（AND），返回命中股票 + 理由。
 * 基本面筛选由主进程合并市场快照另行评估。
 */
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

function secidOf(code: string): string {
  return (code.startsWith('6') ? '1' : '0') + '.' + code
}

export interface ScanCandidate {
  secid: string
  code: string
  name: string
  price: number
  changePercent: number
  amount: number
  reasons: string[]
}

/** 单条扫描进度回调（worker → 主进程 → 渲染层） */
export type ScanProgress = (done: number, total: number, hits: number) => void

export function scanTechnical(
  filters: SelectionFilter[],
  onProgress?: ScanProgress
): ScanCandidate[] {
  const c = getConn()
  if (!c) return []
  const techFilters = filters.filter((f) =>
    ['ma_cross', 'ma_align', 'price_breakout', 'volume_surge', 'volume_shrink', 'macd_cross', 'rsi_range', 'change_pct_range', 'amount_range'].includes(f.kind)
  )
  if (!techFilters.length) return [] // 无技术条件：全市场候选交给主进程
  const stocks = c
    .prepare('SELECT stock_code, name FROM stocks')
    .all() as Array<{ stock_code: string; name: string }>
  const total = stocks.length
  const hits: ScanCandidate[] = []
  const getBars = c.prepare(
    `SELECT trade_date, open_price, high_price, low_price, close_price, volume, amount
     FROM stock_daily WHERE stock_code=? ORDER BY trade_date DESC LIMIT 250`
  )
  for (let i = 0; i < total; i++) {
    const s = stocks[i]
    let rows: Array<{
      trade_date: string
      open_price: number
      high_price: number
      low_price: number
      close_price: number
      volume: number
      amount: number
    }>
    try {
      rows = getBars.all(s.stock_code) as typeof rows
    } catch {
      continue
    }
    if (!rows.length) continue
    const bars: DailyBar[] = rows.reverse().map((r) => ({
      time: r.trade_date,
      open: r.open_price,
      close: r.close_price,
      high: r.high_price,
      low: r.low_price,
      volume: r.volume,
      amount: r.amount
    }))
    const res = evaluateTechnicalFilters(techFilters, bars)
    if (res.pass) {
      const last = bars[bars.length - 1]
      const pre = bars.length > 1 ? bars[bars.length - 2].close : last.open
      hits.push({
        secid: secidOf(s.stock_code),
        code: s.stock_code,
        name: s.name || s.stock_code,
        price: last.close,
        changePercent: pre > 0 ? Number((((last.close - pre) / pre) * 100).toFixed(2)) : 0,
        amount: last.amount,
        reasons: res.reasons
      })
    }
    if (onProgress && i % 200 === 0) onProgress(i, total, hits.length)
  }
  onProgress?.(total, total, hits.length)
  return hits
}

/** 全市场快照（最新日线）候选：无技术条件时的全市场池（供基本面过滤） */
export function scanAllMarket(onProgress?: ScanProgress): ScanCandidate[] {
  const c = getConn()
  if (!c) return []
  const rows = c
    .prepare(
      `SELECT s2.stock_code, s2.trade_date, s2.close_price, s2.pre_close_price, s2.amount, st.name
       FROM stocks st
       CROSS JOIN stock_daily s2 INDEXED BY idx_sd_code_date
         ON s2.stock_code = st.stock_code AND s2.trade_date = st.last_trade_date`
    )
    .all() as Array<{
    stock_code: string
    close_price: number
    pre_close_price: number
    amount: number
    name: string
  }>
  const hits: ScanCandidate[] = rows.map((r) => {
    const pre = r.pre_close_price ?? r.close_price
    return {
      secid: secidOf(r.stock_code),
      code: r.stock_code,
      name: r.name || r.stock_code,
      price: r.close_price,
      changePercent: pre > 0 ? Number((((r.close_price - pre) / pre) * 100).toFixed(2)) : 0,
      amount: r.amount,
      reasons: []
    }
  })
  onProgress?.(hits.length, hits.length, hits.length)
  return hits
}
