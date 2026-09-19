import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import type { MinutePoint } from '../../shared/types'
import { stockDataPath } from '../backtest'
import { codeOf } from './kline-local'

/**
 * 分时数据持久化：写入行情库 stock_data.db 的 stock_minute 表。
 * 打开个股详情页时分时拉取后落库，下次直接读库，不依赖接口。
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
      CREATE TABLE IF NOT EXISTS stock_minute (
        stock_code TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        trade_time TEXT NOT NULL,
        price REAL,
        avg REAL,
        high REAL,
        low REAL,
        volume INTEGER,
        amount REAL,
        PRIMARY KEY (stock_code, trade_date, trade_time)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_minute_code_date ON stock_minute(stock_code, trade_date);
    `)
    // 保留策略：分时只保留最近 30 天，避免无限增长
    try {
      writeConn.exec("DELETE FROM stock_minute WHERE trade_date < date('now','-30 days')")
    } catch {
      // 清理失败忽略
    }
    return writeConn
  } catch {
    return null
  }
}

/** 读取该股票最新交易日已持久化的分时数据 */
export function readLocalMinute(secid: string): { date: string; points: MinutePoint[] } | null {
  const conn = getWriteConn()
  if (!conn) return null
  const code = codeOf(secid)
  try {
    const last = conn
      .prepare('SELECT MAX(trade_date) AS d FROM stock_minute WHERE stock_code = ?')
      .get(code) as { d: string | null } | undefined
    if (!last?.d) return null
    const rows = conn
      .prepare(
        'SELECT trade_time, price, avg, high, low, volume, amount FROM stock_minute WHERE stock_code=? AND trade_date=? ORDER BY trade_time'
      )
      .all(code, last.d) as Array<{
      trade_time: string
      price: number
      avg: number
      high: number
      low: number
      volume: number
      amount: number
    }>
    if (!rows.length) return null
    return {
      date: last.d,
      points: rows.map((r) => ({
        time: r.trade_time,
        price: r.price,
        avg: r.avg,
        high: r.high,
        low: r.low,
        volume: r.volume,
        amount: r.amount
      }))
    }
  } catch {
    return null
  }
}

/** 写入某交易日的分时数据（先删该日旧数据再插入） */
export function writeLocalMinute(
  secid: string,
  date: string,
  points: MinutePoint[]
): void {
  const conn = getWriteConn()
  if (!conn || !points.length) return
  const code = codeOf(secid)
  try {
    const del = conn.prepare('DELETE FROM stock_minute WHERE stock_code=? AND trade_date=?')
    const ins = conn.prepare(
      'INSERT OR REPLACE INTO stock_minute (stock_code, trade_date, trade_time, price, avg, high, low, volume, amount) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    const tx = conn.transaction(() => {
      del.run(code, date)
      for (const p of points) {
        ins.run(code, date, p.time, p.price, p.avg, p.high, p.low, p.volume, p.amount)
      }
    })
    tx()
  } catch {
    // 分时写入失败不影响主流程
  }
}
