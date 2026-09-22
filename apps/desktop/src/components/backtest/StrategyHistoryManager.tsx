import { useEffect, useMemo, useState } from 'react'
import { Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  strategyHistoryManager,
  type StrategyHistoryRecord
} from '../../lib/strategy-history'

const PYTHON_EXTENSIONS = [python()]

interface Props {
  currentCode: string
  onRestore(record: StrategyHistoryRecord): void
  onClose(): void
}

export default function StrategyHistoryManager({ currentCode, onRestore, onClose }: Props) {
  const [records, setRecords] = useState<StrategyHistoryRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')

  const selected = records.find((record) => record.id === selectedId) ?? null
  const visibleRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return records
    return records.filter((record) => `${record.name}\n${record.code}`.toLowerCase().includes(keyword))
  }, [query, records])

  const select = (record: StrategyHistoryRecord): void => {
    setSelectedId(record.id)
    setName(record.name)
    setCode(record.code)
    setMessage('')
  }

  const reload = async (): Promise<void> => {
    const list = await strategyHistoryManager.list()
    setRecords(list)
    if (!selectedId && list[0]) select(list[0])
  }

  useEffect(() => { void reload() }, [])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const create = async (): Promise<void> => {
    const record = await strategyHistoryManager.create('未命名策略', currentCode)
    setRecords((items) => [record, ...items])
    select(record)
    setMessage('已新建一份当前策略的副本，可在右侧修改名称和代码。')
  }

  const update = async (): Promise<void> => {
    if (!selected) return
    if (!code.trim()) { setMessage('策略代码不能为空。'); return }
    const updated = await strategyHistoryManager.update(selected.id, { name, code })
    if (!updated) { setMessage('该历史版本已不存在，请刷新列表。'); return }
    setRecords((items) => items.map((item) => item.id === updated.id ? updated : item).sort((a, b) => b.updatedAt - a.updatedAt))
    select(updated)
    setMessage('已保存历史版本。')
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    if (!window.confirm(`确定删除“${selected.name}”吗？此操作不能撤销。`)) return
    await strategyHistoryManager.remove(selected.id)
    const next = records.filter((item) => item.id !== selected.id)
    setRecords(next)
    if (next[0]) select(next[0])
    else { setSelectedId(null); setName(''); setCode('') }
    setMessage('已删除历史版本。')
  }

  return (
    <div className="strategy-manager-mask" role="dialog" aria-modal="true" aria-label="策略历史管理器">
      <section className="strategy-manager-dialog">
        <header className="strategy-manager-header">
          <div><strong>策略历史管理器</strong><span>可新建、检索、编辑、恢复和删除本地策略版本</span></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="strategy-manager-body">
          <aside className="strategy-manager-list">
            <div className="strategy-manager-tools">
              <label className="strategy-history-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或代码" /></label>
              <button type="button" className="btn" onClick={() => void create()}><Plus size={13} /> 新建</button>
            </div>
            <div className="strategy-history-items">
              {!visibleRecords.length && <p>暂无匹配的历史版本</p>}
              {visibleRecords.map((record) => (
                <button type="button" key={record.id} className={record.id === selectedId ? 'active' : ''} onClick={() => select(record)}>
                  <strong>{record.name}</strong>
                  <span>{record.code.split('\n').find((line) => line.trim()) || '空策略'}</span>
                  <time>{new Date(record.updatedAt).toLocaleString()}</time>
                </button>
              ))}
            </div>
          </aside>
          <main className="strategy-manager-editor">
            {selected ? <>
              <label>版本名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：MACD 金叉策略" /></label>
              <div className="strategy-manager-code"><CodeMirror value={code} height="100%" theme={oneDark} extensions={PYTHON_EXTENSIONS} onChange={setCode} basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, autocompletion: false }} /></div>
              <div className="strategy-manager-actions">
                <span>{message}</span>
                <button type="button" className="btn" onClick={() => onRestore(selected)}><RotateCcw size={13} /> 恢复到编辑器</button>
                <button type="button" className="btn" onClick={() => void remove()}><Trash2 size={13} /> 删除</button>
                <button type="button" className="btn primary" onClick={() => void update()}><Save size={13} /> 保存修改</button>
              </div>
            </> : <div className="strategy-manager-empty">从左侧选择一个版本，或新建策略副本。</div>}
          </main>
        </div>
      </section>
    </div>
  )
}
