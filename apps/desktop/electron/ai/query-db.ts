import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { stockDataPath } from '../backtest'

/**
 * 只读 SQL 万能钥匙：让 AI 读取任何库内数据（覆盖"所有信息只读"的最后一公里）。
 * 安全约束：
 *  - 仅允许单个 SELECT；拒绝多语句（;）
 *  - 拒绝 DDL/DML/PRAGMA/ATTACH 等关键字
 *  - 独立 readonly 连接（绝不使用 app 主连接），自动附加 LIMIT 上限
 */
const MAX_ROWS = 2000
const MAX_COLUMNS = 50
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|VACUUM|REINDEX|GRANT|REVOKE|ATTACH|DETACH)\b/i

export function queryReadOnly(database: 'stock_data' | 'localstock', sql: string): unknown {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (!/^SELECT\s/i.test(trimmed)) throw new Error('仅支持 SELECT 查询')
  if (trimmed.includes(';')) throw new Error('不支持多语句查询')
  if (FORBIDDEN.test(trimmed)) throw new Error('查询包含被禁止的关键字')
  if (/PRAGMA\b/i.test(trimmed)) throw new Error('不允许使用 PRAGMA')
  if (database === 'localstock' && /\bFROM\s+settings\b/i.test(trimmed)) {
    const projection = trimmed.slice(0, trimmed.search(/\bFROM\s+settings\b/i))
    if (/\*|\bvalue\b/i.test(projection)) {
      throw new Error('settings.value 可能包含 API Key 等敏感信息；AI 仅允许查询 settings.key')
    }
  }

  let path: string
  if (database === 'stock_data') path = stockDataPath()
  else if (database === 'localstock') path = join(app.getPath('userData'), 'localstock.db')
  else throw new Error(`未知数据库: ${String(database)}`)

  if (!existsSync(path)) throw new Error(`数据库不存在: ${path}`)

  const conn = new Database(path, { readonly: true })
  try {
    const limited = /LIMIT\s+\d+\s*$/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${MAX_ROWS}`
    const stmt = conn.prepare(limited)
    const columns = stmt.columns().map((c) => c.name)
    const rows = stmt.all()
    return {
      database,
      columns: columns.slice(0, MAX_COLUMNS),
      rows: rows.slice(0, MAX_ROWS),
      count: rows.length
    }
  } catch (err) {
    // 失败时带上可用表结构提示，让 AI 一次自纠（猜错字段名/表名的常见场景）
    const msg = err instanceof Error ? err.message : String(err)
    const hint = buildSchemaHint(conn, database)
    console.error(`[query_db] 失败: ${msg} | sql: ${trimmed}`)
    throw new Error(`${msg}（${hint}）`)
  } finally {
    conn.close()
  }
}

/** 动态数据目录：只返回真实表/列，不返回任何数据值。 */
export function getDataCatalog(database: 'stock_data' | 'localstock', table?: string): unknown {
  let path: string
  if (database === 'stock_data') path = stockDataPath()
  else if (database === 'localstock') path = join(app.getPath('userData'), 'localstock.db')
  else throw new Error(`未知数据库: ${String(database)}`)
  if (!existsSync(path)) throw new Error(`数据库不存在: ${path}`)
  const conn = new Database(path, { readonly: true })
  try {
    const tables = conn.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>
    const selected = table ? tables.filter((item) => item.name === table) : tables.slice(0, 100)
    if (table && !selected.length) throw new Error(`表不存在: ${table}`)
    return {
      database,
      tables: selected.map(({ name }) => ({
        name,
        columns: conn.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all().map((row) => {
          const col = row as { name: string; type: string; notnull: number; pk: number }
          return { name: col.name, type: col.type, nullable: !col.notnull, primaryKey: !!col.pk }
        })
      }))
    }
  } finally {
    conn.close()
  }
}

/** 列出库内可用表（含建表 SQL 抽取的列名），供错误提示 */
function buildSchemaHint(conn: Database.Database, database: 'stock_data' | 'localstock'): string {
  try {
    const tables = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>
    if (!tables.length) return '库内无表'
    const names = tables.map((t) => t.name).join(', ')
    // 找与报错相关的表（库中最常用前几张），给出列名
    const keyTables = ['stocks', 'stock_daily', 'trade_calendar', 'index_daily', 'stock_minute', 'watchlist', 'settings', 'drawings', 'alert_rules', 'quote_history', 'prediction_history', 'selection_rules', 'ai_predictions']
    const colsOf = (t: string): string[] => {
      try {
        return conn.prepare(`PRAGMA table_info(${t})`).all().map((r) => (r as { name: string }).name)
      } catch {
        return []
      }
    }
    const detail = keyTables
      .filter((t) => tables.some((x) => x.name === t))
      .map((t) => `${t}(${colsOf(t).join(',')})`)
      .join('; ')
    return `可用表: ${names}. 常用表列: ${detail}`
  } catch {
    return '可用表: 查询失败'
  }
}
