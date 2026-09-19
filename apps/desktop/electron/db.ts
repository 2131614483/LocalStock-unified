import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type { WatchItem, Drawing, DrawingVersion } from '../shared/types'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

/** 首次启动预置的热门自选股 */
const DEFAULT_WATCHLIST: WatchItem[] = [
  { secid: '1.600519', code: '600519', name: '贵州茅台' },
  { secid: '1.600036', code: '600036', name: '招商银行' },
  { secid: '0.000858', code: '000858', name: '五粮液' },
  { secid: '0.300750', code: '300750', name: '宁德时代' },
  { secid: '1.601318', code: '601318', name: '中国平安' },
  { secid: '0.002594', code: '002594', name: '比亚迪' },
  { secid: '0.300059', code: '300059', name: '东方财富' },
  { secid: '0.002475', code: '002475', name: '立讯精密' }
]

export function getDb(): Database.Database {
  if (db) return db

  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'localstock.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

  initSchema()
  seedWatchlist()
  return db
}

function initSchema(): void {
  runMigrations(getDb())
}

function seedWatchlist(): void {
  const d = getDb()
  const count = (d.prepare('SELECT COUNT(*) AS c FROM watchlist').get() as { c: number }).c
  if (count > 0) return
  const insert = d.prepare(
    'INSERT OR IGNORE INTO watchlist (secid, code, name, sort_order) VALUES (?, ?, ?, ?)'
  )
  const tx = d.transaction(() => {
    DEFAULT_WATCHLIST.forEach((w, i) => insert.run(w.secid, w.code, w.name, i))
  })
  tx()
}

// ---------- 自选股 ----------

export function listWatchlist(): WatchItem[] {
  const rows = getDb()
    .prepare('SELECT secid, code, name FROM watchlist ORDER BY sort_order ASC, id ASC')
    .all() as WatchItem[]
  return rows
}

export function addWatchlist(item: WatchItem): void {
  const d = getDb()
  const maxOrder = (d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM watchlist').get() as { m: number }).m
  d.prepare('INSERT OR IGNORE INTO watchlist (secid, code, name, sort_order) VALUES (?, ?, ?, ?)').run(
    item.secid,
    item.code,
    item.name,
    maxOrder + 1
  )
}

export function removeWatchlist(secid: string): void {
  getDb().prepare('DELETE FROM watchlist WHERE secid = ?').run(secid)
}

export function reorderWatchlist(secids: string[]): void {
  const d = getDb()
  const update = d.prepare('UPDATE watchlist SET sort_order = ? WHERE secid = ?')
  const tx = d.transaction(() => {
    secids.forEach((secid, i) => update.run(i, secid))
  })
  tx()
}

// ---------- 设置 ----------

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

// ---------- K线/分时缓存 ----------

export function getKlineCache(cacheKey: string): { updatedAt: number; data: unknown } | null {
  const row = getDb()
    .prepare('SELECT updated_at AS updatedAt, data FROM kline_cache WHERE cache_key = ?')
    .get(cacheKey) as { updatedAt: number; data: string } | undefined
  if (!row) return null
  try {
    return { updatedAt: row.updatedAt, data: JSON.parse(row.data) }
  } catch {
    return null
  }
}

export function setKlineCache(cacheKey: string, data: unknown): void {
  getDb()
    .prepare(
      'INSERT INTO kline_cache (cache_key, updated_at, data) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data'
    )
    .run(cacheKey, Date.now(), JSON.stringify(data))
}

// ---------- K线画线 ----------

export function getDrawings(secid: string): { current: Drawing[]; history: DrawingVersion[] } {
  const d = getDb()
  const row = d.prepare('SELECT data FROM drawings WHERE secid = ?').get(secid) as
    | { data: string }
    | undefined
  const current: Drawing[] = row ? JSON.parse(row.data) : []
  const histRows = d
    .prepare(
      'SELECT version, data, created_at FROM drawing_history WHERE secid=? ORDER BY version DESC LIMIT 100'
    )
    .all(secid) as Array<{ version: number; data: string; created_at: number }>
  const history: DrawingVersion[] = histRows.map((r) => ({
    version: r.version,
    data: JSON.parse(r.data),
    created_at: r.created_at
  }))
  return { current, history }
}

export function saveDrawings(secid: string, drawings: Drawing[]): void {
  const d = getDb()
  const row = d.prepare('SELECT version FROM drawings WHERE secid = ?').get(secid) as
    | { version: number }
    | undefined
  const version = (row?.version ?? 0) + 1
  const now = Date.now()
  const data = JSON.stringify(drawings)
  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO drawings (secid, data, version, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(secid) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at`
    ).run(secid, data, version, now)
    d.prepare('INSERT INTO drawing_history (secid, version, data, created_at) VALUES (?,?,?,?)').run(
      secid,
      version,
      data,
      now
    )
    // 滚动清理：每只股票仅保留最近 100 个版本
    d.prepare(
      'DELETE FROM drawing_history WHERE secid=? AND id NOT IN ' +
        '(SELECT id FROM drawing_history WHERE secid=? ORDER BY version DESC LIMIT 100)'
    ).run(secid, secid)
  })
  tx()
}

export function restoreDrawings(secid: string, version: number): Drawing[] | null {
  const d = getDb()
  const row = d
    .prepare('SELECT data FROM drawing_history WHERE secid=? AND version=?')
    .get(secid, version) as { data: string } | undefined
  if (!row) return null
  const drawings = JSON.parse(row.data) as Drawing[]
  d.prepare('UPDATE drawings SET data=?, updated_at=? WHERE secid=?').run(row.data, Date.now(), secid)
  return drawings
}

export function clearDrawings(secid: string): void {
  saveDrawings(secid, [])
}
