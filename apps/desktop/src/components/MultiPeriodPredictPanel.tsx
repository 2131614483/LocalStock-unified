import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Minus, Move, RotateCcw } from 'lucide-react'
import { History, Sparkles } from 'lucide-react'
import type { KlineResult } from '../../shared/types'

export type PredictPeriod = 'day' | '5d' | '1' | '5' | '15' | '30' | '60' | '120' | 'daily' | 'week' | 'month' | 'quarter'

export const PREDICT_PERIODS: Array<{ key: PredictPeriod; label: string }> = [
  { key: 'day', label: '分时' }, { key: '5d', label: '5日' },
  { key: '1', label: '1分' }, { key: '5', label: '5分' }, { key: '15', label: '15分' },
  { key: '30', label: '30分' }, { key: '60', label: '60分' }, { key: '120', label: '120分' },
  { key: 'daily', label: '日K' }, { key: 'week', label: '周K' },
  { key: 'month', label: '月K' }, { key: 'quarter', label: '季K' }
]

export const DEFAULT_MULTI_PREDICT_CODE = `# LocalStock 多周期预测画线（Python）
# 同一代码会分别在每个勾选周期运行
# data = {dates, opens, highs, lows, closes, volumes, n}
# 可用 draw_line / draw_hline / draw_ray / draw_rect / draw_fib / draw_channel

win = min(60, n)
lookback = min(20, n - 1)
high = max(data['highs'][-win:])
low = min(data['lows'][-win:])
last = data['closes'][-1]
base = data['closes'][-1-lookback] if lookback > 0 else last
slope = (last - base) / max(1, lookback)
horizon = max(3, min(20, n // 8))
target = last + slope * horizon

draw_hline(high, color='#f5222d', label='AI预测·压力')
draw_hline(low, color='#14b143', label='AI预测·支撑')
draw_line(n-1, last, n-1+horizon, target,
          color='#14b143' if target >= last else '#f5222d',
          label='AI预测·趋势目标')
`

export interface PeriodAnalysis {
  key: PredictPeriod
  label: string
  direction: 'up' | 'down' | 'flat'
  change: number
  lines: number
  error?: string
}

interface Props {
  current: PredictPeriod
  currentData: KlineResult | null
  loading: boolean
  onAnalyze(periods: PredictPeriod[], code: string): Promise<PeriodAnalysis[]>
}

interface CodeVersion { code: string; ts: number }
type PanelMode = 'normal' | 'minimized' | 'expanded' | 'floating'

