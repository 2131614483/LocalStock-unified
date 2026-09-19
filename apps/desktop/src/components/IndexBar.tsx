import { useApp } from '../store/app'
import { formatPercent, formatPrice, trendClass } from '../lib/format'

interface Props {
  onSelectIndex: (secid: string, name: string) => void
}

export default function IndexBar({ onSelectIndex }: Props) {
  const indexQuotes = useApp((s) => s.indexQuotes)

  return (
    <div className="index-bar">
      {indexQuotes.map((q) => (
        <div key={q.secid} className="index-item" onClick={() => onSelectIndex(q.secid, q.name)}>
          <div className="index-name">{q.name}</div>
          <div className={`index-value ${trendClass(q.changePercent)}`}>
            {q.price ? formatPrice(q.price) : '--'}
          </div>
          <div className={`index-chg ${trendClass(q.changePercent)}`}>
            {formatPercent(q.changePercent)}
          </div>
        </div>
      ))}
    </div>
  )
}
