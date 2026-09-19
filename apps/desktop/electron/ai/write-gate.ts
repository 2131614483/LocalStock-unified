import type { AiAuditEntry } from '../../shared/types'
import { loadAiConfig } from './provider'
import { recordAudit } from './audit'
import { getDb } from '../db'

/**
 * 写操作门控：AI 三类写（策略/画线/选股）统一入口。
 * - writeMode='confirm' → 拒绝并说明，让 AI 转告用户切为自动或手动操作。
 * - writeMode='auto'    → 先记审计（含回滚快照），再执行；失败把审计标记为 denied。
 */

export interface WriteMeta {
  tool: string
  secid?: string
  args?: unknown
  summary: string
  snapshot?: unknown
}

export type WriteGateResult =
  | { ok: true; entry: AiAuditEntry }
  | { ok: false; error: string }

export function beginWrite(meta: WriteMeta): WriteGateResult {
  const cfg = loadAiConfig()
  if (cfg.writeMode === 'confirm') {
    return {
      ok: false,
      error:
        '该写操作需要用户确认。请把要做的改动展示给用户，建议用户手动操作，或在 AI 设置中把「写操作」切换为「自动执行 + 审计」。'
    }
  }
  try {
    const entry = recordAudit({
      tool: meta.tool,
      secid: meta.secid,
      args: meta.args,
      summary: meta.summary,
      snapshot: meta.snapshot
    })
    return { ok: true, entry }
  } catch (err) {
    return {
      ok: false,
      error: `写操作审计记录失败：${err instanceof Error ? err.message : String(err)}`
    }
  }
}

/** 仅校验是否允许写（不落审计，用于纯计算型工具如 run_backtest） */
export function checkWriteAllowed(): { ok: true } | { ok: false; error: string } {
  const cfg = loadAiConfig()
  if (cfg.writeMode === 'confirm') {
    return {
      ok: false,
      error:
        '该操作需要用户确认。请先向用户说明计划，建议用户手动操作，或在 AI 设置中把「写操作」切换为「自动执行 + 审计」。'
    }
  }
  return { ok: true }
}

/** 写失败时把审计标记为 denied（不当作已应用） */
export function markWriteFailed(entryId: string): void {
  try {
    getDb().prepare("UPDATE ai_audit SET status='denied' WHERE id = ?").run(entryId)
  } catch {
    // 标记失败不影响主流程
  }
}
