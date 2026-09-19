import { useCallback, useMemo } from 'react'
import type { Quote } from '../../shared/types'
import { useApp } from '../store/app'
import StockTable, { type Column } from '../components/StockTable'

const FID_MAP: Record<string, string> = {
  code: 'f12',
  name: 'f12',
  price: 'f2',
  changePercent: 'f3',
  change: 'f4',
  volume: 'f5',
  amount: 'f6',
  turnoverRate: 'f8',
  pe: 'f9',
  volumeRatio: 'f10',
  totalMv: 'f21',
  industry: 'f100'
}

/** 本地数据源没有的字段（换手率/PE/量比/行业）：隐藏列且禁止排序 */
const LOCAL_MISSING: string[] = ['turnoverRate', 'pe', 'volumeRatio', 'industry']

/** 总市值列（本地库有 mkt_cap_total，在线东财有 f21） */
const TOTAL_MV_COLUMN: Column = {
  key: 'totalMv',
  label: '总市值',
  render: (q: Quote) =>
    q.totalMv != null ? `${(q.totalMv / 1e8).toFixed(0)}亿` : '--'
}

/** 模块级常量：保持 extraColumns/omitKeys 引用稳定，避免行情推送时 columns/Row memo 失效 */
const EXTRA_MV: Column[] = [TOTAL_MV_COLUMN]

/** 沪深A股视图（主窗内嵌 / 浮窗共用） */
export default function MarketView() {
  const marketList = useApp((s) => s.marketList)
  const loadMarketList = useApp((s) => s.loadMarketList)
  const setView = useApp((s) => s.setView)

  // 本地模式判定：行无 turnoverRate/industry（本地生成不含这些字段）且总市值有值
  const isLocal = useMemo(
    () => marketList.rows.length > 0 && marketList.rows.every((r) => r.industry === undefined),
    [marketList.rows]
  )

  const sortKey = useMemo(() => {
    const found = Object.entries(FID_MAP).find(([, v]) => v === marketList.params.fid)
    return found ? found[0] : 'changePercent'
  }, [marketList.params.fid])
  const sortDir = marketList.params.order
  const totalPages = Math.max(1, Math.ceil(marketList.total / marketList.params.pz))

  const handleSort = (key: string): void => {
    const fid = FID_MAP[key] ?? 'f3'
    const order =
      marketList.params.fid === fid && marketList.params.order === 'desc' ? 'asc' : 'desc'
    void loadMarketList({ fid, order, pn: 1 })
  }

  // 稳定引用：避免 StockTable columns/Row memo 失效
  const onRowClick = useCallback(
    (r: Quote) => setView({ type: 'detail', secid: r.secid, name: r.name }),
    [setView]
  )

  return (
    <div className="table-card">
      <div className="table-toolbar">
        <span className="table-title">
          沪深A股
          <span className="table-total">共 {marketList.total} 只</span>
          {isLocal ? (
            <span className="table-total">（本地行情库 · 收盘数据）</span>
          ) : (
            marketList.loadedAt && (
              <span className="table-total">快照 {new Date(marketList.loadedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            )
          )}
        </span>
        <div className="table-actions">
          <button className="btn" onClick={() => void loadMarketList()}>
            刷新
          </button>
        </div>
      </div>
      <StockTable
        rows={marketList.rows}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={handleSort}
        // 本地模式下换手率/PE/量比/行业无数据：隐藏列且禁止排序（避免静默错排）
        sortableKeys={
          isLocal
            ? Object.keys(FID_MAP).filter((k) => !LOCAL_MISSING.includes(k))
            : undefined
        }
        onRowClick={onRowClick}
        omitKeys={isLocal ? LOCAL_MISSING : undefined}
        extraColumns={EXTRA_MV}
        resizable
        widthKey="market"
      />
      <div className="pagination">
        <select
          className="input"
          value={marketList.params.pz}
          title="每页条数"
          onChange={(e) => void loadMarketList({ pz: Number(e.target.value), pn: 1 })}
        >
          {[50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n} 条/页
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={marketList.params.pn <= 1}
          onClick={() => void loadMarketList({ pn: marketList.params.pn - 1 })}
        >
          上一页
        </button>
        <span>
          {marketList.params.pn} / {totalPages}
        </span>
        <input
          className="input"
          style={{ width: 52 }}
          title="跳转到页"
          defaultValue={marketList.params.pn}
          key={`${marketList.params.pn}-${totalPages}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = Number((e.target as HTMLInputElement).value)
              if (Number.isFinite(n) && n >= 1 && n <= totalPages) void loadMarketList({ pn: n })
            }
          }}
        />
        <button
          className="btn"
          disabled={marketList.params.pn >= totalPages}
          onClick={() => void loadMarketList({ pn: marketList.params.pn + 1 })}
        >
          下一页
        </button>
      </div>
    </div>
  )
}
