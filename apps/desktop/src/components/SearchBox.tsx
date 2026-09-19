import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { SearchResult } from '../../shared/types'

interface Props {
  onSelect: (r: SearchResult) => void
}

const ACTIVE_CLASS = 'active'

export default function SearchBox({ onSelect }: Props) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // 搜索失败原因（限流/网络）——U6 失败可见，不再静默
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const doSearch = (k: string): void => {
    setError(null)
    window.api.market
      .search(k)
      .then((r) => {
        setResults(r.slice(0, 10))
        setOpen(true)
        setActive(-1)
      })
      .catch(() => {
        setResults([])
        setOpen(true)
        setError('搜索服务不可用（在线源限流），请稍后重试')
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
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
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

  return (
    <div className="search-wrap">
      <span className="search-icon">
        <Search size={13} />
      </span>
      <input
        className="search-input"
        placeholder="搜索股票代码 / 名称 / 拼音"
        value={keyword}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => (results.length > 0 || error ? setOpen(true) : null)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
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
            <div className="search-empty">未找到相关股票</div>
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
