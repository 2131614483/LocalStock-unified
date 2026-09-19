import { describe, expect, it } from 'vitest'
import { runMigrations } from './migrations'

// better-sqlite3 为 Electron ABI，无法在 node 的 vitest 中加载；用最小 fake db 验证迁移控制流
function makeDb(startVersion: number) {
  let version = startVersion
  const execs: string[] = []
  return {
    exec: (sql: string) => void execs.push(sql),
    pragma: (p: string, opt?: { simple?: boolean }) => {
      if (p.startsWith('user_version')) {
        if (opt?.simple) return version
        const m = p.match(/= *(\d+)/)
        if (m) version = Number(m[1])
        return
      }
      return undefined
    },
    transaction: (fn: () => void) => fn,
    version: () => version,
    execs
  }
}

describe('DB 迁移 runner（PRAGMA user_version）', () => {
  it('空库（v0）顺序执行全部迁移 → v7，依次建基础/预警/AI审计/选股/监盘/预测历史/监盘状态表', () => {
    const db = makeDb(0)
    runMigrations(db as never)
    expect(db.version()).toBe(7)
    expect(db.execs).toHaveLength(7)
    expect(db.execs[0]).toContain('CREATE TABLE IF NOT EXISTS watchlist')
    expect(db.execs[1]).toContain('CREATE TABLE IF NOT EXISTS alert_rules')
    expect(db.execs[2]).toContain('CREATE TABLE IF NOT EXISTS ai_audit')
    expect(db.execs[3]).toContain('CREATE TABLE IF NOT EXISTS selection_rules')
    expect(db.execs[4]).toContain('CREATE TABLE IF NOT EXISTS quote_history')
    expect(db.execs[5]).toContain('CREATE TABLE IF NOT EXISTS prediction_history')
    expect(db.execs[6]).toContain('CREATE TABLE IF NOT EXISTS monitor_state')
  })

  it('已是 v7 不再重复执行（幂等）', () => {
    const db = makeDb(7)
    runMigrations(db as never)
    expect(db.execs).toHaveLength(0)
  })

  it('旧库（v6）只执行 v7 增量', () => {
    const db = makeDb(6)
    runMigrations(db as never)
    expect(db.version()).toBe(7)
    expect(db.execs).toHaveLength(1)
    expect(db.execs[0]).toContain('monitor_state')
  })
})
