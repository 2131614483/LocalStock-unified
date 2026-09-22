import { useEffect, useMemo, useState } from 'react'
import { Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { customStrategyManager, type CustomStrategy } from '../../lib/custom-strategies'

const PYTHON_EXTENSIONS = [python()]

interface Props {
  currentCode: string
  onUse(strategy: CustomStrategy): void
  onClose(): void
}

export default function CustomStrategyManager({ currentCode, onUse, onClose }: Props) {
  const [strategies, setStrategies] = useState<CustomStrategy[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')

  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? null
  const visibleStrategies = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return strategies
    return strategies.filter((strategy) => `${strategy.name}\n${strategy.code}`.toLowerCase().includes(keyword))
  }, [query, strategies])

  const select = (strategy: CustomStrategy): void => {
    setSelectedId(strategy.id)
    setName(strategy.name)
    setCode(strategy.code)
    setMessage('')
  }

  useEffect(() => {
    void customStrategyManager.list().then((list) => {
      setStrategies(list)
      if (list[0]) select(list[0])
    })
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const create = async (): Promise<void> => {
    const strategy = await customStrategyManager.create('未命名策略', currentCode)
    setStrategies((items) => [strategy, ...items])
    select(strategy)
    setMessage('已新建当前策略副本，请修改名称或代码后保存。')
  }

  const update = async (): Promise<void> => {
    if (!selected) return
    if (!code.trim()) { setMessage('策略代码不能为空。'); return }
    const updated = await customStrategyManager.update(selected.id, { name, code })
    if (!updated) { setMessage('该策略已不存在，请重新打开管理器。'); return }
    setStrategies((items) => items.map((item) => item.id === updated.id ? updated : item).sort((a, b) => b.updatedAt - a.updatedAt))
    select(updated)
    setMessage('已保存自定义策略。')
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    if (!window.confirm(`确定删除自定义策略“${selected.name}”吗？此操作不能撤销。`)) return
    await customStrategyManager.remove(selected.id)
    const next = strategies.filter((item) => item.id !== selected.id)
    setStrategies(next)
    if (next[0]) select(next[0])
    else { setSelectedId(null); setName(''); setCode('') }
    setMessage('已删除自定义策略。')
  }

  return (
    <div className="strategy-manager-mask" role="dialog" aria-modal="true" aria-label="自定义策略管理器">
      <section className="strategy-manager-dialog">
        <header className="strategy-manager-header">
          <div><strong>自定义策略管理器</strong><span>可新建、检索、编辑、使用和删除自定义策略</span></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="strategy-manager-body">
          <aside className="strategy-manager-list">
            <div className="strategy-manager-tools">
              <label className="strategy-history-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或代码" /></label>
              <button type="button" className="btn" onClick={() => void create()}><Plus size={13} /> 新建</button>
            </div>
            <div className="strategy-history-items">
              {!visibleStrategies.length && <p>暂无匹配的自定义策略</p>}
              {visibleStrategies.map((strategy) => (
                <button type="button" key={strategy.id} className={strategy.id === selectedId ? 'active' : ''} onClick={() => select(strategy)}>
                  <strong>{strategy.name}</strong>
                  <span>{strategy.code.split('\n').find((line) => line.trim()) || '空策略'}</span>
                  <time>{new Date(strategy.updatedAt).toLocaleString()}</time>
                </button>
              ))}
            </div>
          </aside>
          <main className="strategy-manager-editor">
            {selected ? <>
              <label>策略名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：ETF 趋势策略" /></label>
              <div className="strategy-manager-code"><CodeMirror value={code} height="100%" theme={oneDark} extensions={PYTHON_EXTENSIONS} onChange={setCode} basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, autocompletion: false }} /></div>
              <div className="strategy-manager-actions">
                <span>{message}</span>
                <button type="button" className="btn" onClick={() => onUse(selected)}><RotateCcw size={13} /> 使用此策略</button>
                <button type="button" className="btn" onClick={() => void remove()}><Trash2 size={13} /> 删除</button>
                <button type="button" className="btn primary" onClick={() => void update()}><Save size={13} /> 保存修改</button>
              </div>
            </> : <div className="strategy-manager-empty">从左侧选择策略，或新建当前代码的副本。</div>}
          </main>
        </div>
      </section>
    </div>
  )
}
