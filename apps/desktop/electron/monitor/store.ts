import type {
  MonitorConfig,
  MonitorEvent,
  MonitorPredictionStats,
  PerHourStat,
  PerStockStat,
  Quote,
  StockPrediction,
  WatchItem
} from '../../shared/types'
import { getDb, getSetting, setSetting, listWatchlist } from '../db'
import { resolveOutcome, computeStats, computePerStock, computePerHour } from './stats'

/**
 * 实时监盘数据层：配置、监控列表、实时行情入库（quote_history）、事件日志、AI 预测缓存。
 */

const DEFAULT_CONFIG: MonitorConfig = {
  enabled: false,
  scope: 'monitor',
  interval: 60,
  aiEnabled: true,
  aiTrigger: 'both',
  aiIntervalSec: 300,
  anomalyPct: 1.5,
  alertPct: 1.5,
  predictionHorizonMin: 30,
  retention: 2000
}

const KEY = (k: keyof MonitorConfig): string => `monitor.${k}`

export function getMonitorConfig(): MonitorConfig {
  const cfg = { ...DEFAULT_CONFIG }
  cfg.enabled = getSetting(KEY('enabled')) === '1'
  const scope = getSetting(KEY('scope'))
  if (scope === 'monitor' || scope === 'watchlist' || scope === 'market') cfg.scope = scope
  const iv = Number(getSetting(KEY('interval')))
  if ([5, 10, 15, 20, 30, 60, 120, 180, 300].includes(iv)) cfg.interval = iv
  cfg.aiEnabled = getSetting(KEY('aiEnabled')) !== '0'
  const tr = getSetting(KEY('aiTrigger'))
  if (tr === 'scheduled' || tr === 'anomaly' || tr === 'both') cfg.aiTrigger = tr
  cfg.aiIntervalSec = Number(getSetting(KEY('aiIntervalSec'))) || 300
  cfg.anomalyPct = Number(getSetting(KEY('anomalyPct'))) || 1.5
  cfg.alertPct = Number(getSetting(KEY('alertPct'))) || 1.5
  cfg.predictionHorizonMin = Number(getSetting(KEY('predictionHorizonMin'))) || 30
  cfg.retention = Number(getSetting(KEY('retention'))) || 2000
  return cfg
}

export function saveMonitorConfig(patch: Partial<MonitorConfig>): MonitorConfig {
  const next = { ...getMonitorConfig(), ...patch }
  setSetting(KEY('enabled'), next.enabled ? '1' : '0')
  setSetting(KEY('scope'), next.scope)
  setSetting(KEY('interval'), String(next.interval))
  setSetting(KEY('aiEnabled'), next.aiEnabled ? '1' : '0')
  setSetting(KEY('aiTrigger'), next.aiTrigger)
  setSetting(KEY('aiIntervalSec'), String(next.aiIntervalSec))
  setSetting(KEY('anomalyPct'), String(next.anomalyPct))
  setSetting(KEY('alertPct'), String(next.alertPct))
  setSetting(KEY('predictionHorizonMin'), String(next.predictionHorizonMin))
  setSetting(KEY('retention'), String(next.retention))
  return next
}

// ---------- 监控列表 ----------

export function seedMonitorList(): void {
  const d = getDb()
  const count = (d.prepare('SELECT COUNT(*) AS c FROM monitor_list').get() as { c: number }).c
  if (count > 0) return
  const insert = d.prepare('INSERT OR IGNORE INTO monitor_list (secid, code, name, added_at) VALUES (?,?,?,?)')
  const tx = d.transaction(() => {
    for (const w of listWatchlist()) insert.run(w.secid, w.code, w.name, Date.now())
  })
  tx()
}

export function listMonitored(): WatchItem[] {
  return getDb()
    .prepare('SELECT secid, code, name FROM monitor_list ORDER BY added_at')
    .all() as WatchItem[]
}

export function addMonitored(item: WatchItem): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO monitor_list (secid, code, name, added_at) VALUES (?,?,?,?)')
    .run(item.secid, item.code, item.name, Date.now())
}

export function removeMonitored(secid: string): void {
  getDb().prepare('DELETE FROM monitor_list WHERE secid = ?').run(secid)
}

// ---------- 实时行情入库 ----------

export function insertQuotes(quotes: Quote[]): void {
  const d = getDb()
  if (!quotes.length) return
  const ins = d.prepare(
    'INSERT INTO quote_history (secid, code, name, price, change_percent, volume, amount, high, low, ts) VALUES (?,?,?,?,?,?,?,?,?,?)'
  )
  const ts = Date.now()
  const tx = d.transaction(() => {
    for (const q of quotes) {
      ins.run(q.secid, q.code, q.name, q.price, q.changePercent ?? 0, q.volume ?? 0, q.amount ?? 0, q.high ?? 0, q.low ?? 0, ts)
    }
  })
  tx()
}

