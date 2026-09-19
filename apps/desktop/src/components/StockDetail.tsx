import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Drawing,
  DrawingType,
  KlineResult,
  MinuteAnnotation,
  MinuteResult,
  OrderBook as OrderBookType
} from '../../shared/types'
import { FQT, KLT, INDEX_SECIDS } from '../../shared/types'
import { useApp } from '../store/app'
import { useDrawings, selectActiveDrawings } from '../store/drawings'
import QuoteHeader from './QuoteHeader'
import OrderBook from './OrderBook'
import MinuteChart from './MinuteChart'
import MinutePredictPanel from './MinutePredictPanel'
import MultiPeriodPredictPanel, { PREDICT_PERIODS, type PeriodAnalysis, type PredictPeriod } from './MultiPeriodPredictPanel'
import SplitPane from './SplitPane'
import KLineChart from './KLineChart'
import DrawingTools from './drawing/DrawingTools'
import DrawingAlgoPanel from './drawing/DrawingAlgoPanel'
import DrawingHistory from './drawing/DrawingHistory'
import DrawingManage from './drawing/DrawingManage'
import IndicatorToggles from './IndicatorToggles'
import { DEFAULT_INDICATORS, type IndicatorConfig } from '../lib/indicators'
import { CHART_SHORTCUT_EVENT, type ChartShortcutDetail } from '../lib/chart-shortcuts'
import StockNewsPanel from './news/StockNewsPanel'

type Tab = 'minute' | 'day' | 'week' | 'month' | 'quarter'
/** 分时子周期：'day' 当日分时线 / '5d' 五日分时 / 分钟K线 */
type MinutePeriod = 'day' | '5d' | '1' | '5' | '15' | '30' | '60' | '120'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'minute', label: '分时' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' },
  { key: 'quarter', label: '季K' }
]

const MINUTE_PERIODS: Array<{ key: MinutePeriod; label: string }> = [
  { key: 'day', label: '分时' },
  { key: '5d', label: '5日' },
  { key: '1', label: '1分' },
  { key: '5', label: '5分' },
  { key: '15', label: '15分' },
  { key: '30', label: '30分' },
  { key: '60', label: '60分' },
  { key: '120', label: '120分' }
]

const FQT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: FQT.NONE, label: '不复权' },
  { value: FQT.QIAN, label: '前复权' },
  { value: FQT.HOU, label: '后复权' }
]

function kltOf(tab: Tab): number {
  if (tab === 'day') return KLT.DAY
  if (tab === 'week') return KLT.WEEK
  if (tab === 'month') return KLT.MONTH
  if (tab === 'quarter') return KLT.QUARTER
  return KLT.DAY
}

