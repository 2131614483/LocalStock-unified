import { useState } from 'react'
import { Sparkles, Wand2, RotateCcw } from 'lucide-react'
import type { KlineResult } from '../../../shared/types'
import { useDrawings } from '../../store/drawings'

const DEFAULT_ALGO = `# K线画线算法（Python）
# 环境：data = { dates, opens, highs, lows, closes, volumes, n }，索引与K线对齐
# 画线函数：draw_line(x1,y1,x2,y2) draw_hline(y) draw_ray(...)
#           draw_rect(...) draw_fib(x1,y1,x2,y2) draw_channel(...)

# 示例：最近 60 根的压力/支撑水平线 + 收盘价趋势线
win = 60
h = max(data['highs'][-win:])
l = min(data['lows'][-win:])
draw_hline(h, color='#f5222d', label='压力')
draw_hline(l, color='#14b143', label='支撑')

if n > 30:
    draw_line(0, data['closes'][0], n - 1, data['closes'][n - 1], color='#2f81f7', label='趋势')
`

/** 快捷需求（一键填充 AI 输入框） */
const QUICK_INTENTS = [
  '画出最近120根的支撑与压力位（横线）',
  '标出近期放量突破的位置（矩形）',
  '画上升趋势通道',
  '按波段高低点画斐波那契回撤',
  '标出金叉死叉位置（竖直短线段）',
  '以最新收盘价画一条提醒线'
]

interface Props {
  kline: KlineResult | null
  scope: string
  onClose: () => void
}

export default function DrawingAlgoPanel({ kline, scope, onClose }: Props) {
  const [code, setCode] = useState(DEFAULT_ALGO)
  const [editorHeight, setEditorHeight] = useState(() => {
    const saved = Number(localStorage.getItem('drawing.algo.editorHeight'))
    return Number.isFinite(saved) && saved >= 240 ? Math.min(720, saved) : 360
  })
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const runAlgo = useDrawings((s) => s.runAlgo)

  // ---- AI 生成/调优 ----
  const [intent, setIntent] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  // 有代码时生成会覆盖 → 先确认
  const [confirmOverwrite, setConfirmOverwrite] = useState<null | { req: string }>(null)

  const handleRun = async (): Promise<void> => {
    if (!kline || !kline.points.length) {
      setError('当前无K线数据，无法运行算法')
      return
    }
    setRunning(true)
    setError(null)
    setResult(null)
    const r = await runAlgo(code, kline, scope)
    setRunning(false)
    if (!r.ok) setError(r.error ?? '画线失败')
    else setResult(`✅ 已生成 ${r.count ?? 0} 条画线（代码窗口保留，可继续调整后再次运行）`)
  }

  const doAiCode = async (req: string, overwrite: boolean): Promise<void> => {
    if (!kline || !kline.points.length) {
      setAiError('当前无K线数据，无法生成')
      return
    }
    // 已改过代码且非空 → 首次覆盖需确认（用户可能手写了代码）
    if (!overwrite && code.trim() && code !== DEFAULT_ALGO) {
      setConfirmOverwrite({ req })
      return
    }
    setConfirmOverwrite(null)
    setAiBusy(true)
    setAiError(null)
    setAiNote(null)
    try {
      const r = await window.api.drawings.aiCode(req, code.trim() ? code : undefined, kline)
      if (r.ok && r.code) {
        setCode(r.code)
        setAiNote(r.note ?? '已生成代码，点「运行并画线」上屏')
      } else {
        setAiError(r.error ?? 'AI 生成失败')
      }
    } catch (err) {
      setAiError(`AI 生成失败：${err instanceof Error ? err.message : String(err)}`)
    }
    setAiBusy(false)
  }

  return (
    <div className="drawing-panel">
      <div className="chart-head">
        <span className="table-title">算法画线（Python）</span>
        <div className="editor-head-right">
          <span className="editor-hint">拖动代码框右下角调整高度 · 双击复位</span>
          <button className="btn primary" disabled={running} onClick={() => void handleRun()}>
            {running ? '运行中…' : '运行并画线'}
          </button>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {/* AI 生成/调优（输入需求 → AI 产出/修改代码 → 用户点运行上屏） */}
      <div className="algo-ai-bar">
        <div className="algo-ai-row">
          <Sparkles size={13} className="algo-ai-icon" />
          <input
            className="input algo-ai-input"
            placeholder="描述想要的画线，如：画出近期波段高低点的支撑压力线…（AI 生成/调优 Python 代码）"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !aiBusy && intent.trim()) void doAiCode(intent.trim(), false)
            }}
            disabled={aiBusy}
          />
          <button
            className="btn primary"
            disabled={aiBusy || !intent.trim()}
            onClick={() => void doAiCode(intent.trim(), false)}
            title={code.trim() && code !== DEFAULT_ALGO ? 'AI 将基于当前代码调优（覆盖前会确认）' : 'AI 生成新代码'}
          >
            {aiBusy ? '生成中…' : code.trim() && code !== DEFAULT_ALGO ? 'AI 调优' : 'AI 生成'}
          </button>
          <button
            className="btn"
            disabled={aiBusy}
            title="恢复默认示例代码（不动 AI/运行状态）"
            onClick={() => setCode(DEFAULT_ALGO)}
          >
            <RotateCcw size={12} style={{ verticalAlign: -2 }} /> 重置
          </button>
        </div>
        <div className="algo-ai-quick">
          {QUICK_INTENTS.map((q) => (
            <button
              key={q}
              className="btn algo-ai-chip"
              disabled={aiBusy}
              onClick={() => {
                setIntent(q)
                void doAiCode(q, false)
              }}
            >
              <Wand2 size={11} style={{ verticalAlign: -1.5, marginRight: 3 }} />
              {q}
            </button>
          ))}
        </div>
        {aiBusy && <div className="algo-ai-note">AI 正在结合当前K线生成代码…（首次约 5~20 秒）</div>}
        {aiNote && !aiBusy && <div className="algo-ai-note ok">✓ {aiNote}</div>}
        {aiError && <div className="backtest-error">⚠ {aiError}</div>}
        {confirmOverwrite && (
          <div className="algo-ai-confirm">
            当前代码已被修改，AI 调优会覆盖它。
            <button
              className="btn"
              onClick={() => void doAiCode(confirmOverwrite.req, true)}
            >
              覆盖（基于当前代码继续调）
            </button>
            <button className="btn" onClick={() => setConfirmOverwrite(null)}>
              取消
            </button>
          </div>
        )}
      </div>

      <textarea
        className="code-editor drawing-algo-editor"
        style={{ height: editorHeight }}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onMouseUp={(e) => {
          const next = Math.max(240, Math.min(720, e.currentTarget.offsetHeight))
          if (next !== editorHeight) {
            setEditorHeight(next)
            localStorage.setItem('drawing.algo.editorHeight', String(next))
          }
        }}
        onDoubleClick={() => {
          setEditorHeight(360)
          localStorage.setItem('drawing.algo.editorHeight', '360')
        }}
        title="拖动右下角调整代码框高度；双击恢复默认高度"
        spellCheck={false}
      />
      {error && <div className="backtest-error">⚠ {error}</div>}
      {result && <div className="backtest-target-bar">{result}</div>}
    </div>
  )
}