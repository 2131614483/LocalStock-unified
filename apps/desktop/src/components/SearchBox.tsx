import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { SearchResult, SearchScope } from '../../shared/types'

interface Props {
  onSelect: (r: SearchResult) => void
}

const ACTIVE_CLASS = 'active'
const SEARCH_SCOPES: Array<{ key: SearchScope; label: string }> = [
  { key: 'stock', label: '股票' },
  { key: 'fund', label: '基金' },
  { key: 'index', label: '指数' }
]

export default function SearchBox({ onSelect }: Props) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [scopes, setScopes] = useState<Record<SearchScope, boolean>>({
    stock: true, fund: true, index: true
  })
  // 搜索失败原因（限流/网络）——U6 失败可见，不再静默
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const selectedScopes = (next = scopes): SearchScope[] =>
    SEARCH_SCOPES.filter((scope) => next[scope.key]).map((scope) => scope.key)

  const doSearch = (k: string, searchScopes = selectedScopes()): void => {
    setError(null)
    if (!searchScopes.length) {
      setResults([])
      setOpen(true)
      setError('请至少勾选一个搜索范围')
      return
    }
    window.api.market
      .search(k, searchScopes)
      .then((r) => {
        setResults(r.slice(0, 10))
        setOpen(true)
        setActive(-1)
      })
      .catch(() => {
        setResults([])
        setOpen(true)
        setError('本地搜索不可用，请检查行情库设置')
      })
  }

  const onInput = (v: string): void => {
    setKeyword(v)
    if (timer.current) clearTimeout(timer.current)
    const k = v.trim()
    if (!k) {
      setResults([])
      setOpen(false)
      setError(null)
      return
    }
    timer.current = setTimeout(() => doSearch(k), 250)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      if (active >= 0 && active < results.length) {
        const r = results[active]
        setOpen(false)
        setKeyword('')
        onSelect(r)
      }
    }
  }

  const pick = (r: SearchResult): void => {
    setOpen(false)
    setKeyword('')
    onSelect(r)
  }

  const toggleScope = (scope: SearchScope): void => {
    const next = { ...scopes, [scope]: !scopes[scope] }
    setScopes(next)
    if (timer.current) clearTimeout(timer.current)
    if (keyword.trim()) doSearch(keyword.trim(), selectedScopes(next))
  }

  return (
    <div className="search-wrap">
      <div className="search-main">
        <span className="search-icon">
          <Search size={13} />
        </span>
        <input
          className="search-input"
          placeholder="全局搜索：代码或名称"
          value={keyword}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => (results.length > 0 || error ? setOpen(true) : null)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <div className="search-scopes" aria-label="搜索范围">
          {SEARCH_SCOPES.map((scope) => (
            <label className="search-scope" key={scope.key} title={`搜索${scope.label}`}>
              <input
                type="checkbox"
                checked={scopes[scope.key]}
                onChange={() => toggleScope(scope.key)}
              />
              {scope.label}
            </label>
          ))}
        </div>
      </div>
      {open && (
        <div className="search-dropdown">
          {error ? (
            <div className="search-empty" style={{ color: 'var(--up)' }}>
              {error}
              <button
                className="btn"
                style={{ marginLeft: 8 }}
                onClick={() => keyword.trim() && doSearch(keyword.trim())}
              >
                重试
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="search-empty">当前范围内未找到结果</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.secid}
                className={`search-item ${i === active ? ACTIVE_CLASS : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(r)
                }}
              >
                <span>
                  <span className="search-item-name">{r.name}</span>
                  <span className="search-item-meta">{r.type}</span>
                </span>
                <span className="search-item-meta">{r.code}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