export default function StockDetail({ secid, name }: { secid: string; name: string }) {
  const quote = useApp((s) => s.quotes.find((q) => q.secid === secid))
  const resolvedName = quote?.name || name || secid.split('.').pop() || secid
  const refreshInterval = useApp((s) => s.refreshInterval)
  const watchlist = useApp((s) => s.watchlist)
  const toggleWatchlist = useApp((s) => s.toggleWatchlist)
  const setView = useApp((s) => s.setView)
  const setBacktestTarget = useApp((s) => s.setBacktestTarget)
  const inWatchlist = watchlist.some((w) => w.secid === secid)

  const [tab, setTab] = useState<Tab>('minute')
  const [minutePeriod, setMinutePeriod] = useState<MinutePeriod>('day')
  const [fqt, setFqt] = useState<number>(FQT.QIAN)
  const [minute, setMinute] = useState<MinuteResult | null>(null)
  const [kline, setKline] = useState<KlineResult | null>(null)
  const [ob, setOb] = useState<OrderBookType | null>(null)
  // 分时/K线加载失败信息（非静默，给出重试入口 U6）
  const [chartError, setChartError] = useState<string | null>(null)
  // 重试计数：变化时重新拉取当前周期数据
  const [retryTick, setRetryTick] = useState(0)
  const [showAlgo, setShowAlgo] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [shortcutMessage, setShortcutMessage] = useState('')
  const shortcutMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 分时 AI 预测标注（会话内内存，关详情/换股即清）
  const [minuteAnn, setMinuteAnn] = useState<MinuteAnnotation[]>([])
  const [minuteOpinion, setMinuteOpinion] = useState('')
  const [mpLoading, setMpLoading] = useState(false)
  const [hoverNewsDate, setHoverNewsDate] = useState('')
  // 图表总高度（底部横条拖拽，↕）+ 与窗口等比例缩放（宽高比固定，窗口变宽图表随之变高）
  const [chartH, setChartH] = useState(480)
  const chartHRef = useRef(480)
  const chartWidthRef = useRef(0)
  const aspectRef = useRef<number | null>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const setChartH2 = (v: number): void => {
    chartHRef.current = v
    setChartH(v)
  }

  // 读取默认图表高度设置（设置页可配）
  useEffect(() => {
    void window.api.settings.get('chart.height').then((v) => {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 200 && n <= 900) {
        chartHRef.current = n
        setChartH(n)
      }
    })
  }, [])

  // 跟踪图表宽度：窗口/分栏宽度变化时，图表高度按宽高等比缩放
  useEffect(() => {
    const el = stackRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (!w || w <= 0) return
      chartWidthRef.current = w
      if (aspectRef.current === null) {
        // 首次测得宽度：以当前高度/宽度为基准比例
        aspectRef.current = chartHRef.current / w
      } else {
        const next = Math.max(200, Math.min(900, Math.round(w * aspectRef.current)))
        if (next !== chartHRef.current) setChartH2(next)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onChartHeightDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = chartH
    const move = (ev: MouseEvent): void => {
      const next = Math.max(200, Math.min(900, startH + (ev.clientY - startY)))
      setChartH2(next)
      // 拖拽改变宽高比基准（后续窗口缩放按新比例）
      if (chartWidthRef.current > 0) aspectRef.current = next / chartWidthRef.current
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-row')
    }
    document.body.classList.add('resizing-row')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // 指标副图配置（持久化到 settings，跨会话记忆）
  const [indicators, setIndicators] = useState<IndicatorConfig>(DEFAULT_INDICATORS)

  useEffect(() => {
    void window.api.settings.get('chart.indicators').then((v) => {
      if (v) {
        try {
          setIndicators({ ...DEFAULT_INDICATORS, ...JSON.parse(v) })
        } catch {
          // 配置损坏忽略，用默认
        }
      }
    })
  }, [])

  const handleIndicatorsChange = (c: IndicatorConfig): void => {
    setIndicators(c)
    void window.api.settings.set('chart.indicators', JSON.stringify(c))
  }

  // 画线状态
  const drawings = useDrawings((s) => s.drawings)
  const tool = useDrawings((s) => s.tool)
  const color = useDrawings((s) => s.color)
  const loadDrawings = useDrawings((s) => s.load)
  const addDrawing = useDrawings((s) => s.addDrawing)
  const saveDrawings = useDrawings((s) => s.save)
  const setTool = useDrawings((s) => s.setTool)
  // 图表只渲染未删除且未隐藏的画线
  const activeDrawings = selectActiveDrawings(drawings)

  // 分时线（当日/5日）用 MinuteChart；其余（分钟K线/日周月季）用 KLineChart
  const isMinuteLine = tab === 'minute' && (minutePeriod === 'day' || minutePeriod === '5d')
  const drawingScope = tab === 'minute'
    ? (isMinuteLine ? `minute:${minutePeriod}` : `kline:${minutePeriod}`)
    : `kline:${tab}`
  // 旧版未带 scope 的画线归入日 K；新画线严格按周期隔离，避免不同坐标体系串线。
  const chartDrawings = activeDrawings.filter((d) => (d.scope ?? 'kline:day') === drawingScope)
  const drawingData: KlineResult | null = isMinuteLine && minute
    ? {
        secid: minute.secid,
        name: minute.name,
        points: minute.points.map((point) => ({
          time: point.time,
          open: point.price,
          close: point.price,
          high: point.high,
          low: point.low,
          volume: point.volume,
          amount: point.amount
        }))
      }
    : kline

  // 周期、画线工具和撤销快捷键由详情页统一处理；图表平移/缩放由 KLineChart 处理。
  useEffect(() => {
    const showMessage = (message: string): void => {
      setShortcutMessage(message)
      if (shortcutMessageTimer.current) clearTimeout(shortcutMessageTimer.current)
      shortcutMessageTimer.current = setTimeout(() => setShortcutMessage(''), 900)
    }
    const selectPeriod = (nextTab: Tab, nextMinute: MinutePeriod = 'day'): void => {
      setTab(nextTab)
      if (nextTab === 'minute') setMinutePeriod(nextMinute)
    }
    const onShortcut = (event: Event): void => {
      const { command } = (event as CustomEvent<ChartShortcutDetail>).detail
      if (command === 'cancel') {
        setTool(null)
        setShowAlgo(false)
        setShowHistory(false)
        setShowManage(false)
        showMessage('已取消当前操作')
        return
      }
      if (command.startsWith('drawing-')) {
        const nextTool = command.slice('drawing-'.length) as DrawingType
        setTool(nextTool)
        showMessage(`画线工具：${nextTool}`)
        return
      }
      if (command === 'undo-drawing') {
        const state = useDrawings.getState()
        const active = state.drawings.filter((drawing) =>
          !drawing.deleted && (drawing.scope ?? 'kline:day') === drawingScope
        )
        const last = active[active.length - 1]
        if (last) {
          state.removeDrawing(last.id)
          void state.save()
          showMessage('已撤销最后一条画线')
        } else {
          showMessage('当前周期没有可撤销画线')
        }
        return
      }
      if (command === 'period-minute') selectPeriod('minute')
      else if (command === 'period-day') selectPeriod('day')
      else if (command === 'period-week') selectPeriod('week')
      else if (command === 'period-month') selectPeriod('month')
      else if (command === 'period-quarter') selectPeriod('quarter')
      else if (command === 'previous-period' || command === 'next-period') {
        const periods: Array<{ tab: Tab; minute?: MinutePeriod }> = [
          ...MINUTE_PERIODS.map((period) => ({ tab: 'minute' as const, minute: period.key })),
          { tab: 'day' }, { tab: 'week' }, { tab: 'month' }, { tab: 'quarter' }
        ]
        const current = periods.findIndex((period) =>
          period.tab === tab && (tab !== 'minute' || period.minute === minutePeriod)
        )
        const delta = command === 'previous-period' ? -1 : 1
        const next = periods[(Math.max(0, current) + delta + periods.length) % periods.length]
        selectPeriod(next.tab, next.minute)
      } else return
      showMessage('已切换图表周期')
    }
    window.addEventListener(CHART_SHORTCUT_EVENT, onShortcut)
    return () => {
      window.removeEventListener(CHART_SHORTCUT_EVENT, onShortcut)
      if (shortcutMessageTimer.current) clearTimeout(shortcutMessageTimer.current)
    }
  }, [drawingScope, minutePeriod, setTool, tab])

  useEffect(() => {
    if (secid) void loadDrawings(secid)
    setShowAlgo(false)
    setShowHistory(false)
    setShowManage(false)
  }, [secid, loadDrawings])

  useEffect(() => {
    setShowAlgo(false)
    setShowHistory(false)
    setShowManage(false)
    setTool(null)
  }, [drawingScope, setTool])

  // 分时 AI 预测标注：会话内读取 + 订阅 AI 工具推送
  useEffect(() => {
    void window.api.minute.get(secid).then((r) => {
      setMinuteAnn(r?.annotations ?? [])
      setMinuteOpinion(r?.opinion ?? '')
    })
    const off = window.api.minute.onAnnotations((p) => {
      if (p.secid === secid) {
        setMinuteAnn(p.annotations)
        setMinuteOpinion(p.opinion)
      }
    })
    return () => {
      off()
      setMinuteAnn([])
      setMinuteOpinion('')
    }
  }, [secid])

  const handleMinuteAnalyze = async (intent: string): Promise<void> => {
    if (!minute || mpLoading) return
    setMpLoading(true)
    try {
      const r = await window.api.minute.analyze(secid, intent, minute)
      setMinuteAnn(r.annotations)
      setMinuteOpinion(r.opinion)
    } catch (err) {
      console.error('[minute-ai] 分析失败:', err)
    }
    setMpLoading(false)
  }

  const handleMinuteRemove = (id: string): void => {
    setMinuteAnn((prev) => prev.filter((a) => a.id !== id))
  }

  const handleMinuteClear = (): void => {
    setMinuteAnn([])
    setMinuteOpinion('')
    void window.api.minute.clear(secid)
  }

  const currentPredictPeriod: PredictPeriod = tab === 'minute'
    ? minutePeriod
    : tab === 'day' ? 'daily' : tab

  const minuteAsKline = (value: MinuteResult): KlineResult => ({
    secid: value.secid,
    name: value.name,
    points: value.points.map((point) => ({
      time: point.time, open: point.price, close: point.price,
      high: point.high || point.price, low: point.low || point.price,
      volume: point.volume, amount: point.amount
    }))
  })

  const loadPredictPeriod = async (period: PredictPeriod): Promise<KlineResult> => {
    if (period === 'day' || period === '5d') {
      const value = await window.api.market.getMinute(secid, period === '5d' ? 5 : 1)
      if (!value?.points?.length) throw new Error('暂无分时数据')
      return minuteAsKline(value)
    }
    const klt = period === 'daily' ? KLT.DAY
      : period === 'week' ? KLT.WEEK
        : period === 'month' ? KLT.MONTH
          : period === 'quarter' ? KLT.QUARTER : Number(period)
    const value = await window.api.market.getKline(secid, klt, fqt)
    if (!value?.points?.length) throw new Error('暂无K线数据')
    return value
  }

  const handleMultiAnalyze = async (periods: PredictPeriod[], code: string): Promise<PeriodAnalysis[]> => {
    if (mpLoading) return []
    setMpLoading(true)
    const state = useDrawings.getState()
    for (const drawing of state.drawings) {
      if (drawing.label?.startsWith('AI预测·') && periods.some((period) => {
        const scope = period === 'day' || period === '5d' ? `minute:${period}` : `kline:${period === 'daily' ? 'day' : period}`
        return (drawing.scope ?? 'kline:day') === scope
      })) state.removeDrawing(drawing.id)
    }
    await state.save()
    const loaded = await Promise.all(periods.map(async (period) => {
      try {
        return { period, data: await loadPredictPeriod(period) }
      } catch (error) {
        return { period, error: error instanceof Error ? error.message : String(error) }
      }
    }))
    const results: PeriodAnalysis[] = []
    for (const item of loaded) {
      const { period } = item
      const label = PREDICT_PERIODS.find((item) => item.key === period)?.label ?? period
      const scope = period === 'day' || period === '5d' ? `minute:${period}` : `kline:${period === 'daily' ? 'day' : period}`
      try {
        if ('error' in item) throw new Error(item.error)
        const data = item.data
        if (!data.points.length) throw new Error('暂无数据')
        const first = data.points[Math.max(0, data.points.length - Math.min(20, data.points.length))].close
        const last = data.points[data.points.length - 1].close
        const change = first ? (last / first - 1) * 100 : 0
        const run = await useDrawings.getState().runAlgo(code, data, scope)
        results.push({ key: period, label, direction: change > 0.2 ? 'up' : change < -0.2 ? 'down' : 'flat', change, lines: run.count ?? 0, error: run.ok ? undefined : run.error })
      } catch (error) {
        results.push({ key: period, label, direction: 'flat', change: 0, lines: 0, error: error instanceof Error ? error.message : String(error) })
      }
    }
    setMpLoading(false)
    return results
  }

  // useCallback 稳定引用：避免拖拽画线过程中因 StockDetail 重渲染导致 KLineChart 的
  // zr 事件 effect 重跑（cleanup 会 setPending(null) 清掉拖拽起点）
  const handleDrawingComplete = useCallback((d: Drawing): void => {
    addDrawing(d)
    void saveDrawings()
    // 画完一条线自动退出画线模式，恢复图表缩放/拖拽
    setTool(null)
  }, [addDrawing, saveDrawings, setTool])

  // 盘口轮询：链式 setTimeout，避免请求重叠。
  // 指数无五档（INDEX_SECIDS），不渲染不轮询；间隔跟随全局刷新频率；窗口隐藏时暂停。
  const isIndex = (INDEX_SECIDS as readonly string[]).includes(secid)
  useEffect(() => {
    if (isIndex) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      if (document.hidden) {
        // 页面隐藏时跳过本轮，稍后重查
        if (!cancelled) timer = setTimeout(() => void tick(), refreshInterval)
        return
      }
      try {
        const r = await window.api.market.getOrderBook(secid)
        if (!cancelled && r) setOb(r)
      } catch {
        // 单次失败忽略，下轮重试
      }
      if (!cancelled) timer = setTimeout(() => void tick(), refreshInterval)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [secid, isIndex, refreshInterval])

  // 分时 / K线数据
  useEffect(() => {
    let cancelled = false
    setChartError(null)
    const fail = (): void => {
      if (!cancelled) setChartError('数据加载失败，请检查网络或稍后重试')
    }
    if (isMinuteLine) {
      window.api.market
        .getMinute(secid, minutePeriod === '5d' ? 5 : 1)
        .then((r) => {
          if (!cancelled) {
            setMinute(r)
            if (!r?.points?.length) setChartError('暂无分时数据')
            else setChartError(null)
          }
        })
        .catch(fail)
    } else {
      // 分钟K线（tab=minute 且 period 为分钟）或 日/周/月/季K
      const klt = tab === 'minute' ? Number(minutePeriod) : kltOf(tab)
      window.api.market
        .getKline(secid, klt, fqt)
        .then((r) => {
          if (!cancelled) {
            setKline(r)
            if (!r?.points?.length) setChartError('暂无K线数据')
            else setChartError(null)
          }
        })
        .catch(fail)
    }
    return () => {
      cancelled = true
    }
  }, [secid, tab, minutePeriod, fqt, isMinuteLine, retryTick])

  return (
    <div className="detail">
      <QuoteHeader
        quote={quote ?? null}
        inWatchlist={inWatchlist}
        onToggleWatchlist={() =>
          void toggleWatchlist({
            secid,
            code: quote?.code ?? secid.split('.')[1],
            name: resolvedName
          })
        }
        onBacktest={() => {
          setBacktestTarget({ secid, name: resolvedName })
          setView({ type: 'backtest' })
        }}
      />

      <div className="detail-bottom">
        <SplitPane direction="vertical" initial={260} min={200} max={440} storageKey="split.detail">
          {isIndex ? (
            // 指数无五档盘口：占位说明，不渲染空表
            <div className="orderbook">
              <div className="ob-title">五档盘口</div>
              <div className="empty" style={{ padding: 20 }}>
                指数无五档盘口
              </div>
            </div>
          ) : (
            <OrderBook ob={ob} />
          )}
          <div className="chart-card">
          <div className="chart-head">
            <div className="chart-tabs">
              {TABS.map((t) => (
                <div
                  key={t.key}
                  className={`tab ${tab === t.key ? 'active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </div>
              ))}
            </div>
            {tab === 'minute' && (
              <div className="chart-tabs">
                {MINUTE_PERIODS.map((p) => (
                  <div
                    key={p.key}
                    className={`tab ${minutePeriod === p.key ? 'active' : ''}`}
                    onClick={() => setMinutePeriod(p.key)}
                  >
                    {p.label}
                  </div>
                ))}
              </div>
            )}
            {tab !== 'minute' && (
              <div className="chart-tabs">
                {FQT_OPTIONS.map((o) => (
                  <div
                    key={o.value}
                    className={`tab ${fqt === o.value ? 'active' : ''}`}
                    onClick={() => setFqt(o.value)}
                  >
                    {o.label}
                  </div>
                ))}
              </div>
            )}
            {!isMinuteLine && (
              <IndicatorToggles config={indicators} onChange={handleIndicatorsChange} />
            )}
            {(kline?.stale || minute?.stale) && (
              <span className="stale-badge" title="当前为缓存/本地回退数据，可能延迟">
                数据延迟
              </span>
            )}
          </div>
          <DrawingTools
            scope={drawingScope}
            onOpenAlgo={() => setShowAlgo(true)}
            onOpenHistory={() => setShowHistory(true)}
            onOpenManage={() => setShowManage(true)}
          />
          <div ref={stackRef} className="chart-stack" style={{ height: chartH }}>
            {shortcutMessage && <div className="chart-shortcut-toast detail-shortcut-toast">{shortcutMessage}</div>}
            {chartError && (
              <div className="chart-error-overlay">
                <span className="chart-error-msg">{chartError}</span>
                <button
                  className="btn"
                  onClick={() => setRetryTick((t) => t + 1)}
                  title="重新加载当前周期数据"
                >
                  重试
                </button>
              </div>
            )}
            <div className="chart-pane">
              <div className="minute-layout">
                <SplitPane direction="vertical" initial={520} min={320} max={900} storageKey="split.multiPredict">
                  <div className="minute-chart-col">
                  {isMinuteLine ? (
                <MinuteChart
                  data={minute}
                  annotations={minutePeriod === 'day' ? minuteAnn : []}
                  drawings={chartDrawings}
                  tool={tool}
                  color={color}
                  scope={drawingScope}
                  onDrawingComplete={handleDrawingComplete}
                />
                  ) : (
              <KLineChart
                data={kline}
                scope={drawingScope}
                secid={secid}
                drawings={chartDrawings}
                tool={tool}
                color={color}
                indicators={indicators}
                onDrawingComplete={handleDrawingComplete}
                onHoverDate={setHoverNewsDate}
              />
                  )}
                  </div>
                  <MultiPeriodPredictPanel current={currentPredictPeriod} currentData={drawingData} loading={mpLoading} onAnalyze={handleMultiAnalyze} />
                </SplitPane>
              </div>
            </div>
          </div>
          <div className="chart-v-resize" onMouseDown={onChartHeightDrag} title="拖拽调整图表高度（↕）" />
          <StockNewsPanel secid={secid} name={resolvedName} hoverDate={hoverNewsDate} />
          {showAlgo && (
            <DrawingAlgoPanel
              kline={drawingData}
              scope={drawingScope}
              onClose={() => setShowAlgo(false)}
            />
          )}
          {showHistory && <DrawingHistory onClose={() => setShowHistory(false)} />}
          {showManage && <DrawingManage onClose={() => setShowManage(false)} />}
          </div>
        </SplitPane>
      </div>
    </div>
  )
}
