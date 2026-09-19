import type { Quote } from '../../shared/types'
import {
  formatAmount,
  formatMv,
  formatNum,
  formatPercent,
  formatPrice,
  formatSigned,
  formatVolume,
  trendColor
} from '../lib/format'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  )
}

interface Props {
  quote: Quote | null
  inWatchlist: boolean
  onToggleWatchlist: () => void
  onBacktest?: () => void
}

export default function QuoteHeader({ quote, inWatchlist, onToggleWatchlist, onBacktest }: Props) {
  if (!quote) {
    return <div className="loading">加载中…</div>
  }
  const color = trendColor(quote.changePercent)

  return (
    <div className="detail-head">
      <div>
        <div className="detail-name-box">
          <span className="stock-title">{quote.name}</span>
          <span className="stock-code">{quote.code}</span>
          <button
            className={`btn ${inWatchlist ? 'active' : ''}`}
            onClick={onToggleWatchlist}
            style={{ marginLeft: 12 }}
          >
            {inWatchlist ? '★ 已自选' : '☆ 加自选'}
          </button>
          {onBacktest && (
            <button className="btn" onClick={onBacktest} style={{ marginLeft: 8 }}>
              回测
            </button>
          )}
        </div>
        <div className="detail-price" style={{ color }}>
          {formatPrice(quote.price)}
        </div>
        <div className="detail-change" style={{ color }}>
          {formatSigned(quote.change)}　{formatPercent(quote.changePercent)}
        </div>
      </div>
      <div className="detail-metrics">
        <Metric label="今开" value={formatPrice(quote.open)} />
        <Metric label="昨收" value={formatPrice(quote.preClose)} />
        <Metric label="最高" value={formatPrice(quote.high)} />
        <Metric label="最低" value={formatPrice(quote.low)} />
        <Metric label="成交量" value={formatVolume(quote.volume)} />
        <Metric label="成交额" value={formatAmount(quote.amount)} />
        <Metric label="换手率" value={`${formatNum(quote.turnoverRate)}%`} />
        <Metric label="市盈率" value={formatNum(quote.pe)} />
        <Metric label="量比" value={formatNum(quote.volumeRatio)} />
        <Metric label="振幅" value={`${formatNum(quote.amplitude)}%`} />
        <Metric label="总市值" value={formatMv(quote.totalMv)} />
        <Metric label="流通市值" value={formatMv(quote.floatMv)} />
      </div>
    </div>
  )
}
