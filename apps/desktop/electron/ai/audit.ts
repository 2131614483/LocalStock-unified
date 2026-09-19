import type { AiAuditEntry } from '../../shared/types'
import { getDb } from '../db'

/**
 * AI 写操作审计：每次 AI 写策略/画线/选股都落一条 ai_audit 记录，
 * 带参数摘要与回滚快照（如旧策略代码 / 画线数据），可一键回滚。
 * 只读工具不产生审计。
 */

export function recordAudit(args: {
  tool: string
  secid?: string
  args?: unknown
  summary: string
  snapshot?: unknown
}): AiAuditEntry {
  const entry: AiAuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    tool: args.tool,
    secid: args.secid,
    summary: args.summary,
    status: 'applied'
  }
  getDb()
    .prepare(
      'INSERT INTO ai_audit (id, ts, tool, secid, args, summary, status, snapshot) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(
      entry.id,
      entry.ts,
      entry.tool,
      args.secid ?? null,
      args.args !== undefined ? JSON.stringify(args.args) : null,
      entry.summary,
      entry.status,
      args.snapshot !== undefined ? JSON.stringify(args.snapshot) : null
    )
  return entry
}

export function listAudit(limit = 50): AiAuditEntry[] {
  const rows = getDb()
    .prepare('SELECT id, ts, tool, secid, summary, status FROM ai_audit ORDER BY ts DESC LIMIT ?')
    .all(limit) as Array<{
    id: string
    ts: number
    tool: string
    secid: string | null
    summary: string
    status: string
  }>
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    tool: r.tool,
    secid: r.secid ?? undefined,
    summary: r.summary,
    status: r.status as AiAuditEntry['status']
  }))
}

export function getAuditEntry(
  id: string
): (AiAuditEntry & { args?: unknown; snapshot?: unknown }) | null {
  const row = getDb()
    .prepare('SELECT id, ts, tool, secid, args, summary, status, snapshot FROM ai_audit WHERE id = ?')
    .get(id) as
    | {
        id: string
        ts: number
        tool: string
        secid: string | null
        args: string | null
        summary: string
        status: string
        snapshot: string | null
      }
    | undefined
  if (!row) return null
  const entry: AiAuditEntry & { args?: unknown; snapshot?: unknown } = {
    id: row.id,
    ts: row.ts,
    tool: row.tool,
    secid: row.secid ?? undefined,
    summary: row.summary,
    status: row.status as AiAuditEntry['status']
  }
  for (const [key, raw] of [
    ['args', row.args],
    ['snapshot', row.snapshot]
  ] as const) {
    if (raw) {
      try {
        entry[key] = JSON.parse(raw)
      } catch {
        entry[key] = undefined
      }
    }
  }
  return entry
}

export function markRolledBack(id: string): void {
  getDb().prepare("UPDATE ai_audit SET status='rolled_back' WHERE id = ?").run(id)
}
