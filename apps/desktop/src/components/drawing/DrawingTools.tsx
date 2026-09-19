import { useDrawings } from '../../store/drawings'
import { DRAWING_COLORS, DRAWING_TYPES } from '../../lib/drawing'

interface Props {
  scope: string
  onOpenAlgo: () => void
  onOpenHistory: () => void
  onOpenManage: () => void
}

export default function DrawingTools({ scope, onOpenAlgo, onOpenHistory, onOpenManage }: Props) {
  const tool = useDrawings((s) => s.tool)
  const color = useDrawings((s) => s.color)
  const drawings = useDrawings((s) => s.drawings)
  const setTool = useDrawings((s) => s.setTool)
  const setColor = useDrawings((s) => s.setColor)
  const removeDrawing = useDrawings((s) => s.removeDrawing)
  const clearAll = useDrawings((s) => s.clearAll)
  const save = useDrawings((s) => s.save)

  // 未删除（含隐藏）的画线，用于 删除/清空 按钮状态与删除最后一条
  const active = drawings.filter((d) => !d.deleted && (d.scope ?? 'kline:day') === scope)

  const toggleTool = (t: (typeof DRAWING_TYPES)[number]['type']): void => {
    setTool(tool === t ? null : t)
  }
  const handleRemoveLast = (): void => {
    const last = active[active.length - 1]
    if (last) {
      removeDrawing(last.id)
      void save()
    }
  }
  const handleClearAll = (): void => {
    clearAll(scope)
    void save()
  }

  return (
    <div className="drawing-tools">
      <span className="drawing-tools-label">画线</span>
      {DRAWING_TYPES.map(({ type, label }) => (
        <button
          key={type}
          className={`btn ${tool === type ? 'active' : ''}`}
          onClick={() => toggleTool(type)}
          title={tool === type ? `已选择：${label}（在图上拖拽画线）` : label}
        >
          {label}
        </button>
      ))}
      <div className="drawing-colors">
        {DRAWING_COLORS.map((c) => (
          <span
            key={c}
            className={`drawing-color ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            title="画线颜色"
          />
        ))}
      </div>
      <span className="drawing-tools-spacer" />
      <button className="btn" onClick={onOpenAlgo}>
        算法画线
      </button>
      <button className="btn" onClick={onOpenHistory}>
        历史
      </button>
      <button className="btn" onClick={onOpenManage}>
        管理
      </button>
      {active.length > 0 && (
        <>
          <button className="btn" onClick={handleRemoveLast}>
            删除
          </button>
          <button className="btn" onClick={handleClearAll}>
            清空
          </button>
        </>
      )}
    </div>
  )
}
