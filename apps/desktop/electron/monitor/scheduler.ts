import { Notification } from 'electron'
import type {
  MonitorConfig,
  MonitorEvent,
  MonitorQuote,
  Quote,
  StockPrediction
} from '../../shared/types'
import { getQuotesSafe } from '../market/quotes'
import { getMarketList } from '../market/eastmoney'
import { listWatchlist } from '../db'
import { listAlertRules } from '../alerts'
import { predictStocks, type PredictStockInput } from './predict'
import {
  addMonitorEvent,
  cleanupRetention,
  getMonitorConfig,
  getMonitorStateMap,
  getPrediction,
  getPredictionStats,
  getPredictionsMap,
  getRecentQuotes,
  insertQuotes,
  listMonitorEvents,
  listMonitored,
  resolvePendingPredictions,
  savePrediction,
  savePredictionHistory,
  setMonitorState
} from './store'

export interface MonitorPush {
  quotes(stocks: MonitorQuote[]): void
  events(ev: MonitorEvent): void
  config(cfg: MonitorConfig): void
  stats(s: import('../../shared/types').MonitorPredictionStats): void
}

const MARKET_CACHE_MS = 60_000

export class MonitorScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastAiRun = 0
  /** secid -> 上次 tick 的价格/涨跌幅（用于预警跨越检测） */
  private lastPrice = new Map<string, number>()
  private lastPct = new Map<string, number>()
  /** secid -> 上次 AI 预测时的参考价（异动触发用） */
  private lastPredictedPrice = new Map<string, number>()
  private marketCache: { ts: number; quotes: Quote[] } | null = null
  private ticking = false

  constructor(private push: MonitorPush) {}

  start(cfg: MonitorConfig): void {
    this.stop()
    this.seedStateFromDb()
    if (!cfg.enabled) return
    const interval = Math.max(5000, Number(cfg.interval) || 60_000) * 1000
    this.timer = setInterval(() => void this.tick(cfg), interval)
    void this.tick(cfg)
  }

  /** 从库恢复上次涨跌幅/价格（预警去重跨重启：不因重启重复预警） */
  private seedStateFromDb(): void {
    const m = getMonitorStateMap()
    for (const [secid, st] of m) {
      this.lastPct.set(secid, st.pct)
      this.lastPrice.set(secid, st.price)
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 配置变更后推送给监盘窗口（start 由调用方重启定时） */
  pushConfig(cfg: MonitorConfig): void {
    this.push.config(cfg)
  }

  private async fetchScopeQuotes(cfg: MonitorConfig): Promise<Quote[]> {
    if (cfg.scope !== 'market') {
      const monitored = listMonitored()
      const watchlist = cfg.scope === 'watchlist' ? listWatchlist() : []
      const items = cfg.scope === 'watchlist' ? [...monitored, ...watchlist] : monitored
      if (!items.length) return []
      return getQuotesSafe(items.map((x) => x.secid))
    }
    // 全市场：分页拉取实时列表，60s 缓存（重，但由开关+间隔控制）
    const now = Date.now()
    if (this.marketCache && now - this.marketCache.ts < MARKET_CACHE_MS) {
      return this.marketCache.quotes
    }
    const quotes: Quote[] = []
    try {
      let pn = 1
      const pz = 100
      while (pn <= 60) {
        const page = await getMarketList({ pn, pz, fid: 'f12', order: 'asc' })
        quotes.push(...page.list)
        if (pn * pz >= page.total) break
        pn++
      }
    } catch (err) {
      console.error('[monitor] 全市场拉取失败:', (err as Error).message)
    }
    this.marketCache = { ts: now, quotes }
    return quotes
  }

  private shouldTriggerAi(cfg: MonitorConfig, quotes: Quote[]): boolean {
    if (!cfg.aiEnabled) return false
    const now = Date.now()
    if (cfg.aiTrigger === 'anomaly' || cfg.aiTrigger === 'both') {
      for (const q of quotes) {
        const ref = this.lastPredictedPrice.get(q.secid)
        if (ref && ref > 0) {
          const move = Math.abs((q.price - ref) / ref) * 100
          if (move >= cfg.anomalyPct) return true
        }
      }
    }
    if (cfg.aiTrigger === 'scheduled' || cfg.aiTrigger === 'both') {
      if (now - this.lastAiRun >= (cfg.aiIntervalSec || 300) * 1000) return true
    }
    return false
  }

  private buildPredictInput(secid: string, name: string, code: string): PredictStockInput | null {
    const recent = getRecentQuotes(secid, 30)
    if (!recent.length) return null
    const last = recent[recent.length - 1]
    const prev = getPrediction(secid)
    const refPrice = this.lastPredictedPrice.get(secid) ?? last.price
    // 降采样到最多 12 点（提速：减少传给模型的 token）
    const step = Math.max(1, Math.ceil(recent.length / 12))
    const series = recent.filter((_, i) => i % step === 0).map((r) => ({ t: r.ts, p: r.price }))
    const first = recent[0]
    const momentumPct =
      first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0
    return {
      secid,
      code,
      name,
      price: last.price,
      changePercent: last.changePercent ?? 0,
      high: last.high || last.price,
      low: last.low || last.price,
      series,
      momentumPct,
      prevPrice: refPrice,
      prevPrediction: prev
        ? `${prev.direction}(${(prev.confidence * 100).toFixed(0)}%) ${prev.reason}`
        : undefined
    }
  }

  private async runAi(cfg: MonitorConfig, quotes: Quote[]): Promise<void> {
    const inputs: PredictStockInput[] = []
    for (const q of quotes) {
      const input = this.buildPredictInput(q.secid, q.name, q.code)
      if (input) inputs.push(input)
    }
    if (!inputs.length) return
    this.lastAiRun = Date.now()
    const predictions = await predictStocks(inputs)
    for (const p of predictions) {
      savePrediction(p)
      const ref = inputs.find((i) => i.secid === p.secid)
      const refPrice = ref ? ref.price : 0
      if (ref) this.lastPredictedPrice.set(p.secid, ref.price)
      // 历史入库（供命中率判定）
      if (refPrice > 0) savePredictionHistory(p, refPrice)
      const ev = addMonitorEvent({
        secid: p.secid,
        name: p.name,
        type: 'prediction',
        content: `预测${p.direction === 'up' ? '偏涨' : p.direction === 'down' ? '偏跌' : '震荡'}`
          + `（置信 ${(p.confidence * 100).toFixed(0)}%）${p.targetPrice ? `，目标 ${p.targetPrice}` : ''}`
          + `｜${p.reason}`
      })
      this.push.events(ev)
    }
  }

  private evalAlerts(cfg: MonitorConfig, quotes: Quote[]): void {
    // 1) 涨跌幅阈值跨越（进/出区间才提醒一次）
    for (const q of quotes) {
      const pct = q.changePercent ?? 0
      const prev = this.lastPct.get(q.secid) ?? 0
      if (Math.abs(pct) >= cfg.alertPct && Math.abs(prev) < cfg.alertPct) {
        this.notifyEvent({
          secid: q.secid,
          name: q.name,
          type: 'alert',
          content: `${q.name} ${pct > 0 ? '涨' : '跌'} ${Math.abs(pct).toFixed(2)}%（现价 ${q.price}，较昨收）`
        })
      }
      this.lastPct.set(q.secid, pct)
    }
    // 2) 现有预警规则里的价格阈值（price_above/price_below）实时触发
    for (const rule of listAlertRules()) {
      if (!rule.enabled || (rule.type !== 'price_above' && rule.type !== 'price_below')) continue
      const q = quotes.find((x) => x.secid === rule.secid)
      if (!q) continue
      const prev = this.lastPrice.get(q.secid)
      const thresh = rule.threshold ?? 0
      if (prev !== undefined && ((rule.type === 'price_above' && prev <= thresh && q.price > thresh) ||
          (rule.type === 'price_below' && prev >= thresh && q.price < thresh))) {
        this.notifyEvent({
          secid: q.secid,
          name: q.name,
          type: 'alert',
          content: `${q.name} 现价 ${q.price} ${rule.type === 'price_above' ? '上穿' : '跌破'} ${thresh}`
        })
      }
    }
    for (const q of quotes) this.lastPrice.set(q.secid, q.price)
  }

  private notifyEvent(ev: Omit<MonitorEvent, 'id' | 'ts'>): void {
    const full = addMonitorEvent(ev)
    this.push.events(full)
    try {
      new Notification({ title: `监盘 · ${ev.name}`, body: ev.content }).show()
    } catch {
      // 通知失败忽略
    }
  }

  async tick(cfg: MonitorConfig): Promise<void> {
    if (!cfg.enabled || this.ticking) return
    this.ticking = true
    try {
      const quotes = await this.fetchScopeQuotes(cfg)
      if (!quotes.length) return

      insertQuotes(quotes)
      cleanupRetention(cfg.retention)
      this.evalAlerts(cfg, quotes)
      // 持久化预警状态（lastPct/lastPrice 跨重启，避免重启后重复预警）
      for (const q of quotes) setMonitorState(q.secid, q.changePercent ?? 0, q.price)

      // 判定到期的 AI 预测（超时 → 按最新价判命中/落空）
      const latest = new Map(quotes.map((q) => [q.secid, q.price]))
      const resolved = resolvePendingPredictions(latest, (cfg.predictionHorizonMin || 30) * 60_000)
      if (resolved > 0) this.push.stats(getPredictionStats())

      // 组装推送给监盘窗口（含缓存预测）
      const preds = getPredictionsMap()
      const stocks: MonitorQuote[] = quotes.map((q) => ({
        ...q,
        prediction: preds.get(q.secid) ?? null
      }))
      this.push.quotes(stocks)

      if (this.shouldTriggerAi(cfg, quotes)) {
        await this.runAi(cfg, quotes)
      }
    } finally {
      this.ticking = false
    }
  }
}

/** 供监盘窗口/主窗口初始化时取一次完整状态 */
export function buildMonitorState(): {
  config: MonitorConfig
  stocks: MonitorQuote[]
  events: MonitorEvent[]
} {
  const config = getMonitorConfig()
  const preds = getPredictionsMap()
  const monitored = listMonitored()
  const stocks: MonitorQuote[] = []
  for (const m of monitored) {
    const recent = getRecentQuotes(m.secid, 1)
    const last = recent[recent.length - 1]
    if (!last) continue
    stocks.push({
      secid: m.secid,
      code: m.code,
      name: m.name,
      price: last.price,
      change: last.price - last.price / (1 + (last.changePercent || 0) / 100),
      changePercent: last.changePercent,
      open: 0,
      preClose: last.price / (1 + (last.changePercent || 0) / 100),
      high: last.high,
      low: last.low,
      volume: last.volume,
      amount: last.amount,
      prediction: preds.get(m.secid) ?? null
    })
  }
  return { config, stocks, events: listMonitorEvents(100) }
}
