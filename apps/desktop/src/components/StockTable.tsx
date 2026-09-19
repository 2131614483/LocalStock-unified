import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Quote } from '../../shared/types'
import {
  formatAmount,
  formatNum,
  formatPercent,
  formatPrice,
  formatSigned,
  formatVolume,
  formatMv,
  trendClass,
  trendColor
} from '../lib/format'

export interface Column {
  key: string
  label: string
  align?: 'left' | 'right'
  render: (q: Quote) => ReactNode
}

/** 现价：价格变化时短暂闪烁背景色（按逐笔方向：升闪红、降闪绿，同花顺风格） */
function PriceCell({ price, changePercent }: { price: number; changePercent: number }) {
  const prevRef = useRef(price)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    const prev = prevRef.current
    if (prev !== price) {
      prevRef.current = price
      // 闪烁颜色跟逐笔方向（本次 tick 相对上次 tick），平盘不闪
      if (price > prev) {
        setFlash('up')
        const t = setTimeout(() => setFlash(null), 700)
        return () => clearTimeout(t)
      }
      if (price < prev) {
        setFlash('down')
        const t = setTimeout(() => setFlash(null), 700)
        return () => clearTimeout(t)
      }
    }
  }, [price])

  const cls = flash ? `price-cell flash-${flash}` : 'price-cell'
  return (
    <span className={cls} style={{ color: trendColor(changePercent) }}>
      {formatPrice(price)}
    </span>
  )
}

const BASE_COLUMNS: Column[] = [
  {
    key: 'name',
    label: '名称',
    align: 'left',
    render: (q) => <span className="stock-name">{q.name}</span>
  },
  {
    key: 'code',
    label: '代码',
    align: 'left',
    render: (q) => <span className="stock-code">{q.code}</span>
  },
  {
    key: 'price',
    label: '现价',
    render: (q) => <PriceCell price={q.price} changePercent={q.changePercent} />
  },
  {
    key: 'changePercent',
    label: '涨跌幅',
    render: (q) => (
      <span className={`chg-cell ${trendClass(q.changePercent)}`}>
        {formatPercent(q.changePercent)}
      </span>
    )
  },
  {
    key: 'change',
    label: '涨跌额',
    render: (q) => (
      <span className={trendClass(q.changePercent)}>{formatSigned(q.change)}</span>
    )
  },
  { key: 'volume', label: '成交量', render: (q) => formatVolume(q.volume) },
  { key: 'amount', label: '成交额', render: (q) => formatAmount(q.amount) },
  {
    key: 'turnoverRate',
    label: '换手率',
    render: (q) => (q.turnoverRate != null ? `${q.turnoverRate.toFixed(2)}%` : '--')
  },
  { key: 'pe', label: '市盈率', render: (q) => formatNum(q.pe) },
  { key: 'volumeRatio', label: '量比', render: (q) => formatNum(q.volumeRatio) }
]

const INDUSTRY_COLUMN: Column = {
  key: 'industry',
  label: '行业',
  align: 'left',
  render: (q) => <span className="stock-code">{q.industry || '--'}</span>
}

const TOTAL_MV_COLUMN: Column = {
  key: 'totalMv',
  label: '总市值',
  render: (q) => formatMv(q.totalMv)
}

/** 本地数据源没有的列 key（换手率/市盈率/量比），MarketView 本地模式下隐藏 */
const LOCAL_MISSING_KEYS = ['turnoverRate', 'pe', 'volumeRatio']

/**
 * 行情行 memo：逐字段比较 Quote——1s 行情推送时只重渲真正变化的行，
 * 静止行不做 reconciliation（P1 性能项：50~100 行 × 1s 全表 diff 的瓶颈）。
 */
const Row = memo(
  function Row({
    row,
    columns,
    selected,
    onRowClick
  }: {
    row: Quote
    columns: Column[]
    selected: boolean
    onRowClick?: (row: Quote) => void
  }) {
    return (
      <tr
        className={selected ? 'selected' : ''}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
      >
        {columns.map((c) => (
          <td key={c.key} className={c.align === 'left' ? 'left' : undefined}>
            {c.render(row)}
          </td>
        ))}
      </tr>
    )
  },
  (p, n) => {
    // 相同引用直接跳过
    if (p.row === n.row) return true
    // 逐字段比较：字段全等则本行重渲染无意义
    const a = p.row
    const b = n.row
    return (
      a.secid === b.secid &&
      a.code === b.code &&
      a.name === b.name &&
      a.price === b.price &&
      a.change === b.change &&
      a.changePercent === b.changePercent &&
      a.open === b.open &&
      a.high === b.high &&
      a.low === b.low &&
      a.preClose === b.preClose &&
      a.volume === b.volume &&
      a.amount === b.amount &&
      a.amplitude === b.amplitude &&
      a.turnoverRate === b.turnoverRate &&
      a.pe === b.pe &&
      a.pb === b.pb &&
      a.volumeRatio === b.volumeRatio &&
      a.totalMv === b.totalMv &&
      a.floatMv === b.floatMv &&
      a.industry === b.industry &&
      a.limitUp === b.limitUp &&
      a.limitDown === b.limitDown &&
      a.isIndex === b.isIndex &&
      a.time === b.time &&
      p.selected === n.selected &&
      p.columns === n.columns &&
      p.onRowClick === n.onRowClick
    )
  }
)

