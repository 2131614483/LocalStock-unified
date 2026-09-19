import { getDb, listWatchlist, saveDrawings, setSetting, addWatchlist, removeWatchlist } from '../db'
import { registerRollback } from './rollback'
import { saveRule, deleteRule } from '../selection'
import { setMinuteAnnotations } from '../minute-ai'
import type { SelectionRule } from '../../shared/types'

/**
 * 各写工具的回滚逻辑（Phase 2/3：策略/画线/选股/自选）。
 * 快照在 beginWrite 时记录：策略=旧代码，画线=旧画线数组，选股规则=旧规则，自选=旧 secid 列表。
 */
export function registerRollbackHandlers(): void {
  registerRollback('write_strategy', async ({ snapshot }) => {
    if (typeof snapshot !== 'string') return { ok: false, error: '回滚快照缺失' }
    setSetting('backtest.code', snapshot)
    return { ok: true }
  })

  // 画线三类共用一个回滚：把旧画线写回（saveDrawings 会再生成一个历史版本，可接受）
  const restoreDrawings = async (secid?: string, snapshot?: unknown) => {
    if (!secid || !Array.isArray(snapshot)) return { ok: false, error: '回滚快照缺失' }
    saveDrawings(secid, snapshot as never)
    return { ok: true }
  }
  registerRollback('draw_lines', async (e) => restoreDrawings(e.secid, e.snapshot))
  registerRollback('clear_drawings', async (e) => restoreDrawings(e.secid, e.snapshot))
  registerRollback('run_draw_algo', async (e) => restoreDrawings(e.secid, e.snapshot))

  // 纯计算（回测）无持久化状态，回滚即标记完成
  registerRollback('run_backtest', async () => ({ ok: true }))

  // 选股规则：新建→删除；更新→写回旧规则
  registerRollback('save_selection_rule', async ({ args, snapshot }) => {
    const ruleId = (args as { ruleId?: string })?.ruleId
    if (snapshot) {
      saveRule(snapshot as Partial<SelectionRule>)
      return { ok: true }
    }
    if (ruleId) {
      deleteRule(ruleId)
      return { ok: true }
    }
    return { ok: false, error: '缺少规则信息' }
  })
  registerRollback('delete_selection_rule', async ({ snapshot }) => {
    if (!snapshot) return { ok: false, error: '回滚快照缺失' }
    saveRule(snapshot as Partial<SelectionRule>)
    return { ok: true }
  })

  // AI 选股结果：按 args.resultId 删除
  registerRollback('save_selection_result', async ({ args }) => {
    const resultId = (args as { resultId?: string })?.resultId
    if (!resultId) return { ok: false, error: '缺少结果 ID' }
    getDb().prepare('DELETE FROM selection_results WHERE id = ?').run(resultId)
    return { ok: true }
  })

  // 自选：快照是操作前的 secid 列表，重置为快照
  registerRollback('apply_selection_to_watchlist', async ({ snapshot }) => {
    if (!Array.isArray(snapshot)) return { ok: false, error: '回滚快照缺失' }
    const target = new Set(snapshot as string[])
    for (const w of listWatchlist()) {
      if (!target.has(w.secid)) removeWatchlist(w.secid)
    }
    return { ok: true }
  })

  // 分时预测标注：快照是操作前的 {annotations, opinion}，恢复进会话存储
  registerRollback('apply_minute_annotations', async ({ secid, snapshot }) => {
    const prev = snapshot as { annotations?: unknown; opinion?: string } | null
    if (!secid) return { ok: false, error: '缺少 secid' }
    setMinuteAnnotations(
      secid,
      (prev?.annotations as never) ?? [],
      prev?.opinion ?? ''
    )
    return { ok: true }
  })
}
