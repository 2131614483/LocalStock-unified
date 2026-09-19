import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import type { KlinePoint } from '../../shared/types'
import { stockDataPath } from '../backtest'
import { codeOf } from './kline-local'

/**
 * 分钟K线持久化：写入行情库 stock_data.db 的 stock_minute_kline 表。
 * 在线拉取后落库（按 股票+klt 整体替换），在线失败时回退读本地，减少接口依赖。
 */
let writeConn: Database.Database | null = null

function getWriteConn(): Database.Database | null {
  if (writeConn) return writeConn
  const db = stockDataPath()
  if (!existsSync(db)) return null
  try {
    writeConn = new Database(db)
    writeConn.pragma('journal_mode = WAL')
    writeConn.exec(`
      CREATE TABLE IF NOT EXISTS stock_minute_kline (
        stock_code TEXT NOT NULL,
        klt INTEGER NOT NULL,
        bar_time TEXT NOT NULL,
        open REAL, high REAL, low REAL, close REAL,
        volume INTEGER, amount REAL,
        PRIMARY KEY (stock_code, klt, bar_time)
      );
      CREATE INDEX IF NOT EXISTS idx_mk_code_klt ON stock_minute_kline(stock_code, klt);
    `)
    // 保留策略：分钟K线只保留最近 30 天，避免无限增长
    try {
      writeConn.exec("DELETE FROM stock_minute_kline WHERE bar_time < date('now','-30 days')")
    } catch {
      // 清理失败忽略
    }
    return writeConn
  } catch {
    return null
  }
}

interface KlineRow {
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

/** 读取该股票某分钟周期的持久化K线（无数据返回 null） */
export function readLocalMinuteKline(secid: string, klt: number): KlinePoint[] | null {
  const conn = getWriteConn()
  if (!conn) return null
  const code = codeOf(secid)
  try {
    const rows = conn
      .prepare(
        'SELECT bar_time, open, high, low, close, volume, amount FROM stock_minute_kline WHERE stock_code=? AND klt=? ORDER BY bar_time'
      )
      .all(code, klt) as KlineRow[]
    if (!rows.length) return null
    return rows.map((r) => ({
      time: r.bar_time,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      amount: r.amount
    }))
  } catch {
    return null
  }
}

/** 写入某分钟周期K线（先删旧数据再插入，整周期替换） */
export function writeLocalMinuteKline(secid: string, klt: number, points: KlinePoint[]): void {
  const conn = getWriteConn()
  if (!conn || !points.length) return
  const code = codeOf(secid)
  try {
    const del = conn.prepare('DELETE FROM stock_minute_kline WHERE stock_code=? AND klt=?')
    const ins = conn.prepare(
      'INSERT OR REPLACE INTO stock_minute_kline (stock_code, klt, bar_time, open, high, low, close, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    const tx = conn.transaction(() => {
      del.run(code, klt)
      for (const p of points) {
        ins.run(code, klt, p.time, p.open, p.high, p.low, p.close, p.volume, p.amount)
      }
    })
    tx()
  } catch {
    // 分钟K线写入失败不影响主流程
  }
}
