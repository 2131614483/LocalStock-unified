import { useEffect, useRef, useState } from 'react'
import { History, Settings2 } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { useBacktest } from '../../store/backtest'
import { strategyHistoryManager, type StrategyHistoryRecord } from '../../lib/strategy-history'
import SplitPane from '../SplitPane'
import StrategyHistoryManager from './StrategyHistoryManager'

const TEMPLATE_LABEL: Record<string, string> = {
  buy_and_hold: '买入持有',
  dual_ma: '双均线',
  bollinger: '布林带',
  turtle: '海龟'
}

/** 深色 Python 编辑器扩展：语法高亮（CodeMirror 6，A8） */
const PY_EXTENSIONS = [python()]
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
  const saveCode = useBacktest((s) => s.saveCode)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestCode = useRef(code)
  const [historyCount, setHistoryCount] = useState(0)
  const [showHistoryManager, setShowHistoryManager] = useState(false)

  useEffect(() => {
    latestCode.current = code
  }, [code])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (historyTimer.current) clearTimeout(historyTimer.current)
    // 离开回测页或关闭窗口时，不丢弃尚未到达防抖时间的最后一次改动。
    void saveCode(latestCode.current).catch(() => {})
  }, [saveCode])

  const refreshHistoryCount = async (): Promise<void> => {
    setHistoryCount((await strategyHistoryManager.list()).length)
  }

  useEffect(() => { void refreshHistoryCount() }, [])

  const rememberCode = async (value: string): Promise<void> => {
    await strategyHistoryManager.capture(value)
    await refreshHistoryCount()
  }

  const handleCodeChange = (v: string): void => {
    latestCode.current = v
    setCode(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // 1 秒防抖自动保存，重启后恢复
    saveTimer.current = setTimeout(() => {
      void saveCode(v).catch(() => {})
    }, 1000)
    if (historyTimer.current) clearTimeout(historyTimer.current)
    historyTimer.current = setTimeout(() => { void rememberCode(v) }, 1200)
  }

  const restoreHistory = (record: StrategyHistoryRecord): void => {
    latestCode.current = record.code
    setCode(record.code)
    void saveCode(record.code).catch(() => {})
    setShowHistoryManager(false)
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
            <button className="btn" onClick={() => setShowHistoryManager(true)} title="管理策略历史版本">
              <History size={12} /> 历史 {historyCount}
            </button>
            <button className="btn" onClick={() => setShowHistoryManager(true)} title="新建、编辑、恢复或删除历史策略">
              <Settings2 size={12} /> 管理
            </button>
            <button className="btn" onClick={() => { void rememberCode(code); resetToTemplate() }} title="恢复模板原始代码">
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
      {showHistoryManager && <StrategyHistoryManager
        currentCode={code}
        onRestore={restoreHistory}
        onClose={() => { setShowHistoryManager(false); void refreshHistoryCount() }}
      />}
    </div>
  )
}
