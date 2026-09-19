import { useCallback, useMemo, useState } from 'react'
import type { Quote } from '../../shared/types'
import { INDEX_SECIDS } from '../../shared/types'
import { useApp } from '../store/app'
import StockTable from '../components/StockTable'

type SortDir = 'asc' | 'desc'
type Accessor = (q: Quote) => number | string | null | undefined

const ACCESSORS: Record<string, Accessor> = {
  name: (q) => q.name,
  code: (q) => q.code,
  price: (q) => q.price,
  changePercent: (q) => q.changePercent,
  change: (q) => q.change,
  volume: (q) => q.volume,
  amount: (q) => q.amount,
  turnoverRate: (q) => q.turnoverRate ?? null,
  pe: (q) => q.pe ?? null,
  volumeRatio: (q) => q.volumeRatio ?? null,
  industry: (q) => q.industry ?? ''
}

/** 本地排序（自选股等内存列表） */
function useLocalSort(rows: Quote[]) {
  const [sortKey, setSortKey] = useState('changePercent')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    const acc = ACCESSORS[sortKey] ?? ACCESSORS.changePercent
    const arr = rows.filter((q) => {
      const v = acc(q)
      return v !== undefined && v !== null && v !== ''
    })
    arr.sort((a, b) => {
      const va = acc(a)
      const vb = acc(b)
      if (va == null || vb == null) return 0
      const c = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? c : -c
    })
    return arr
  }, [rows, sortKey, sortDir])

  const handleSort = (key: string): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return { sorted, sortKey, sortDir, handleSort }
}

/** 自选股视图（主窗内嵌 / 浮窗共用） */
export default function WatchlistView() {
  const watchlist = useApp((s) => s.watchlist)
  const quotes = useApp((s) => s.quotes)
  const setView = useApp((s) => s.setView)

  const rows = useMemo(() => {
    const idxSecids = new Set(INDEX_SECIDS)
    return watchlist
      .map((w) => quotes.find((q) => q.secid === w.secid))
      .filter((q): q is Quote => !!q && !idxSecids.has(q.secid))
  }, [watchlist, quotes])

  const { sorted, sortKey, sortDir, handleSort } = useLocalSort(rows)

  // 稳定引用：renderActions/onRowClick 若每次新建会让 StockTable 的 columns memo 失效，
  // 行情 1s 推送时所有行都重渲染（P1 性能项）。用 useCallback 固定。
  const renderActions = useCallback(
    (row: Quote) => (
      <button
        className="row-action"
        title={`删除自选 ${row.name}`}
        onClick={(e) => {
          e.stopPropagation()
          void useApp
            .getState()
            .toggleWatchlist({ secid: row.secid, code: row.code, name: row.name })
        }}
      >
        ✕
      </button>
    ),
    []
  )
  const onRowClick = useCallback(
    (r: Quote) => setView({ type: 'detail', secid: r.secid, name: r.name }),
    [setView]
  )

  return (
    <div className="table-card">
      <div className="table-toolbar">
        <span className="table-title">
          自选股
          <span className="table-total">共 {rows.length} 只</span>
        </span>
        <span className="updated-at">实时刷新中</span>
      </div>
      <StockTable
        rows={sorted}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={handleSort}
        onRowClick={onRowClick}
        resizable
        widthKey="watchlist"
        renderActions={renderActions}
      />
    </div>
  )
}
