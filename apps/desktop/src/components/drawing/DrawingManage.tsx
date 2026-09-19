import { useState } from 'react'
import type { Drawing } from '../../../shared/types'
import { useDrawings } from '../../store/drawings'
import { DRAWING_TYPES } from '../../lib/drawing'

interface Props {
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DRAWING_TYPES.map((t) => [t.type, t.label])
)

function drawingName(d: Drawing): string {
  const type = TYPE_LABEL[d.type] ?? d.type
  return d.label ? `${type}·${d.label}` : type
}

/** 画线管理：显示/隐藏勾选 + 删除进回收站 + 回收站恢复/彻底删除 */
export default function DrawingManage({ onClose }: Props) {
  const [view, setView] = useState<'list' | 'trash'>('list')
  const drawings = useDrawings((s) => s.drawings)
  const toggleVisible = useDrawings((s) => s.toggleVisible)
  const removeDrawing = useDrawings((s) => s.removeDrawing)
  const restoreFromTrash = useDrawings((s) => s.restoreFromTrash)
  const deletePermanently = useDrawings((s) => s.deletePermanently)
  const save = useDrawings((s) => s.save)

  const list = drawings.filter((d) => !d.deleted)
  const trash = drawings.filter((d) => d.deleted)

  const handleToggle = (id: string): void => {
    toggleVisible(id)
    void save()
  }
  const handleDelete = (id: string): void => {
    removeDrawing(id)
    void save()
  }
  const handleRestore = (id: string): void => {
    restoreFromTrash(id)
    void save()
  }
  const handlePurge = (id: string): void => {
    deletePermanently(id)
    void save()
  }

  return (
    <div className="drawing-panel">
      <div className="chart-head">
        <span className="table-title">画线管理</span>
        <div className="editor-head-right">
          <button
            className={`btn ${view === 'list' ? 'active' : ''}`}
            onClick={() => setView('list')}
          >
            画线列表
          </button>
          <button
            className={`btn ${view === 'trash' ? 'active' : ''}`}
            onClick={() => setView('trash')}
          >
            回收站{trash.length > 0 ? `(${trash.length})` : ''}
          </button>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {view === 'list' ? (
        list.length === 0 ? (
          <div className="empty">暂无画线，在图上选工具拖拽即可添加</div>
        ) : (
          <div className="drawing-history">
            {list.map((d) => (
              <div key={d.id} className="drawing-manage-item">
                <label className="drawing-manage-check" title="勾选=显示，取消=隐藏">
                  <input
                    type="checkbox"
                    checked={d.visible !== false}
                    onChange={() => handleToggle(d.id)}
                  />
                  <span className="drawing-manage-color" style={{ background: d.color }} />
                  <span className="drawing-manage-name">{drawingName(d)}</span>
                </label>
                <button className="btn" onClick={() => handleDelete(d.id)} title="删除（进回收站，可恢复）">
                  删除
                </button>
              </div>
            ))}
          </div>
        )
      ) : trash.length === 0 ? (
        <div className="empty">回收站为空</div>
      ) : (
        <div className="drawing-history">
          {trash.map((d) => (
            <div key={d.id} className="drawing-manage-item">
              <span className="drawing-manage-name">
                <span className="drawing-manage-color" style={{ background: d.color }} />
                {drawingName(d)}
              </span>
              <button className="btn" onClick={() => handleRestore(d.id)}>
                恢复
              </button>
              <button className="btn" onClick={() => handlePurge(d.id)} title="彻底删除，不可恢复">
                彻底删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
