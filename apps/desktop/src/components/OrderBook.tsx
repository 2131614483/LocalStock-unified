import type { OrderBook as OrderBookType } from '../../shared/types'
import {
  formatMv,
  formatNum,
  formatPercent,
  formatPrice,
  formatSigned,
  formatVolume,
  trendClass,
  trendColor
} from '../lib/format'

export default function OrderBook({ ob }: { ob: OrderBookType | null }) {
  if (!ob) {
    return (
      <div className="orderbook">
        <div className="ob-title">五档盘口</div>
        <div className="empty" style={{ padding: 20 }}>
          加载中…
        </div>
      </div>
    )
  }

  const bidSum = ob.bid.reduce((s, l) => s + l.volume, 0)
  const askSum = ob.ask.reduce((s, l) => s + l.volume, 0)
  const weiRatio = bidSum + askSum > 0 ? ((bidSum - askSum) / (bidSum + askSum)) * 100 : 0
  const color = trendColor(ob.changePercent)

  return (
    <div className="orderbook">
      <div className="ob-title">五档盘口</div>
      <div className="ob-sell">
        {[...ob.ask]
          .reverse()
          .map((lv, i) => (
            <div key={`a${i}`} className="ob-row">
              <span className="ob-label">卖{5 - i}</span>
              <span className="ob-price">{formatPrice(lv.price)}</span>
              <span className="ob-vol">{formatVolume(lv.volume)}</span>
            </div>
          ))}
      </div>
      <div className="ob-current">
        <div className="price" style={{ color }}>
          {formatPrice(ob.price)}
        </div>
        <div className="change" style={{ color }}>
          {formatSigned(ob.change)}　{formatPercent(ob.changePercent)}
        </div>
      </div>
      <div className="ob-buy">
        {ob.bid.map((lv, i) => (
          <div key={`b${i}`} className="ob-row">
            <span className="ob-label">买{i + 1}</span>
            <span className="ob-price">{formatPrice(lv.price)}</span>
            <span className="ob-vol">{formatVolume(lv.volume)}</span>
          </div>
        ))}
      </div>
      <div className="ob-info">
        <div className="kv">
          <span className="k">涨停</span>
          <span className="v up">{formatPrice(ob.limitUp)}</span>
        </div>
        <div className="kv">
          <span className="k">跌停</span>
          <span className="v down">{formatPrice(ob.limitDown)}</span>
        </div>
        <div className="kv">
          <span className="k">量比</span>
          <span className="v">{formatNum(ob.volumeRatio)}</span>
        </div>
        <div className="kv">
          <span className="k">振幅</span>
          <span className="v">{formatNum(ob.amplitude)}%</span>
        </div>
        <div className="kv">
          <span className="k">委比</span>
          <span className={`v ${trendClass(weiRatio)}`}>
            {weiRatio >= 0 ? '+' : ''}
            {weiRatio.toFixed(2)}%
          </span>
        </div>
        <div className="kv">
          <span className="k">换手率</span>
          <span className="v">{formatNum(ob.turnoverRate)}%</span>
        </div>
        <div className="kv">
          <span className="k">总市值</span>
          <span className="v">{formatMv(ob.totalMv)}</span>
        </div>
        <div className="kv">
          <span className="k">流通市值</span>
          <span className="v">{formatMv(ob.floatMv)}</span>
        </div>
      </div>
    </div>
  )
}
