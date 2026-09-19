import { ipcMain } from 'electron'
import type {
  Quote,
  SelectionHit,
  SelectionResult,
  SelectionRule
} from '../../shared/types'
import { getDb } from '../db'
import { runSelectionAsync, scanAllMarketAsync } from '../market/sqlite-worker-client'
import { getQuotesSafe } from '../market/quotes'
import { evalFundamentalFilter, isFundamentalFilter, isTechnicalFilter } from './rules'
import type { ScanCandidate } from './scanner'

/**
 * 自动选股领域：
 *  - 规则引擎模式：技术面在 worker 全市场扫描（本地库，快），基本面合并实时快照。
 *  - AI 动态模式：由 agent 用只读工具分析后经 save_selection_result 落库。
 *  - 定时：scheduleMinutes 启用后按间隔自动重扫。
 */

// ---------- 规则 CRUD（localstock.db selection_rules） ----------

export function listRules(): SelectionRule[] {
  const rows = getDb()
    .prepare('SELECT id, name, mode, rule_json, schedule_minutes, enabled, created_at FROM selection_rules ORDER BY created_at')
    .all() as Array<{
    id: string
    name: string
    mode: string
    rule_json: string
    schedule_minutes: number | null
    enabled: number
    created_at: number
  }>
  return rows.map((r) => {
    let rule: Partial<SelectionRule> = {}
    try {
      rule = JSON.parse(r.rule_json)
    } catch {
      rule = {}
    }
    return {
      id: r.id,
      name: r.name,
      mode: (r.mode === 'ai' ? 'ai' : 'rule') as SelectionRule['mode'],
      enabled: !!r.enabled,
      filters: rule.filters ?? [],
      sort: rule.sort,
      top: rule.top,
      scheduleMinutes: r.schedule_minutes ?? rule.scheduleMinutes ?? null,
      createdAt: r.created_at
    }
  })
}

export function saveRule(rule: Partial<SelectionRule>): SelectionRule[] {
  const id = rule.id || `sr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const name = rule.name?.trim() || '未命名规则'
  const mode = rule.mode === 'ai' ? 'ai' : 'rule'
  const now = Date.now()
  const store: SelectionRule = {
    id,
    name,
    mode,
    enabled: rule.enabled ?? true,
    filters: rule.filters ?? [],
    sort: rule.sort,
    top: rule.top,
    scheduleMinutes: rule.scheduleMinutes ?? null,
    createdAt: rule.createdAt ?? now
  }
  getDb()
    .prepare(
      `INSERT INTO selection_rules (id, name, mode, rule_json, schedule_minutes, enabled, created_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, mode=excluded.mode, rule_json=excluded.rule_json,
         schedule_minutes=excluded.schedule_minutes, enabled=excluded.enabled`
    )
    .run(id, name, mode, JSON.stringify(store), store.scheduleMinutes ?? null, store.enabled ? 1 : 0, store.createdAt)
  return listRules()
}

export function deleteRule(id: string): SelectionRule[] {
  getDb().prepare('DELETE FROM selection_rules WHERE id = ?').run(id)
  return listRules()
}

// ---------- 扫描 ----------

const FUND_BATCH = 50

/** 市场快照（Quote）按 secid 索引（供基本面过滤） */
async function fetchQuotesFor(secids: string[]): Promise<Map<string, Quote>> {
  const map = new Map<string, Quote>()
  for (let i = 0; i < secids.length; i += FUND_BATCH) {
    const batch = secids.slice(i, i + FUND_BATCH)
    try {
      const quotes = await getQuotesSafe(batch)
      for (const q of quotes) map.set(q.secid, q)
    } catch {
      // 单批失败忽略
    }
  }
  return map
}

function sortCandidates(cands: ScanCandidate[], rule: SelectionRule): ScanCandidate[] {
  const sort = rule.sort
  if (!sort) return cands
  const dir = sort.order === 'asc' ? 1 : -1
  return [...cands].sort((a, b) => {
    let va: number
    let vb: number
    switch (sort.field) {
      case 'changePercent':
        va = a.changePercent
        vb = b.changePercent
        break
      case 'amount':
        va = a.amount
        vb = b.amount
        break
      case 'price':
        va = a.price
        vb = b.price
        break
      case 'score':
        va = a.reasons.length
        vb = b.reasons.length
        break
      default:
        va = a.changePercent
        vb = b.changePercent
    }
    return (va - vb) * dir
  })
}

/** 运行一次规则扫描（rule 模式）：worker 技术面 → 快照基本面 → 排序截断 → 落库 */
export async function runScan(rule: SelectionRule): Promise<SelectionResult> {
  const techFilters = rule.filters.filter(isTechnicalFilter)
  const fundFilters = rule.filters.filter(isFundamentalFilter)
  const cands =
    (await (techFilters.length
      ? runSelectionAsync(techFilters)
      : scanAllMarketAsync())) ?? []
  // 基本面过滤（快照缺失不拦截，避免因接口抖动整批失败）
  let hits: SelectionHit[] = cands
  if (fundFilters.length) {
    const quoteMap = await fetchQuotesFor(cands.map((c) => c.secid))
    hits = []
    for (const cand of cands) {
      const q = quoteMap.get(cand.secid)
      let pass = true
      const addReasons: string[] = []
      if (q) {
        for (const f of fundFilters) {
          const r = evalFundamentalFilter(f, q)
          if (!r.pass) {
            pass = false
            break
          }
          if (r.reason) addReasons.push(r.reason)
        }
      }
      if (pass) hits.push({ ...cand, reasons: [...cand.reasons, ...addReasons] })
    }
  }
  const sorted = sortCandidates(hits as ScanCandidate[], rule)
  const top = Math.max(1, rule.top ?? 30)
  const finalHits = sorted.slice(0, top)

  const result: SelectionResult = {
    id: `rs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ruleId: rule.id,
    ruleName: rule.name,
    mode: 'rule',
    scannedAt: Date.now(),
    total: cands.length,
    hits: finalHits
  }
  saveResult(result)
  return result
}

