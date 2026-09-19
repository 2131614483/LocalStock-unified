import { useEffect, useState } from 'react'
import { History, RotateCcw, X } from 'lucide-react'

type MemoryElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
interface Entry { value: string; ts: number }

function eligible(target: EventTarget | null): target is MemoryElement {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return false
  if (target instanceof HTMLInputElement && ['password', 'checkbox', 'radio', 'file', 'button', 'submit', 'hidden'].includes(target.type)) return false
  const readOnly = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target.readOnly
    : false
  return !target.disabled && !readOnly && target.dataset.memory !== 'off'
}

function initialValue(el: MemoryElement): string {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options).find((option) => option.defaultSelected)?.value
      ?? el.options.item(0)?.value
      ?? ''
  }
  return el.defaultValue || ''
}

function elementKey(el: MemoryElement): string {
  if (el.dataset.memoryKey) return el.dataset.memoryKey
  const parts: string[] = []
  let node: Element | null = el
  while (node && parts.length < 5) {
    const parent: Element | null = node.parentElement
    const index = parent ? Array.from(parent.children).indexOf(node) : 0
    parts.unshift(`${node.tagName.toLowerCase()}:${index}`)
    node = parent
  }
  return [location.pathname, el.name, el.id, el.getAttribute('placeholder'), parts.join('/')].filter(Boolean).join('|')
}

function storageKey(el: MemoryElement): string {
  let hash = 2166136261
  for (const char of elementKey(el)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `localstock.input-memory.${(hash >>> 0).toString(36)}`
}

function readEntries(el: MemoryElement): Entry[] {
  try { return JSON.parse(localStorage.getItem(storageKey(el)) || '[]') as Entry[] } catch { return [] }
}

function applyValue(el: MemoryElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.focus()
}

/** 为全应用非敏感输入提供自动记忆、版本历史和复位。 */
export default function InputMemoryManager() {
  const [active, setActive] = useState<MemoryElement | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    const defaults = new WeakMap<MemoryElement, string>()
    const restored = new WeakSet<MemoryElement>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const locate = (el: MemoryElement): void => {
      const rect = el.getBoundingClientRect()
      setPosition({ top: Math.max(4, rect.top - 28), left: Math.max(4, Math.min(window.innerWidth - 154, rect.right - 150)) })
    }
    const focus = (event: FocusEvent): void => {
      if (!eligible(event.target)) return
      const el = event.target
      if (!defaults.has(el)) defaults.set(el, el.value)
      const history = readEntries(el)
      if (!restored.has(el) && !el.value && history[0]?.value) applyValue(el, history[0].value)
      restored.add(el)
      setActive(el)
      setEntries(readEntries(el))
      setShowHistory(false)
      locate(el)
    }
    const input = (event: Event): void => {
      if (!eligible(event.target)) return
      const el = event.target
      const key = storageKey(el)
      const oldTimer = timers.get(key)
      if (oldTimer) clearTimeout(oldTimer)
      timers.set(key, setTimeout(() => {
        const value = el.value
        const old = readEntries(el).filter((entry) => entry.value !== value)
        const next = value ? [{ value, ts: Date.now() }, ...old].slice(0, 20) : old
        localStorage.setItem(key, JSON.stringify(next))
        if (el === active) setEntries(next)
      }, 700))
    }
    const reposition = (): void => { if (active?.isConnected) locate(active) }
    document.addEventListener('focusin', focus, true)
    document.addEventListener('input', input, true)
    document.addEventListener('change', input, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('focusin', focus, true)
      document.removeEventListener('input', input, true)
      document.removeEventListener('change', input, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [active])

  if (!active?.isConnected) return null
  return (
    <div className="input-memory-tools" style={position} onMouseDown={(event) => event.preventDefault()}>
      <button title="输入历史" onClick={() => { setEntries(readEntries(active)); setShowHistory((value) => !value) }}><History size={12} /> 历史</button>
      <button title="复位并保留历史" onClick={() => applyValue(active, initialValue(active))}><RotateCcw size={12} /> 复位</button>
      <button title="关闭" onClick={() => setActive(null)}><X size={12} /></button>
      {showHistory && (
        <div className="input-memory-history">
          <div className="input-memory-title">最近输入（最多20条）</div>
          {!entries.length && <div className="input-memory-empty">暂无历史</div>}
          {entries.map((entry) => (
            <button key={`${entry.ts}-${entry.value}`} onClick={() => { applyValue(active, entry.value); setShowHistory(false) }}>
              <span>{entry.value}</span><time>{new Date(entry.ts).toLocaleString()}</time>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
