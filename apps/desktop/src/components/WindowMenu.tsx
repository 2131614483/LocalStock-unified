import { useEffect, useState } from 'react'
import { PanelsTopLeft } from 'lucide-react'
import type { FloatViewId } from '../../shared/types'
import { useApp } from '../store/app'

const LABELS: Array<{ view: FloatViewId; label: string }> = [
  { view: 'watchlist', label: '自选股' },
  { view: 'market', label: '沪深A股' },
  { view: 'backtest', label: '回测' },
  { view: 'alerts', label: '预警' },
  { view: 'selection', label: '选股' },
  { view: 'ai', label: 'AI 助手' },
  { view: 'monitor', label: '实时监盘' },
  { view: 'settings', label: '设置' }
]

/** 工具栏「窗口」菜单：每个视图可打开/隐藏/关闭独立系统窗口，自由拖拽缩放排布 */
export default function WindowMenu() {
  const [open, setOpen] = useState(false)
  const [states, setStates] = useState<Array<{ view: FloatViewId; visible: boolean }>>([])
  const view = useApp((s) => s.view)

  const refresh = (): void => {
    void window.api.float.getAll().then(setStates)
  }

  useEffect(() => {
    refresh()
    return window.api.float.onChanged(refresh)
  }, [])

  return (
    <span className="win-wrap">
      <button
        className={`ai-toggle ${open ? 'active' : ''}`}
        title="窗口管理：把视图拆成独立窗口，自由拖拽/缩放/显隐排布"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) refresh()
        }}
      >
        <PanelsTopLeft size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
        窗口
      </button>
      {open && (
        <div className="win-menu">
          <div className="win-menu-title">窗口管理 · 独立窗口可自由缩放/拖拽/显隐</div>
          {LABELS.map(({ view: v, label }) => {
            const st = states.find((s) => s.view === v)
            return (
              <div key={v} className="win-menu-item" onClick={() => void window.api.float.toggle(v)}>
                <span className={`win-menu-state ${st?.visible ? 'on' : ''}`}>
                  {st?.visible ? '●' : '○'}
                </span>
                <span className="win-menu-label">{label}</span>
                <span className="win-menu-action">{st?.visible ? '隐藏' : '打开'}</span>
              </div>
            )
          })}
          {view.type === 'detail' && (
            <div
              className="win-menu-item"
              onClick={() => {
                void window.api.float.open('detail', { secid: view.secid, name: view.name })
                setOpen(false)
              }}
            >
              <span className="win-menu-state">◇</span>
              <span className="win-menu-label">个股详情 · {view.name}</span>
              <span className="win-menu-action">浮窗</span>
            </div>
          )}
          <div className="win-menu-hint">OS 窗口：标题栏拖动排布，边缘拉伸缩放，关闭即隐藏</div>
        </div>
      )}
    </span>
  )
}