export function saveResult(result: SelectionResult): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO selection_results (id, rule_id, rule_name, mode, scanned_at, total, hits, data_json)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        result.id,
        result.ruleId,
        result.ruleName,
        result.mode,
        result.scannedAt,
        result.total,
        result.hits.length,
        JSON.stringify(result)
      )
    // 每规则只保留最近 20 次结果，避免无限增长
    getDb()
      .prepare(
        `DELETE FROM selection_results WHERE rule_id = ? AND id NOT IN (
           SELECT id FROM selection_results WHERE rule_id = ? ORDER BY scanned_at DESC LIMIT 20)`
      )
      .run(result.ruleId, result.ruleId)
  } catch {
    // 结果落库失败不影响返回
  }
}

export function listResults(limit = 20): SelectionResult[] {
  const rows = getDb()
    .prepare('SELECT data_json FROM selection_results ORDER BY scanned_at DESC LIMIT ?')
    .all(limit) as Array<{ data_json: string }>
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.data_json) as SelectionResult
      } catch {
        return null
      }
    })
    .filter((r): r is SelectionResult => !!r)
}

// ---------- 定时扫描 ----------

let scanTimer: NodeJS.Timeout | null = null

function lastScanAt(ruleId: string): number {
  const row = getDb()
    .prepare('SELECT MAX(scanned_at) AS t FROM selection_results WHERE rule_id = ?')
    .get(ruleId) as { t: number | null } | undefined
  return row?.t ?? 0
}

async function scanDueRules(): Promise<void> {
  const now = Date.now()
  for (const rule of listRules()) {
    if (!rule.enabled || rule.mode !== 'rule' || !rule.scheduleMinutes) continue
    if (now - lastScanAt(rule.id) < rule.scheduleMinutes * 60_000) continue
    try {
      await runScan(rule)
    } catch {
      // 单规则失败不影响其余
    }
  }
}

export function startSelectionScan(): void {
  if (scanTimer) return
  scanTimer = setInterval(() => void scanDueRules(), 60_000)
  void scanDueRules()
}

export function stopSelectionScan(): void {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
}

// ---------- IPC ----------

export function registerSelectionIpc(getWindow: () => Electron.BrowserWindow | null): void {
  ipcMain.handle('selection:listRules', () => listRules())
  ipcMain.handle('selection:saveRule', (_e, rule: Partial<SelectionRule>) => saveRule(rule))
  ipcMain.handle('selection:deleteRule', (_e, id: string) => deleteRule(id))
  ipcMain.handle('selection:runScan', (_e, rule: SelectionRule) => runScan(rule))
  ipcMain.handle('selection:getResults', () => listResults())
}