/** 某股最近 N 笔实时快照（时间升序，供趋势/AI 分析） */
export interface RealtimeSample {
  price: number
  changePercent: number
  volume: number
  amount: number
  high: number
  low: number
  ts: number
}

export function getRecentQuotes(secid: string, limit = 60): RealtimeSample[] {
  const rows = getDb()
    .prepare(
      'SELECT price, change_percent, volume, amount, high, low, ts FROM quote_history WHERE secid=? ORDER BY ts DESC LIMIT ?'
    )
    .all(secid, limit) as Array<{
    price: number
    change_percent: number
    volume: number
    amount: number
    high: number
    low: number
    ts: number
  }>
  return rows.reverse().map((r) => ({
    price: r.price,
    changePercent: r.change_percent,
    volume: r.volume,
    amount: r.amount,
    high: r.high,
    low: r.low,
    ts: r.ts
  }))
}

/** 保留清理：每只股票只保留最近 retention 条（整库按 secid 分组裁剪，仅对超过阈值的执行） */
export function cleanupRetention(retention: number): void {
  const d = getDb()
  try {
    d.prepare(
      `DELETE FROM quote_history WHERE id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY secid ORDER BY ts DESC) AS rn
           FROM quote_history
         ) WHERE rn <= ?
       )`
    ).run(retention)
  } catch {
    // ROW_NUMBER 不可用（旧 SQLite）时按 secid 逐个裁剪
    try {
      const secids = d.prepare('SELECT DISTINCT secid FROM quote_history').all() as Array<{ secid: string }>
      const del = d.prepare(
        `DELETE FROM quote_history WHERE secid=? AND id NOT IN (
           SELECT id FROM quote_history WHERE secid=? ORDER BY ts DESC LIMIT ?
         )`
      )
      const tx = d.transaction(() => {
        for (const s of secids) del.run(s.secid, s.secid, retention)
      })
      tx()
    } catch {
      // 清理失败不影响主流程
    }
  }
}

// ---------- 事件日志 ----------

