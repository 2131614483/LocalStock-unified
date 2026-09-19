import { useEffect, useState } from 'react'
import type {
  MonitorConfig,
  MonitorEvent,
  MonitorPredictionStats,
  MonitorQuote,
  PerHourStat,
  PerStockStat,
  SearchResult
} from '../shared/types'

import { getMarketStatus } from '../shared/market-session'
import SplitPane from './components/SplitPane'
import TitleBarControls from './components/TitleBarControls'

const INTERVALS = [5, 10, 15, 20, 30, 60, 120, 180, 300]
const AI_INTERVALS = [60, 120, 300, 600]

function dirLabel(d: string): string {
  return d === 'up' ? '↑' : d === 'down' ? '↓' : '→'
}

function DirectionTag({ direction }: { direction: string }) {
  return (
    <span className={`mon-dir ${direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'flat'}`}>
      {dirLabel(direction)}
    </span>
  )
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

export default function MonitorApp() {
  const [config, setConfig] = useState<MonitorConfig | null>(null)
  const [stocks, setStocks] = useState<MonitorQuote[]>([])
  const [events, setEvents] = useState<MonitorEvent[]>([])
  const [stats, setStats] = useState<MonitorPredictionStats | null>(null)
  const [pinned, setPinned] = useState(false)
  const [opacity, setOpacity] = useState(1)
  const [large, setLarge] = useState(false)
  const [detail, setDetail] = useState(false)
  const [byStock, setByStock] = useState<PerStockStat[]>([])
  const [byHour, setByHour] = useState<PerHourStat[]>([])
  const [kw, setKw] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  const toggleDetail = (): void => {
    const nv = !detail
    setDetail(nv)
    if (nv) {
      void Promise.all([
        window.api.monitor.getPredictionStatsByStock(),
        window.api.monitor.getPredictionStatsByHour()
      ]).then(([s, h]) => {
        setByStock(s)
        setByHour(h)
      })
    }
  }

  useEffect(() => {
    const api = window.api.monitor
    void api.getState().then((s) => {
      setConfig(s.config)
      setStocks(s.stocks)
      setEvents(s.events)
    })
    void api.getPredictionStats().then(setStats)
    const offQ = api.onQuotes((s) => setStocks(s))
    const offE = api.onEvents((ev) => setEvents((prev) => [ev, ...prev].slice(0, 200)))
    const offC = api.onConfig((c) => setConfig(c))
    const offS = api.onStats(setStats)
    return () => {
      offQ()
      offE()
      offC()
      offS()
    }
  }, [])

  const setCfg = (patch: Partial<MonitorConfig>): void => {
    void window.api.monitor.setConfig(patch).then(setConfig)
  }

  const handleSearch = async (v: string): Promise<void> => {
    setKw(v)
    if (!v.trim()) {
      setResults([])
      return
    }
    try {
      const r = await window.api.market.search(v)
      setResults(r.slice(0, 8))
    } catch {
      setResults([])
    }
  }

  const addStock = (r: SearchResult): void => {
    void window.api.monitor.addStock({ secid: r.secid, code: r.code, name: r.name }).then(() => {
      setKw('')
      setResults([])
    })
  }

  return (
    <div className={`monitor-app ${large ? 'mon-large' : ''}`}>
      <div className="monitor-head">
        <div className="monitor-title">
          实时监盘
          <span className="table-total">
            {config?.enabled ? `运行中 · ${config.interval}s 一次` : '已暂停'}
          </span>
          {large && (
            <button
              className="btn mon-exit-large"
              onClick={() => {
                setLarge(false)
                void window.api.monitor.setLarge(false)
              }}
            >
              ✕ 退出大屏
            </button>
          )}
        </div>
        <div className="monitor-controls">
          <button
            className={`btn ${pinned ? 'active' : ''}`}
            title="窗口置顶"
            onClick={() => {
              const v = !pinned
              setPinned(v)
              void window.api.monitor.setPinned(v)
            }}
          >
            📌
          </button>
          <button
            className={`btn ${large ? 'active' : ''}`}
            title="大屏/看板模式"
            onClick={() => {
              const v = !large
              setLarge(v)
              void window.api.monitor.setLarge(v)
            }}
          >
            ⛶ 大屏
          </button>
          <label className="mon-cfg" title="窗口半透明">
            半透明
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => {
                const v = Number(e.target.value)
                setOpacity(v)
                void window.api.monitor.setOpacity(v)
              }}
            />
            <span style={{ width: 30 }}>{Math.round(opacity * 100)}%</span>
          </label>
          <label className="mon-cfg">
            判定周期
            <input
              type="number"
              style={{ width: 46 }}
              value={config?.predictionHorizonMin ?? 30}
              onChange={(e) => setCfg({ predictionHorizonMin: Number(e.target.value) })}
              title="AI 预测多久后判定命中"
            />
            分
          </label>
          <label className="mon-cfg">
            总开关
            <input
              type="checkbox"
              checked={config?.enabled ?? false}
              onChange={(e) => setCfg({ enabled: e.target.checked })}
            />
          </label>
          <label className="mon-cfg">
            范围
            <select value={config?.scope ?? 'monitor'} onChange={(e) => setCfg({ scope: e.target.value as MonitorConfig['scope'] })}>
              <option value="monitor">监控列表</option>
              <option value="watchlist">自选</option>
              <option value="market">全市场</option>
            </select>
          </label>
          <label className="mon-cfg">
            间隔
            <select
              value={config?.interval ?? 60}
              onChange={(e) => setCfg({ interval: Number(e.target.value) })}
            >
              {INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {i < 60 ? `${i}秒` : `${i / 60}分钟`}
                </option>
              ))}
            </select>
          </label>
          <label className="mon-cfg">
            AI
            <input
              type="checkbox"
              checked={config?.aiEnabled ?? false}
              onChange={(e) => setCfg({ aiEnabled: e.target.checked })}
            />
          </label>
          <label className="mon-cfg">
            AI触发
            <select value={config?.aiTrigger ?? 'both'} onChange={(e) => setCfg({ aiTrigger: e.target.value as MonitorConfig['aiTrigger'] })}>
              <option value="both">定时+异动</option>
              <option value="scheduled">定时</option>
              <option value="anomaly">异动</option>
            </select>
          </label>
          <label className="mon-cfg">
            AI间隔
            <select value={config?.aiIntervalSec ?? 300} onChange={(e) => setCfg({ aiIntervalSec: Number(e.target.value) })}>
              {AI_INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {i < 60 ? `${i}秒` : `${i / 60}分钟`}
                </option>
              ))}
            </select>
          </label>
          <label className="mon-cfg">
            异动%
            <input
              type="number"
              step={0.5}
              style={{ width: 46 }}
              value={config?.anomalyPct ?? 1.5}
              onChange={(e) => setCfg({ anomalyPct: Number(e.target.value) })}
            />
          </label>
          <label className="mon-cfg">
            预警%
            <input
              type="number"
              step={0.5}
              style={{ width: 46 }}
              value={config?.alertPct ?? 1.5}
              onChange={(e) => setCfg({ alertPct: Number(e.target.value) })}
            />
          </label>
        </div>
        <TitleBarControls />
      </div>

      {stats && (
        <div className="monitor-stats">
          <span className="mon-stats-item">
            预测 <b>{stats.total}</b>
            <em>待定 {stats.pending}</em>
          </span>
          <span className="mon-stats-item">
            命中率 <b className="up">{pct(stats.accuracy)}</b>
            <em>
              中 {stats.hit} / 落 {stats.miss}
            </em>
          </span>
          <span className="mon-stats-item">
            方向准确率
            <b className="up">↑{pct(stats.byDirection.up.accuracy)}</b>
            <b className="down">↓{pct(stats.byDirection.down.accuracy)}</b>
            <b className="flat">→{pct(stats.byDirection.flat.accuracy)}</b>
          </span>
          <span className="mon-stats-item">
            平均置信
            <b className="up">命中 {pct(stats.avgConfidenceHit)}</b>
            <b className="down">落空 {pct(stats.avgConfidenceMiss)}</b>
          </span>
          {stats.pending > 0 && (
            <span className="mon-stats-hint">
              判定周期 {config?.predictionHorizonMin ?? 30} 分钟后按实际走势结算命中率
            </span>
          )}
          <button className="btn" onClick={toggleDetail}>
            {detail ? '收起明细' : '明细'}
          </button>
        </div>
      )}

      {detail && (
        <div className="monitor-detail">
          <div className="monitor-detail-col">
            <div className="panel-title">按股票命中率</div>
            {byStock.length === 0 ? (
              <div className="ai-audit-empty">暂无已判定样本（判定周期到后自动结算）</div>
            ) : (
              <table className="mon-detail-table">
                <thead>
                  <tr>
                    <th className="left">股票</th>
                    <th>次数</th>
                    <th>命中率</th>
                  </tr>
                </thead>
                <tbody>
                  {byStock.map((s) => (
                    <tr key={s.secid}>
                      <td className="left">
                        <span className="stock-name">{s.name}</span>
                        <span className="stock-code">{s.code}</span>
                      </td>
                      <td className="num">
                        {s.hit}/{s.total}
                      </td>
                      <td className={(s.accuracy || 0) >= 0.5 ? 'up' : 'down'}>{pct(s.accuracy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="monitor-detail-col">
            <div className="panel-title">按小时命中率</div>
            {byHour.length === 0 ? (
              <div className="ai-audit-empty">暂无数据</div>
            ) : (
              <table className="mon-detail-table">
                <thead>
                  <tr>
                    <th>小时</th>
                    <th>次数</th>
                    <th>命中率</th>
                  </tr>
                </thead>
                <tbody>
                  {byHour.map((h) => (
                    <tr key={h.hour}>
                      <td className="num">{h.hour}:00</td>
                      <td className="num">
                        {h.hit}/{h.total}
                      </td>
                      <td className={(h.accuracy || 0) >= 0.5 ? 'up' : 'down'}>{pct(h.accuracy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <div className="monitor-add">
        <div className="search-wrap" style={{ margin: 0 }}>
          <input
            className="search-input"
            placeholder="代码/名称搜索，加入监控列表…"
            value={kw}
            onChange={(e) => void handleSearch(e.target.value)}
          />
          {results.length > 0 && (
            <div className="search-dropdown">
              {results.map((r) => (
                <div key={r.secid} className="search-item" onClick={() => addStock(r)}>
                  <span className="search-item-name">{r.name}</span>
                  <span className="search-item-meta">{r.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="monitor-body">
        {/* initial 适配默认窗高（640）：表格 ~320 + 事件区可见；SplitPane 会在容器变小时自动钳制 */}
        <SplitPane direction="vertical" initial={320} min={200} max={1000} storageKey="split.monitor" reserveForSecond={140}>
        <table className="stock-table mon-table">
          <thead>
            <tr>
              <th className="left">名称</th>
              <th>现价</th>
              <th>涨跌</th>
              <th>日内高/低</th>
              <th className="left">AI 实时预测</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((q) => (
              <tr key={q.secid}>
                <td className="left">
                  <span className="name-cell">
                    <span className="stock-name">{q.name}</span>
                    <span className="stock-code">{q.code}</span>
                  </span>
                </td>
                <td className={q.changePercent >= 0 ? 'up' : 'down'}>{q.price.toFixed(2)}</td>
                <td className={q.changePercent >= 0 ? 'up' : 'down'}>
                  {q.changePercent >= 0 ? '+' : ''}
                  {q.changePercent?.toFixed(2)}%
                </td>
                <td className="num">
                  {q.high?.toFixed(2)} / {q.low?.toFixed(2)}
                </td>
                <td className="left">
                  {q.prediction ? (
                    <span className="mon-pred" title={q.prediction.reason}>
                      <DirectionTag direction={q.prediction.direction} />
                      <span className="mon-conf">
                        {(q.prediction.confidence * 100).toFixed(0)}%
                      </span>
                      {q.prediction.targetPrice && (
                        <span className="mon-target">目标 {q.prediction.targetPrice.toFixed(2)}</span>
                      )}
                      <span className="mon-reason">{q.prediction.reason}</span>
                    </span>
                  ) : (
                    <span className="mon-reason" style={{ color: 'var(--text-faint)' }}>
                      等待 AI 预测…
                    </span>
                  )}
                </td>
                <td>
                  <button className="row-action" title="移除监控" onClick={() => void window.api.monitor.removeStock(q.secid)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {stocks.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  {config?.enabled
                    ? '暂无数据（等待采集…或先在上方搜索添加监控股票）'
                    : '监盘未开启 —— 打开「总开关」开始实时入库'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="monitor-events">
          <div className="panel-title">提醒 / 预测记录</div>
          <div className="monitor-event-list">
            {events.map((ev) => (
              <div key={ev.id} className={`mon-event mon-event-${ev.type}`}>
                <span className="mon-event-time">
                  {new Date(ev.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
                <span className="mon-event-name">{ev.name}</span>
                <span className="mon-event-content">{ev.content}</span>
              </div>
            ))}
            {events.length === 0 && <div className="ai-audit-empty">暂无提醒/预测记录</div>}
          </div>
        </div>
        </SplitPane>
      </div>
    </div>
  )
}
