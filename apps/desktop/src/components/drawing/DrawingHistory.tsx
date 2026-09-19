import { useDrawings } from '../../store/drawings'

interface Props {
  onClose: () => void
}

export default function DrawingHistory({ onClose }: Props) {
  const history = useDrawings((s) => s.history)
  const restoreVersion = useDrawings((s) => s.restoreVersion)

  return (
    <div className="drawing-panel">
      <div className="chart-head">
        <span className="table-title">画线历史（{history.length} 个版本）</span>
        <button className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
      {history.length === 0 ? (
        <div className="empty">暂无历史，每次画线会自动保存一个版本</div>
      ) : (
        <div className="drawing-history">
          {history.map((h) => (
            <div
              key={h.version}
              className="history-item"
              onClick={() => void restoreVersion(h.version)}
              title="点击恢复该版本画线"
            >
              <span className="history-version">v{h.version}</span>
              <span className="history-count">{h.data.length} 条线</span>
              <span className="history-time">
                {new Date(h.created_at).toLocaleString('zh-CN', { hour12: false })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
