import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from 'lucide-react'
import type { NewsAnalysis, StockNewsItem } from '../../../shared/types'

function isoDate(date: Date): string { return date.toISOString().slice(0, 10) }
function shift(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 10)}T12:00:00`)
  value.setDate(value.getDate() + days)
  return isoDate(value)
}
function inRange(item: StockNewsItem, start: string, end: string): boolean {
  const date = item.publishedAt.slice(0, 10)
  return date >= start && date <= end
}

export default function StockNewsPanel({ secid, name, hoverDate }: { secid: string; name: string; hoverDate?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rangeRequestRef = useRef(0)
  const today = isoDate(new Date())
  const [items, setItems] = useState<StockNewsItem[]>([])
  const [rangeResult, setRangeResult] = useState<{ key: string; items: StockNewsItem[] } | null>(null)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [rangeDays, setRangeDays] = useState(30)
  const [start, setStart] = useState(shift(today, -30))
  const [end, setEnd] = useState(today)
  const [aroundDays, setAroundDays] = useState(10)
  const [followKline, setFollowKline] = useState(true)
  const [analysis, setAnalysis] = useState<NewsAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')

  const load = async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      const result = await window.api.news.list(secid, name, 100)
      setItems(result.items)
    } catch (err) { setError(`新闻加载失败：${err instanceof Error ? err.message : String(err)}`) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [secid, name])
  useEffect(() => {
    const focus = (): void => { setCollapsed(false); rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    window.addEventListener('localstock:focus-news', focus)
    return () => window.removeEventListener('localstock:focus-news', focus)
  }, [])

  const effectiveRange = useMemo(() => {
    if (followKline && hoverDate) return { start: shift(hoverDate, -aroundDays), end: shift(hoverDate, aroundDays), label: `${hoverDate.slice(0, 10)} 前后 ${aroundDays} 天` }
    return { start, end, label: `${start} 至 ${end}` }
  }, [followKline, hoverDate, aroundDays, start, end])
  const rangeKey = `${effectiveRange.start}|${effectiveRange.end}`
  useEffect(() => {
    const requestId = ++rangeRequestRef.current
    const timer = setTimeout(() => {
      setRangeLoading(true)
      void window.api.news.range(secid, name, effectiveRange.start, effectiveRange.end).then((result) => {
        if (requestId === rangeRequestRef.current) setRangeResult({ key: rangeKey, items: result.items })
      }).catch(() => {}).finally(() => { if (requestId === rangeRequestRef.current) setRangeLoading(false) })
    }, 500)
    return () => clearTimeout(timer)
  }, [secid, name, effectiveRange.start, effectiveRange.end, rangeKey])
  const visible = useMemo(() => {
    const source = rangeResult?.key === rangeKey ? rangeResult.items : items
    return source.filter((item) => inRange(item, effectiveRange.start, effectiveRange.end))
  }, [items, rangeResult, rangeKey, effectiveRange])

  const selectDays = (days: number): void => {
    setRangeDays(days); setFollowKline(false); setEnd(today); setStart(shift(today, -days)); setAnalysis(null)
  }
  const analyze = async (): Promise<void> => {
    setAnalyzing(true); setAnalysisError(''); setAnalysis(null)
    const result = await window.api.news.analyze(secid, name, effectiveRange.start, effectiveRange.end, visible)
    if (result.ok && result.analysis) setAnalysis(result.analysis)
    else setAnalysisError(result.error || 'AI新闻梳理失败')
    setAnalyzing(false)
  }

  return (
    <div ref={rootRef} className={`stock-news-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="stock-news-head">
        <div><strong>新闻聚合</strong><span>{name} · 最新 {items.length} 条</span></div>
        <div className="stock-news-head-actions">
          <button className="btn" disabled={loading} onClick={() => void load()}><RefreshCw size={12} /> 刷新</button>
          <button className="icon-btn" aria-label={collapsed ? '展开新闻窗口' : '收起新闻窗口'} title={collapsed ? '展开新闻窗口' : '收起新闻窗口'} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
        </div>
      </div>
      {!collapsed && <>
        <div className="stock-news-controls">
          <div className="news-range-buttons">
            {[7, 30, 90, 365].map((days) => <button key={days} className={`btn ${!followKline && rangeDays === days ? 'active' : ''}`} onClick={() => selectDays(days)}>{days === 365 ? '1年' : `${days}天`}</button>)}
          </div>
          <label>开始<input data-memory-key={`news-start-${secid}`} type="date" value={start} onChange={(event) => { setStart(event.target.value); setFollowKline(false); setRangeDays(0) }} /></label>
          <label>结束<input data-memory-key={`news-end-${secid}`} type="date" value={end} onChange={(event) => { setEnd(event.target.value); setFollowKline(false); setRangeDays(0) }} /></label>
          <label className="news-follow"><input type="checkbox" checked={followKline} onChange={(event) => setFollowKline(event.target.checked)} />跟随K线日期</label>
          <label>前后<input data-memory-key="news-around-days" className="news-days-input" type="number" min={0} max={180} value={aroundDays} onChange={(event) => setAroundDays(Math.max(0, Math.min(180, Number(event.target.value) || 0)))} />天</label>
          <button className="btn primary" disabled={analyzing || !visible.length} onClick={() => void analyze()}><Bot size={13} />{analyzing ? 'AI梳理中…' : 'AI时间线梳理'}</button>
        </div>
        <div className="news-range-status">当前范围：{effectiveRange.label} · {rangeLoading ? '正在检索历史新闻…' : `匹配 ${visible.length} 条`}{followKline && !hoverDate ? '（将鼠标移到K线上选择日期）' : ''}</div>
        {error && <div className="backtest-error">⚠ {error}</div>}
        {analysisError && <div className="backtest-error">⚠ {analysisError}</div>}
        {analysis && <div className="news-ai-analysis">
          <div className="news-ai-title"><Bot size={14} /> AI 综合梳理</div>
          <p>{analysis.summary}</p>
          {!!analysis.timeline.length && <div className="news-timeline">{analysis.timeline.map((entry, index) => <div key={`${entry.date}-${index}`}><time>{entry.date}</time><strong>{entry.event}</strong><span>{entry.impact}</span></div>)}</div>}
          {!!analysis.risks.length && <div className="news-risks">风险与不确定性：{analysis.risks.join('；')}</div>}
        </div>}
        <div className="stock-news-list">
          {loading && <div className="empty">正在聚合新闻…</div>}
          {!loading && !visible.length && <div className="empty">所选时间范围内暂无匹配新闻</div>}
          {visible.map((item) => <article key={item.id || item.url} className="stock-news-item">
            <div className="stock-news-meta"><time>{item.publishedAt}</time><span>{item.source}</span></div>
            <a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={11} /></a>
            <p>{item.content.slice(0, 100)}{item.content.length > 100 ? '…' : ''}</p>
          </article>)}
        </div>
      </>}
    </div>
  )
}