export default function MultiPeriodPredictPanel({ current, currentData, loading, onAnalyze }: Props) {
  const [selected, setSelected] = useState<PredictPeriod[]>(['day', '5', '30', 'daily', 'week'])
  const [code, setCode] = useState(DEFAULT_MULTI_PREDICT_CODE)
  const [showCode, setShowCode] = useState(false)
  const [editorHeight, setEditorHeight] = useState(280)
  const [results, setResults] = useState<PeriodAnalysis[]>([])
  const [aiIntent, setAiIntent] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [showCodeHistory, setShowCodeHistory] = useState(false)
  const [codeHistory, setCodeHistory] = useState<CodeVersion[]>([])
  const [panelMode, setPanelMode] = useState<PanelMode>(() => {
    const saved = localStorage.getItem('chart.ai.multiPredictPanelMode')
    return saved === 'minimized' || saved === 'expanded' || saved === 'floating' ? saved : 'normal'
  })
  const [floatPos, setFloatPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('chart.ai.multiPredictFloatPos') || '{}') as { x?: number; y?: number }
      return { x: Number.isFinite(saved.x) ? saved.x as number : Math.max(24, window.innerWidth - 720), y: Number.isFinite(saved.y) ? saved.y as number : 100 }
    } catch { return { x: Math.max(24, window.innerWidth - 720), y: 100 } }
  })
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number; width: number; height: number } | null>(null)

  const changePanelMode = (mode: PanelMode): void => {
    setPanelMode(mode)
    localStorage.setItem('chart.ai.multiPredictPanelMode', mode)
  }

  const startFloatDrag = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (panelMode !== 'floating' || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    const panel = event.currentTarget.parentElement
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    dragRef.current = { startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    document.body.classList.add('dragging-floating-panel')
    const move = (moveEvent: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      // 始终保留完整标题栏宽度，避免右侧“停靠/展开”按钮被拖出屏幕后无法恢复。
      const x = Math.max(0, Math.min(Math.max(0, window.innerWidth - Math.min(drag.width, window.innerWidth)), drag.x + moveEvent.clientX - drag.startX))
      const y = Math.max(48, Math.min(window.innerHeight - 48, drag.y + moveEvent.clientY - drag.startY))
      setFloatPos({ x, y })
    }
    const stop = (): void => {
      dragRef.current = null
      document.body.classList.remove('dragging-floating-panel')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      setFloatPos((position) => {
        localStorage.setItem('chart.ai.multiPredictFloatPos', JSON.stringify(position))
        return position
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && (panelMode === 'expanded' || panelMode === 'floating')) changePanelMode('normal')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelMode])

  useEffect(() => {
    void window.api.settings.get('chart.ai.multiPeriods').then((value) => {
      if (!value) return
      try {
        const parsed = JSON.parse(value) as PredictPeriod[]
        const valid = parsed.filter((key) => PREDICT_PERIODS.some((item) => item.key === key))
        if (valid.length) setSelected(valid)
      } catch { /* 使用默认 */ }
    })
    void window.api.settings.get('chart.ai.analysisCode').then((value) => {
      if (value?.trim()) setCode(value)
    })
    try { setCodeHistory(JSON.parse(localStorage.getItem('chart.ai.analysisCodeHistory') || '[]')) } catch { /* 空历史 */ }
  }, [])

  const rememberCode = (value: string): void => {
    if (!value.trim()) return
    setCodeHistory((old) => {
      const next = [{ code: value, ts: Date.now() }, ...old.filter((item) => item.code !== value)].slice(0, 20)
      localStorage.setItem('chart.ai.analysisCodeHistory', JSON.stringify(next))
      return next
    })
  }

  const toggle = (key: PredictPeriod): void => {
    setSelected((old) => {
      const next = old.includes(key) ? old.filter((item) => item !== key) : [...old, key]
      void window.api.settings.set('chart.ai.multiPeriods', JSON.stringify(next))
      return next
    })
  }
  const run = async (): Promise<void> => {
    if (!selected.length || loading) return
    rememberCode(code)
    setResults(await onAnalyze(selected, code))
  }
  const generateWithAi = async (): Promise<void> => {
    if (!currentData?.points?.length || !aiIntent.trim() || aiBusy) {
      if (!currentData?.points?.length) setAiError('当前周期暂无数据，不能生成代码')
      return
    }
    setAiBusy(true)
    setAiError('')
    rememberCode(code)
    try {
      const request = `这是多周期预测工具代码。${aiIntent.trim()}。生成的每条画线 label 必须以“AI预测·”开头，并保持同一代码可在分时到季K运行。`
      const result = await window.api.drawings.aiCode(request, code, currentData)
      if (!result.ok || !result.code) throw new Error(result.error || 'AI没有返回代码')
      setCode(result.code)
      rememberCode(result.code)
      void window.api.settings.set('chart.ai.analysisCode', result.code)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error))
    } finally {
      setAiBusy(false)
    }
  }
  const up = results.filter((r) => r.direction === 'up' && !r.error).length
  const down = results.filter((r) => r.direction === 'down' && !r.error).length
  const consensus = !results.length ? '' : up > down ? `多周期偏多（${up}/${results.length}）` : down > up ? `多周期偏空（${down}/${results.length}）` : '多周期分歧，建议等待确认'

  return (
    <div className={`minute-predict multi-predict multi-predict-${panelMode}`} style={panelMode === 'floating' ? { left: floatPos.x, top: floatPos.y } : undefined}>
      <div className="minute-predict-head" onMouseDown={startFloatDrag}>
        <span className="panel-title">AI 多周期预测</span>
        <div className="multi-predict-window-actions">
          <span className="mp-market mp-market-idle">当前：{PREDICT_PERIODS.find((p) => p.key === current)?.label}</span>
          <button
            className="icon-btn"
            title={panelMode === 'floating' ? '停靠AI多周期预测窗口' : '浮动AI多周期预测窗口'}
            aria-label={panelMode === 'floating' ? '停靠AI多周期预测窗口' : '浮动AI多周期预测窗口'}
            onClick={() => changePanelMode(panelMode === 'floating' ? 'normal' : 'floating')}
          ><Move size={13} /></button>
          {panelMode === 'minimized' ? (
            <button className="icon-btn" title="恢复AI多周期预测窗口" aria-label="恢复AI多周期预测窗口" onClick={() => changePanelMode('normal')}><Minimize2 size={13} /></button>
          ) : (
            <button className="icon-btn" title="最小化AI多周期预测窗口" aria-label="最小化AI多周期预测窗口" onClick={() => changePanelMode('minimized')}><Minus size={14} /></button>
          )}
          <button
            className="icon-btn"
            title={panelMode === 'expanded' ? '还原AI多周期预测窗口' : '展开AI多周期预测窗口'}
            aria-label={panelMode === 'expanded' ? '还原AI多周期预测窗口' : '展开AI多周期预测窗口'}
            onClick={() => changePanelMode(panelMode === 'expanded' ? 'normal' : 'expanded')}
          >{panelMode === 'expanded' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        </div>
      </div>
      {panelMode !== 'minimized' && <>
      <div className="mp-hint">勾选纳入统一分析的周期；结果会分别画到对应图表。</div>
      <div className="multi-period-checks">
        {PREDICT_PERIODS.map((period) => (
          <label key={period.key} className={`multi-period-check ${period.key === current ? 'current' : ''}`}>
            <input type="checkbox" checked={selected.includes(period.key)} onChange={() => toggle(period.key)} />
            {period.label}
          </label>
        ))}
      </div>
      <div className="mp-quick">
        <button className="btn primary" disabled={loading || !selected.length} onClick={() => void run()}>
          {loading ? `统一分析中…` : `统一分析 ${selected.length} 个周期`}
        </button>
        <button className="btn" onClick={() => setShowCode((value) => !value)}>
          {showCode ? <ChevronUp size={12} /> : <ChevronDown size={12} />} 分析工具代码
        </button>
      </div>
      {showCode && (
        <div className="multi-code-box">
          <div className="multi-code-actions">
            <span>可查看、修改并自动保存</span>
            <button className="btn" onClick={() => setShowCodeHistory((value) => !value)}><History size={11} /> 历史 {codeHistory.length}</button>
            <button className="btn" onClick={() => {
              rememberCode(code)
              setCode(DEFAULT_MULTI_PREDICT_CODE)
              void window.api.settings.set('chart.ai.analysisCode', DEFAULT_MULTI_PREDICT_CODE)
            }}><RotateCcw size={11} /> 恢复默认</button>
          </div>
          {showCodeHistory && (
            <div className="multi-code-history">
              {!codeHistory.length && <span>暂无代码历史</span>}
              {codeHistory.map((item) => (
                <button key={item.ts} onClick={() => { rememberCode(code); setCode(item.code); void window.api.settings.set('chart.ai.analysisCode', item.code); setShowCodeHistory(false) }}>
                  <span>{item.code.split('\n').find((line) => line.trim()) || '代码版本'}</span>
                  <time>{new Date(item.ts).toLocaleString()}</time>
                </button>
              ))}
            </div>
          )}
          <div className="multi-code-ai">
            <Sparkles size={13} />
            <input data-memory-key="multi-predict-ai-intent" placeholder="告诉 AI 如何生成或调优分析代码…" value={aiIntent} onChange={(event) => setAiIntent(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void generateWithAi() }} />
            <button className="btn primary" disabled={aiBusy || !aiIntent.trim() || !currentData?.points?.length} onClick={() => void generateWithAi()}>{aiBusy ? 'AI生成中…' : 'AI生成/调优'}</button>
          </div>
          {aiError && <div className="backtest-error">⚠ {aiError}</div>}
          <textarea
            data-memory-key="multi-predict-analysis-code"
            className="code-editor multi-predict-editor"
            style={{ height: editorHeight }}
            value={code}
            spellCheck={false}
            onChange={(event) => {
              setCode(event.target.value)
              void window.api.settings.set('chart.ai.analysisCode', event.target.value)
            }}
            onBlur={() => rememberCode(code)}
            onMouseUp={(event) => setEditorHeight(Math.max(180, Math.min(620, event.currentTarget.offsetHeight)))}
          />
        </div>
      )}
      <div className="mp-opinion">
        {loading ? <span className="mp-loading">正在加载多个周期并执行预测代码…</span> : consensus || '尚未分析。预测线仅供研究参考。'}
      </div>
      <div className="mp-annotations">
        <div className="mp-annotations-title">周期结果（{results.length}）</div>
        {!results.length && <div className="mp-empty">分析后可切换周期查看压力、支撑和趋势目标线。</div>}
        {results.map((result) => (
          <div className="mp-annot" key={result.key}>
            <span className="mp-annot-type">{result.label}</span>
            <span className="mp-annot-price" style={{ color: result.error ? '#f5c542' : result.direction === 'up' ? '#14b143' : result.direction === 'down' ? '#f5222d' : '#8b929c' }}>
              {result.error ? '失败' : result.direction === 'up' ? '偏多' : result.direction === 'down' ? '偏空' : '震荡'}
            </span>
            <span className="mp-annot-label">{result.error || `${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% · ${result.lines} 条线`}</span>
          </div>
        ))}
      </div>
      </>}
    </div>
  )
}
