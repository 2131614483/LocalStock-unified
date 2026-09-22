import { useEffect, useRef, useState } from 'react'
import { History, Plus, Settings2 } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { useBacktest } from '../../store/backtest'
import { strategyHistoryManager, type StrategyHistoryRecord } from '../../lib/strategy-history'
import { customStrategyManager, type CustomStrategy } from '../../lib/custom-strategies'
import SplitPane from '../SplitPane'
import StrategyHistoryManager from './StrategyHistoryManager'
import CustomStrategyManager from './CustomStrategyManager'

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
  const [customStrategies, setCustomStrategies] = useState<CustomStrategy[]>([])
  const [selectedCustomId, setSelectedCustomId] = useState<string | null>(null)
  const [showCustomManager, setShowCustomManager] = useState(false)
  // 数字输入需要允许用户先清空再重新键入，不能每个字符都立即转成 Number。
  const [capitalInput, setCapitalInput] = useState(String(capital))

  useEffect(() => {
    latestCode.current = code
  }, [code])

  useEffect(() => {
    setCapitalInput(String(capital))
  }, [capital])

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

  const refreshCustomStrategies = async (): Promise<void> => {
    setCustomStrategies(await customStrategyManager.list())
  }

  useEffect(() => { void refreshCustomStrategies() }, [])

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

  const useCustomStrategy = (strategy: CustomStrategy): void => {
    latestCode.current = strategy.code
    setCode(strategy.code)
    setSelectedCustomId(strategy.id)
    void saveCode(strategy.code).catch(() => {})
    setShowCustomManager(false)
  }

  const createCustomStrategy = async (): Promise<void> => {
    const strategy = await customStrategyManager.create('未命名策略', code)
    setCustomStrategies((items) => [strategy, ...items])
    setSelectedCustomId(strategy.id)
    setShowCustomManager(true)
  }

  /**
   * 失焦、按回车或运行回测前统一提交资金。空值/非法值不会覆盖上一次有效资金，
   * 这样用户可以放心全选并直接输入新金额。
   */
  const commitCapital = (): boolean => {
    const nextCapital = Number(capitalInput)
    if (!capitalInput.trim() || !Number.isFinite(nextCapital) || nextCapital <= 0) {
      setCapitalInput(String(capital))
      return false
    }
    if (nextCapital !== capital) setParams({ capital: nextCapital })
    return true
  }

  const handleRunBacktest = (): void => {
    if (!commitCapital()) return
    void runBacktest()
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
            onClick={() => { setSelectedCustomId(null); applyTemplate(t.name, t.code) }}
          >
            {TEMPLATE_LABEL[t.name] ?? t.name}
          </div>
        ))}
        <div className="custom-strategy-section">
          <div className="custom-strategy-title">
            <span>自定义策略</span>
            <button className="icon-btn" onClick={() => void createCustomStrategy()} title="将当前代码新建为自定义策略" aria-label="新建自定义策略"><Plus size={14} /></button>
          </div>
          {customStrategies.map((strategy) => (
            <div
              key={strategy.id}
              className={`template-item ${selectedCustomId === strategy.id ? 'active' : ''}`}
              onClick={() => useCustomStrategy(strategy)}
              title={strategy.name}
            >
              {strategy.name}
            </div>
          ))}
          {!customStrategies.length && <div className="custom-strategy-empty">暂无自定义策略</div>}
          <button className="custom-strategy-manage" onClick={() => setShowCustomManager(true)}>管理自定义策略</button>
        </div>
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
              min={1}
              step={1000}
              value={capitalInput}
              onChange={(e) => setCapitalInput(e.target.value)}
              onBlur={commitCapital}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
              title="可直接全选后输入金额；离开输入框时自动保存"
            />
          </label>
          <button
            className="btn primary run-btn"
            disabled={running}
            onClick={handleRunBacktest}
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
      {showCustomManager && <CustomStrategyManager
        currentCode={code}
        onUse={useCustomStrategy}
        onClose={() => { setShowCustomManager(false); void refreshCustomStrategies() }}
      />}
    </div>
  )
}
