import { useApp } from '../store/app'

const OPTIONS = [
  { label: '1秒', value: 1000 },
  { label: '3秒', value: 3000 },
  { label: '5秒', value: 5000 }
]

export default function RefreshControl() {
  const interval = useApp((s) => s.refreshInterval)
  const setRefreshInterval = useApp((s) => s.setRefreshInterval)

  return (
    <div className="refresh-control">
      <span className="refresh-label">刷新</span>
      <select
        className="refresh-select"
        value={interval}
        onChange={(e) => setRefreshInterval(Number(e.target.value))}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