interface Props {
  rows: Quote[]
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSortChange?: (key: string) => void
  /** 可排序的列 key 白名单（缺省 = 除 _ 前缀外全部可排） */
  sortableKeys?: string[]
  onRowClick?: (row: Quote) => void
  selectedSecid?: string
  showIndustry?: boolean
  /** 隐藏指定 key 的列（如本地模式无数据的换手率/PE/量比/行业） */
  omitKeys?: string[]
  /** 追加列（如总市值） */
  extraColumns?: Column[]
  renderActions?: (row: Quote) => ReactNode
  /** 启用列宽拖拽并记忆（key 用于区分不同表格的 localStorage） */
  resizable?: boolean
  /** 列宽记忆分组 key（如 'watchlist' / 'market'），缺省用 'default' */
  widthKey?: string
}

/** 列宽记忆 localStorage key */
function widthStorageKey(widthKey: string): string {
  return `table.colwidths.${widthKey}`
}

/** 拖拽时禁止触发表头排序 */
const stop = (e: React.MouseEvent): void => e.stopPropagation()

export default function StockTable({
  rows,
  sortKey,
  sortDir,
  onSortChange,
  sortableKeys,
  onRowClick,
  selectedSecid,
  showIndustry = false,
  omitKeys,
  extraColumns,
  renderActions,
  resizable = false,
  widthKey = 'default'
}: Props) {
  // columns 引用稳定：行情 1s 推送时 Row 的 memo 依赖 columns 引用，每次重建会失效
  const columns = useMemo<Column[]>(() => {
    let cols: Column[] = [...BASE_COLUMNS]
    if (omitKeys?.length) cols = cols.filter((c) => !omitKeys.includes(c.key))
    if (extraColumns?.length) cols.push(...extraColumns)
    if (showIndustry) cols.push(INDUSTRY_COLUMN)
    if (renderActions) {
      cols.push({
        key: '_actions',
        label: '操作',
        align: 'left',
        render: renderActions
      })
    }
    return cols
  }, [omitKeys, extraColumns, showIndustry, renderActions])

  // U9 列宽拖拽记忆（只对 resizable 表格生效）
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (!resizable) return {}
    try {
      return JSON.parse(localStorage.getItem(widthStorageKey(widthKey)) ?? '{}') as Record<
        string,
        number
      >
    } catch {
      return {}
    }
  })
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    },
    []
  )

  const hasWidths = resizable && Object.keys(colWidths).length > 0

  const onResizeStart = useCallback(
    (e: React.MouseEvent, key: string) => {
      if (!resizable) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = colWidths[key] ?? 120
      const move = (ev: MouseEvent): void => {
        const next = Math.max(48, Math.min(420, startW + (ev.clientX - startX)))
        setColWidths((prev) => {
          if (prev[key] === next) return prev
          const w = { ...prev, [key]: next }
          if (persistTimer.current) clearTimeout(persistTimer.current)
          persistTimer.current = setTimeout(() => {
            localStorage.setItem(widthStorageKey(widthKey), JSON.stringify(w))
          }, 300)
          return w
        })
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.classList.remove('resizing-col')
      }
      document.body.classList.add('resizing-col')
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [resizable, colWidths, widthKey]
  )

  if (rows.length === 0) {
    return (
      <div className="empty">
        <span className="spinner" />
        暂无数据，正在获取行情…
        <div style={{ marginTop: 8, fontSize: 12 }}>
          可点上方「刷新」重试，或检查网络（在线源限流时会显示暂无数据）
        </div>
      </div>
    )
  }

  return (
    <div className="table-card">
      {/* 滚动区垫一层 div：Chromium 里滚动容器直接子元素是 <table> 时 thead th 的 sticky 吸附失效 */}
      <div className="table-scroll">
        <table className={`stock-table ${hasWidths ? 'col-resizable' : ''}`}>
          {resizable && hasWidths && (
            <colgroup>
              {columns.map((c) => (
                <col key={c.key} style={{ width: colWidths[c.key] }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable =
                  !!onSortChange &&
                  !c.key.startsWith('_') &&
                  (!sortableKeys || sortableKeys.includes(c.key))
                return (
                  <th
                    key={c.key}
                    className={`${c.align === 'left' ? 'left ' : ''}${sortable ? '' : 'no-sort'}`}
                    onClick={sortable ? () => onSortChange!(c.key) : undefined}
                  >
                    {c.label}
                    {sortKey === c.key && (
                      <span className="sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>
                    )}
                    {resizable && (
                      <span
                        className="col-resizer"
                        title="拖拽调整列宽"
                        onMouseDown={(e) => onResizeStart(e, c.key)}
                        onDragStart={stop}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.secid}
                row={row}
                columns={columns}
                selected={selectedSecid === row.secid}
                onRowClick={onRowClick}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}