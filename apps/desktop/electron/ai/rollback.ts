import { getAuditEntry, markRolledBack } from './audit'

type RollbackHandler = (entry: {
  tool: string
  secid?: string
  args?: unknown
  snapshot?: unknown
}) => Promise<{ ok: boolean; error?: string }>

const handlers = new Map<string, RollbackHandler>()

/** 各写工具在 Phase 2 注册自己的回滚逻辑 */
export function registerRollback(tool: string, fn: RollbackHandler): void {
  handlers.set(tool, fn)
}

/** 依据审计记录回滚一次 AI 写操作 */
export async function rollbackAudit(
  auditId: string
): Promise<{ ok: boolean; error?: string }> {
  const entry = getAuditEntry(auditId)
  if (!entry) return { ok: false, error: '审计记录不存在' }
  if (entry.status !== 'applied') return { ok: false, error: '该记录已回滚或未应用' }
  const fn = handlers.get(entry.tool)
  if (!fn) return { ok: false, error: `「${entry.tool}」暂不支持回滚` }
  const res = await fn({
    tool: entry.tool,
    secid: entry.secid,
    args: entry.args,
    snapshot: entry.snapshot
  })
  if (!res.ok) return res
  markRolledBack(auditId)
  return { ok: true }
}
