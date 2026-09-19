import { ipcMain, Notification } from 'electron'
import type { AlertRule } from '../shared/types'
import { getDb } from './db'
import { evaluateRule } from './alerts/engine'
import { getLocalKlineAsync } from './market/sqlite-worker-client'

/**
 * 预警闭环：规则存储（localstock.db alert_rules/alert_events）+ 定时扫描（日K，worker 查询）
 * + 同信号去重 + 系统通知。扫描范围 = 各规则指定的股票。
 */

function ensureTables(): void {
  getDb() // 触发迁移 runner（alert 表由 migration v2 创建）
}

function listRules(): AlertRule[] {
  ensureTables()
  const rows = getDb()
    .prepare('SELECT * FROM alert_rules ORDER BY created_at')
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id),
    secid: String(r.secid),
    name: String(r.name ?? ''),
    type: String(r.type) as AlertRule['type'],
    fast: r.fast as number | undefined,
    slow: r.slow as number | undefined,
    threshold: r.threshold as number | undefined,
    enabled: !!r.enabled
  }))
}

/** 供 AI 工具只读预警规则列表 */
export function listAlertRules(): AlertRule[] {
  return listRules()
}

/** 同信号去重改为 DB 支撑：按 (rule_id, secid, signal) 判断当天是否已触发，跨重启不重复 */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function alreadyFiredToday(ruleId: string, secid: string, signal: string): boolean {
  try {
    const row = getDb()
      .prepare(
        'SELECT 1 FROM alert_events WHERE rule_id=? AND secid=? AND signal=? AND fired_at>=? LIMIT 1'
      )
      .get(ruleId, secid, signal, startOfToday())
    return !!row
  } catch {
    return false
  }
}

function recordEvent(rule: AlertRule, signal: string, message: string): void {
  try {
    ensureTables()
    getDb()
      .prepare(
        'INSERT INTO alert_events (id, rule_id, secid, signal, message, fired_at) VALUES (?,?,?,?,?,?)'
      )
      .run(
        `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        rule.id,
        rule.secid,
        signal,
        message,
        Date.now()
      )
  } catch {
    // 记录失败不影响通知
  }
}

function notify(rule: AlertRule, message: string): void {
  try {
    new Notification({ title: `预警 · ${rule.name}`, body: message }).show()
  } catch {
    // 通知失败忽略
  }
}

async function scanOnce(): Promise<{ scanned: number; fired: number }> {
  const rules = listRules().filter((r) => r.enabled)
  if (!rules.length) return { scanned: 0, fired: 0 }
  let fired = 0
  for (const rule of rules) {
    try {
      const k = await getLocalKlineAsync(rule.secid, 101) // 日K（worker 查询，不阻塞主进程）
      if (!k || k.points.length < 5) continue
      const res = evaluateRule(
        rule,
        k.points.map((p) => p.close),
        k.points.map((p) => p.volume)
      )
      if (res.fired && res.signal) {
        if (alreadyFiredToday(rule.id, rule.secid, res.signal)) continue
        recordEvent(rule, res.signal, res.message)
        notify(rule, res.message)
        fired++
      }
    } catch {
      // 单条规则失败不影响其余
    }
  }
  return { scanned: rules.length, fired }
}

export function registerAlertIpc(): void {
  ensureTables()
  ipcMain.handle('alerts:list', () => listRules())
  ipcMain.handle('alerts:add', (_e, rule: AlertRule) => {
    const id = rule.id || `ar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    ensureTables()
    getDb()
      .prepare(
        'INSERT OR REPLACE INTO alert_rules (id, secid, name, type, fast, slow, threshold, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run(
        id,
        rule.secid,
        rule.name ?? '',
        rule.type,
        rule.fast ?? null,
        rule.slow ?? null,
        rule.threshold ?? null,
        rule.enabled ? 1 : 0,
        Date.now()
      )
    return listRules()
  })
  ipcMain.handle('alerts:remove', (_e, id: string) => {
    ensureTables()
    getDb().prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
    return listRules()
  })
  ipcMain.handle('alerts:toggle', (_e, id: string, enabled: boolean) => {
    ensureTables()
    getDb().prepare('UPDATE alert_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    return listRules()
  })
  ipcMain.handle('alerts:scanNow', () => scanOnce())
}

let scanTimer: NodeJS.Timeout | null = null

/** 启动预警扫描（60s 间隔；app ready 后调用） */
export function startAlertScan(): void {
  if (scanTimer) return
  scanTimer = setInterval(() => void scanOnce(), 60_000)
  void scanOnce()
}

export function stopAlertScan(): void {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
}
