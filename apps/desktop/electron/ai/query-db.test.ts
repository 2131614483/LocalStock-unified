import { describe, expect, it, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 用假 Database 记录 SQL + 假文件路径，验证 query_db 的只读安全拦截。
const mocks = vi.hoisted(() => {
  let lastSql = ''
  let dbFile = ''
  let userData = ''
  return {
    fakeDatabase: class {
      constructor(public path: string, public opts: Record<string, unknown>) {}
      prepare(sql: string) {
        lastSql = sql
        if (sql.includes('FROM missing')) throw new Error('no such table: missing')
        if (sql.includes('sqlite_master')) {
          return { columns: () => [], all: () => [{ name: 'stocks' }, { name: 'stock_daily' }] }
        }
        if (sql.startsWith('PRAGMA table_info(stocks)')) {
          return { columns: () => [], all: () => [{ name: 'stock_code' }, { name: 'name' }] }
        }
        return { columns: () => [{ name: 'a' }], all: () => [] }
      }
      close() {}
    },
    setDbFile(p: string) {
      dbFile = p
    },
    getDbFile() {
      return dbFile
    },
    setUserData(p: string) {
      userData = p
    },
    getLastSql() {
      return lastSql
    },
    getUserData() {
      return userData
    }
  }
})

vi.mock('better-sqlite3', () => ({ default: mocks.fakeDatabase }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.getUserData() } }))
vi.mock('../backtest', () => ({ stockDataPath: () => mocks.getDbFile() }))

import { getDataCatalog, queryReadOnly } from './query-db'

describe('query_db 只读 SQL 安全拦截', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'qdb-'))
    mocks.setDbFile(join(dir, 'stock_data.db'))
    mocks.setUserData(dir)
    writeFileSync(mocks.getDbFile(), '') // 让 existsSync 通过
    writeFileSync(join(mocks.getUserData(), 'localstock.db'), '')
  })

  it('拒绝非 SELECT（INSERT/UPDATE/DELETE）', () => {
    for (const sql of [
      'INSERT INTO stocks VALUES (1)',
      'UPDATE stock_daily SET close=0',
      'DELETE FROM stocks',
      'DROP TABLE stocks',
      'CREATE TABLE x (id INT)'
    ]) {
      expect(() => queryReadOnly('stock_data', sql)).toThrow(/SELECT|禁止|多语句|PRAGMA/)
    }
  })

  it('拒绝多语句、PRAGMA、ATTACH', () => {
    expect(() => queryReadOnly('stock_data', 'SELECT 1; DROP TABLE stocks')).toThrow()
    expect(() => queryReadOnly('stock_data', "PRAGMA journal_mode=WAL")).toThrow()
    expect(() => queryReadOnly('stock_data', "ATTACH 'x.db' AS other")).toThrow()
  })

  it('未知 database 拒绝', () => {
    expect(() =>
      queryReadOnly('nope' as never, 'SELECT 1')
    ).toThrow(/未知数据库/)
  })

  it('合法 SELECT 通过且自动附加 LIMIT 上限', () => {
    queryReadOnly('stock_data', 'SELECT * FROM stock_daily WHERE stock_code=\'600519\'')
    expect(mocks.getLastSql()).toMatch(/LIMIT \d+/)
  })

  it('已带 LIMIT 的查询不再追加', () => {
    queryReadOnly('localstock', 'SELECT id FROM watchlist LIMIT 5')
    expect(mocks.getLastSql()).toBe('SELECT id FROM watchlist LIMIT 5')
  })

  it('查询失败时错误附带可用表与列名提示（AI 自纠）', () => {
    expect(() => queryReadOnly('stock_data', 'SELECT * FROM missing')).toThrow(/no such table: missing/)
    expect(() => queryReadOnly('stock_data', 'SELECT * FROM missing')).toThrow(/可用表: stocks/)
  })

  it('禁止读取 settings.value 敏感配置，只允许查看 key', () => {
    expect(() => queryReadOnly('localstock', 'SELECT * FROM settings')).toThrow(/敏感信息/)
    expect(() => queryReadOnly('localstock', 'SELECT key, value FROM settings')).toThrow(/敏感信息/)
    expect(() => queryReadOnly('localstock', 'SELECT key FROM settings')).not.toThrow()
  })

  it('动态目录返回真实表名与字段，不读取数据值', () => {
    const result = getDataCatalog('stock_data') as { tables: Array<{ name: string }> }
    expect(result.tables.map((table) => table.name)).toContain('stocks')
  })
})