export function addMonitorEvent(ev: Omit<MonitorEvent, 'id' | 'ts'>): MonitorEvent {
  const full: MonitorEvent = {
    id: `me_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    ...ev
  }
  try {
    getDb()
      .prepare('INSERT INTO monitor_events (id, ts, secid, name, type, content) VALUES (?,?,?,?,?,?)')
      .run(full.id, full.ts, full.secid, full.name, full.type, full.content)
    // 只保留最近 500 条
    getDb()
      .prepare(
        `DELETE FROM monitor_events WHERE id NOT IN (SELECT id FROM monitor_events ORDER BY ts DESC LIMIT 500)`
      )
      .run()
  } catch {
    // 记录失败不影响
  }
  return full
}

export function listMonitorEvents(limit = 100): MonitorEvent[] {
  const rows = getDb()
    .prepare('SELECT id, ts, secid, name, type, content FROM monitor_events ORDER BY ts DESC LIMIT ?')
    .all(limit) as Array<Omit<MonitorEvent, ''> & { id: string }>
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    secid: r.secid,
    name: r.name,
    type: r.type as MonitorEvent['type'],
    content: r.content
  }))
}

// ---------- AI 预测缓存 ----------

export function savePrediction(p: StockPrediction): void {
  getDb()
    .prepare('INSERT INTO ai_predictions (secid, prediction, ts) VALUES (?,?,?) ON CONFLICT(secid) DO UPDATE SET prediction=excluded.prediction, ts=excluded.ts')
    .run(p.secid, JSON.stringify(p), p.predictedAt)
}

export function getPredictionsMap(): Map<string, StockPrediction> {
  const rows = getDb()
    .prepare('SELECT secid, prediction FROM ai_predictions')
    .all() as Array<{ secid: string; prediction: string }>
  const map = new Map<string, StockPrediction>()
  for (const r of rows) {
    try {
      map.set(r.secid, JSON.parse(r.prediction) as StockPrediction)
    } catch {
      // 忽略损坏缓存
    }
  }
  return map
}

export function getPrediction(secid: string): StockPrediction | null {
  const row = getDb()
    .prepare('SELECT prediction FROM ai_predictions WHERE secid = ?')
    .get(secid) as { prediction: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.prediction) as StockPrediction
  } catch {
    return null
  }
}

// ---------- AI 预测历史 / 命中率 ----------

export function savePredictionHistory(
  p: StockPrediction,
  refPrice: number
): void {
  getDb()
    .prepare(
      `INSERT INTO prediction_history
       (secid, code, name, direction, confidence, target_price, support, resistance, reason, ref_price, predicted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      p.secid,
      p.code,
      p.name,
      p.direction,
      p.confidence,
      p.targetPrice ?? null,
      p.support ?? null,
      p.resistance ?? null,
      p.reason,
      refPrice,
      p.predictedAt
    )
}

/** 判定超时的待定预测（最新价 <→ outcome） */
export function resolvePendingPredictions(
  latestPrices: Map<string, number>,
  horizonMs: number
): number {
  const now = Date.now()
  const rows = getDb()
    .prepare(
      "SELECT id, secid, direction, ref_price FROM prediction_history WHERE outcome='pending' AND predicted_at <= ? LIMIT 500"
    )
    .all(now - horizonMs) as Array<{
    id: number
    secid: string
    direction: string
    ref_price: number
  }>
  if (!rows.length) return 0
  const update = getDb().prepare(
    "UPDATE prediction_history SET outcome=?, actual_price=?, resolved_at=? WHERE id=?"
  )
  const tx = getDb().transaction(() => {
    for (const r of rows) {
      const actual = latestPrices.get(r.secid)
      if (actual === undefined) continue
      const outcome = resolveOutcome(
        r.direction === 'down' ? 'down' : r.direction === 'flat' ? 'flat' : 'up',
        r.ref_price,
        actual
      )
      update.run(outcome, actual, now, r.id)
    }
  })
  tx()
  return rows.length
}

/** 命中率统计（最近 7 天已判定样本） */
export function getPredictionStats(): MonitorPredictionStats {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const rows = getDb()
    .prepare(
      'SELECT direction, confidence, outcome FROM prediction_history WHERE predicted_at >= ?'
    )
    .all(weekAgo) as Array<{ direction: string; confidence: number; outcome: string }>
  return computeStats(
    rows.map((r) => ({
      direction: (r.direction === 'down' ? 'down' : r.direction === 'flat' ? 'flat' : 'up') as 'up' | 'down' | 'flat',
      confidence: r.confidence,
      outcome: (r.outcome === 'hit' ? 'hit' : r.outcome === 'miss' ? 'miss' : 'pending') as 'pending' | 'hit' | 'miss'
    }))
  )
}

/** 命中率按股票细分（最近 7 天） */
export function getPredictionStatsByStock(): PerStockStat[] {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const rows = getDb()
    .prepare(
      'SELECT secid, name, code, direction, confidence, outcome FROM prediction_history WHERE predicted_at >= ?'
    )
    .all(weekAgo) as Array<{
    secid: string
    name: string
    code: string
    direction: string
    confidence: number
    outcome: string
  }>
  return computePerStock(
    rows.map((r) => ({
      secid: r.secid,
      name: r.name ?? '',
      code: r.code ?? '',
      direction: (r.direction === 'down' ? 'down' : r.direction === 'flat' ? 'flat' : 'up') as 'up' | 'down' | 'flat',
      confidence: r.confidence,
      outcome: (r.outcome === 'hit' ? 'hit' : r.outcome === 'miss' ? 'miss' : 'pending') as 'pending' | 'hit' | 'miss'
    }))
  )
}

/** 命中率按小时（预测发起时刻）统计（最近 7 天） */
export function getPredictionStatsByHour(): PerHourStat[] {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const rows = getDb()
    .prepare(
      'SELECT predicted_at, direction, confidence, outcome FROM prediction_history WHERE predicted_at >= ?'
    )
    .all(weekAgo) as Array<{
    predicted_at: number
    direction: string
    confidence: number
    outcome: string
  }>
  return computePerHour(
    rows.map((r) => ({
      hour: new Date(r.predicted_at).getHours(),
      direction: (r.direction === 'down' ? 'down' : r.direction === 'flat' ? 'flat' : 'up') as 'up' | 'down' | 'flat',
      confidence: r.confidence,
      outcome: (r.outcome === 'hit' ? 'hit' : r.outcome === 'miss' ? 'miss' : 'pending') as 'pending' | 'hit' | 'miss'
    }))
  )
}

// ---------- 监盘状态持久化（预警去重跨重启） ----------

export function getMonitorStateMap(): Map<string, { pct: number; price: number; ts: number }> {
  const rows = getDb()
    .prepare('SELECT secid, last_pct, last_price, last_ts FROM monitor_state')
    .all() as Array<{ secid: string; last_pct: number; last_price: number; last_ts: number }>
  const map = new Map<string, { pct: number; price: number; ts: number }>()
  for (const r of rows) map.set(r.secid, { pct: r.last_pct, price: r.last_price, ts: r.last_ts })
  return map
}

export function setMonitorState(secid: string, pct: number, price: number): void {
  getDb()
    .prepare(
      'INSERT INTO monitor_state (secid, last_pct, last_price, last_ts) VALUES (?,?,?,?) ON CONFLICT(secid) DO UPDATE SET last_pct=excluded.last_pct, last_price=excluded.last_price, last_ts=excluded.last_ts'
    )
    .run(secid, pct, price, Date.now())
}
