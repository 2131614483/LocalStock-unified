import { useRef, useState } from 'react'
import { History } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { useBacktest } from '../../store/backtest'
import SplitPane from '../SplitPane'

const TEMPLATE_LABEL: Record<string, string> = {
  buy_and_hold: '买入持有',
  dual_ma: '双均线',
  bollinger: '布林带',
  turtle: '海龟'
}

/** 深色 Python 编辑器扩展：语法高亮（CodeMirror 6，A8） */
const PY_EXTENSIONS = [python()]
const STRATEGY_HISTORY_KEY = 'localstock.backtest.code-history'
interface CodeVersion { code: string; ts: number }

function readCodeHistory(): CodeVersion[] {
  try { return JSON.parse(localStorage.getItem(STRATEGY_HISTORY_KEY) || '[]') as CodeVersion[] } catch { return [] }
}

export default function StrategyEditor() {
  const templates = useBacktest((s) => s.templates)
  const selectedTemplate = useBacktest((s) => s.selectedTemplate)
  const code = useBacktest((s) => s.code)
  const applyTemplate = useBacktest((s) => s.applyTemplate)
  const setCode = useBacktest((s) => s.setCode)
  const setParams = useBacktest((s) => s.setParams)
  const startDate = useBacktest((s) => s.startDate)
  const endDate = useBacktest((s) => s.endDate)
  const capital = useBacktest((s) => s.capital)
  const runBacktest = useBacktest((s) => s.runBacktest)
  const running = useBacktest((s) => s.running)
  const resetToTemplate = useBacktest((s) => s.resetToTemplate)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [codeHistory, setCodeHistory] = useState<CodeVersion[]>(readCodeHistory)
  const [showHistory, setShowHistory] = useState(false)

  const rememberCode = (value: string): void => {
    if (!value.trim()) return
    const next = [{ code: value, ts: Date.now() }, ...readCodeHistory().filter((item) => item.code !== value)].slice(0, 20)
    localStorage.setItem(STRATEGY_HISTORY_KEY, JSON.stringify(next))
    setCodeHistory(next)
  }

  const handleCodeChange = (v: string): void => {
    setCode(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // 1 秒防抖自动保存，重启后恢复
    saveTimer.current = setTimeout(() => {
      void window.api.settings.set('backtest.code', v).catch(() => {})
    }, 1000)
    if (historyTimer.current) clearTimeout(historyTimer.current)
    historyTimer.current = setTimeout(() => rememberCode(v), 1200)
  }

  return (
    <div className="editor-panel">
      <SplitPane direction="vertical" initial={150} min={120} max={280} storageKey="split.templates">
      <div className="template-list">
        <div className="panel-title">策略模板</div>
        {templates.map((t) => (
          <div
            key={t.name}
            className={`template-item ${selectedTemplate === t.name ? 'active' : ''}`}
            onClick={() => applyTemplate(t.name, t.code)}
          >
            {TEMPLATE_LABEL[t.name] ?? t.name}
          </div>
        ))}
      </div>

      <div className="editor-main">
        <div className="editor-head">
          <span className="panel-title">策略代码（Python）</span>
          <div className="editor-head-right">
            <div className="strategy-history-wrap">
              <button className="btn" onClick={() => setShowHistory((value) => !value)} title="查看最近代码版本">
                <History size={12} /> 历史 {codeHistory.length}
              </button>
              {showHistory && (
                <div className="strategy-code-history">
                  {!codeHistory.length && <div>暂无历史</div>}
                  {codeHistory.map((item) => (
                    <button key={item.ts} onClick={() => { rememberCode(code); setCode(item.code); void window.api.settings.set('backtest.code', item.code); setShowHistory(false) }}>
                      <span>{item.code.split('\n').find((line) => line.trim()) || '代码版本'}</span>
                      <time>{new Date(item.ts).toLocaleString()}</time>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn" onClick={() => { rememberCode(code); resetToTemplate() }} title="恢复模板原始代码">
              复原
            </button>
            <span className="editor-hint">
              自动保存 · 用 log() 代替 print() · 代码用 600519.XSHG 格式
            </span>
          </div>
        </div>
        <div className="code-editor">
          <CodeMirror
            value={code}
            height="100%"
            theme={oneDark}
            extensions={PY_EXTENSIONS}
            onChange={handleCodeChange}
            spellCheck={false}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              bracketMatching: true,
              autocompletion: false
            }}
          />
        </div>
        <div className="param-row">
          <label className="param-label">
            开始日期
            <input
              type="date"
              value={startDate}
              onChange={(e) => setParams({ startDate: e.target.value })}
            />
          </label>
          <label className="param-label">
            结束日期
            <input
              type="date"
              value={endDate}
              onChange={(e) => setParams({ endDate: e.target.value })}
            />
          </label>
          <label className="param-label">
            初始资金
            <input
              type="number"
              step={100000}
              value={capital}
              onChange={(e) => setParams({ capital: Number(e.target.value) })}
            />
          </label>
          <button
            className="btn primary run-btn"
            disabled={running}
            onClick={() => void runBacktest()}
          >
            {running ? '回测中…' : '▶ 运行回测'}
          </button>
        </div>
      </div>
      </SplitPane>
    </div>
  )
}
