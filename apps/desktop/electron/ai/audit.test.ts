import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---- 用内存 fake db 替掉 '../db'（better-sqlite3 为 Electron ABI，node 下不可加载）----
// vi.hoisted 保证在模块 import（触发 mock factory）之前初始化共享状态。
const mocks = vi.hoisted(() => {
  interface AuditRow {
    id: string
    ts: number
    tool: string
    secid: string | null
    args: string | null
    summary: string
    status: string
    snapshot: string | null
  }
  const aiAudit: AuditRow[] = []
  const settings: Record<string, string> = {}
  const drawingsStore: Record<string, unknown[]> = {}

  function fakePrepare(sql: string) {
    const stmt = {
      get: (...args: unknown[]) => {
        if (sql.includes('FROM ai_audit WHERE id')) {
          return aiAudit.find((r) => r.id === args[0]) as unknown
        }
        return undefined
      },
      run: (...args: unknown[]) => {
        if (sql.startsWith('INSERT INTO ai_audit')) {
          const [id, ts, tool, secid, a, summary, status, snapshot] = args
          aiAudit.push({
            id: String(id),
            ts: Number(ts),
            tool: String(tool),
            secid: secid as string | null,
            args: a as string | null,
            summary: String(summary),
            status: String(status),
            snapshot: snapshot as string | null
          })
          return {}
        }
        if (sql.includes("SET status='rolled_back'")) {
          const r = aiAudit.find((x) => x.id === args[0])
          if (r) r.status = 'rolled_back'
          return {}
        }
        if (sql.includes("SET status='denied'")) {
          const r = aiAudit.find((x) => x.id === args[0])
          if (r) r.status = 'denied'
          return {}
        }
        if (sql.includes('INSERT INTO settings')) {
          settings[String(args[0])] = String(args[1])
          return {}
        }
        return {}
      },
      all: () => {
        if (sql.includes('FROM ai_audit')) {
          return aiAudit
            .slice()
            .sort((a, b) => b.ts - a.ts)
            .map((r) => ({
              id: r.id,
              ts: r.ts,
              tool: r.tool,
              secid: r.secid,
              summary: r.summary,
              status: r.status
            }))
        }
        return []
      }
    }
    return stmt
  }

  return { aiAudit, settings, drawingsStore, fakePrepare }
})

vi.mock('../db', () => ({
  getDb: () => ({ prepare: (sql: string) => mocks.fakePrepare(sql) }),
  getSetting: (k: string) => mocks.settings[k] ?? null,
  setSetting: (k: string, v: string) => {
    mocks.settings[k] = v
  },
  saveDrawings: (secid: string, list: unknown[]) => {
    mocks.drawingsStore[secid] = list
  },
  getDrawings: (secid: string) => ({ current: mocks.drawingsStore[secid] ?? [], history: [] }),
  clearDrawings: (secid: string) => {
    mocks.drawingsStore[secid] = []
  },
  listWatchlist: () => []
}))

import { recordAudit, listAudit, getAuditEntry } from './audit'
import { registerRollbackHandlers } from './rollback-handlers'
import { rollbackAudit } from './rollback'
import { beginWrite, checkWriteAllowed } from './write-gate'

describe('AI 写操作审计与回滚', () => {
  beforeEach(() => {
    mocks.aiAudit.length = 0
    delete mocks.settings['ai.writeMode']
    delete mocks.settings['backtest.code']
    registerRollbackHandlers()
  })

  it('recordAudit 记录含快照，listAudit 倒序返回', () => {
    const e = recordAudit({ tool: 'write_strategy', summary: '写入策略', snapshot: '旧代码' })
    expect(e.status).toBe('applied')
    expect(listAudit()).toHaveLength(1)
    expect(getAuditEntry(e.id)?.snapshot).toBe('旧代码')
  })

  it('write_strategy 回滚：把快照写回 backtest.code 并标记 rolled_back', async () => {
    const entry = recordAudit({ tool: 'write_strategy', summary: '写入策略', snapshot: '旧代码' })
    mocks.settings['backtest.code'] = '新代码'
    const res = await rollbackAudit(entry.id)
    expect(res.ok).toBe(true)
    expect(mocks.settings['backtest.code']).toBe('旧代码')
    expect(getAuditEntry(entry.id)?.status).toBe('rolled_back')
  })

  it('已回滚/不存在/未注册工具的回滚被拒绝', async () => {
    const e1 = recordAudit({ tool: 'write_strategy', summary: 'x', snapshot: 's' })
    await rollbackAudit(e1.id)
    const again = await rollbackAudit(e1.id)
    expect(again.ok).toBe(false)

    const missing = await rollbackAudit('nope')
    expect(missing.ok).toBe(false)

    const unknown = recordAudit({ tool: 'not_a_tool', summary: 'x' })
    const r2 = await rollbackAudit(unknown.id)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('暂不支持回滚')
  })

  it('draw_lines 回滚恢复旧画线数组', async () => {
    mocks.drawingsStore['1.600519'] = []
    const entry = recordAudit({
      tool: 'draw_lines',
      secid: '1.600519',
      summary: '写入画线',
      snapshot: [{ id: 'a', type: 'hline', points: [{ x: 0, y: 100 }] }]
    })
    mocks.drawingsStore['1.600519'] = [{ id: 'b', type: 'segment', points: [] }]
    const res = await rollbackAudit(entry.id)
    expect(res.ok).toBe(true)
    expect(mocks.drawingsStore['1.600519']).toHaveLength(1)
    expect((mocks.drawingsStore['1.600519'][0] as { id: string }).id).toBe('a')
  })

  it('write-gate：auto 模式放行并记审计；confirm 模式拒绝', () => {
    const auto = beginWrite({ tool: 'draw_lines', secid: '1', summary: 'x' })
    expect(auto.ok).toBe(true)

    mocks.settings['ai.writeMode'] = 'confirm'
    const denied = beginWrite({ tool: 'draw_lines', secid: '1', summary: 'x' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toContain('确认')
  })

  it('write-gate：纯计算工具 checkWriteAllowed 受 writeMode 控制', () => {
    expect(checkWriteAllowed().ok).toBe(true)
    mocks.settings['ai.writeMode'] = 'confirm'
    expect(checkWriteAllowed().ok).toBe(false)
  })
})
