import {
  Star,
  ListOrdered,
  FlaskConical,
  AlertTriangle,
  Filter,
  Sparkles,
  Settings,
  ArrowLeft,
  CircleDot
  , Newspaper
  , Crosshair
} from 'lucide-react'
import { useApp } from '../store/app'

/** 侧栏项：div 带 role=button + Enter/Space 触发（U2 键盘可达） */
function SideItem({
  active,
  icon,
  label,
  onClick
}: {
  active?: boolean
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <div
      className={`sidebar-item ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
    >
      <span className="icon">{icon}</span>
      <span>{label}</span>
    </div>
  )
}

export default function Sidebar() {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const detailQuote = useApp((s) => {
    const current = s.view
    return current.type === 'detail'
      ? s.quotes.find((quote) => quote.secid === current.secid)
      : undefined
  })
  const detailCode = view.type === 'detail' ? (view.secid.split('.').pop() ?? view.secid) : ''
  const detailName = view.type === 'detail' ? (detailQuote?.name || view.name || detailCode) : ''

  return (
    <div className="sidebar">
      <div className="sidebar-title">行情</div>
      <SideItem
        active={view.type === 'watchlist'}
        icon={<Star size={14} />}
        label="自选股"
        onClick={() => setView({ type: 'watchlist' })}
      />
      <SideItem
        active={view.type === 'market'}
        icon={<ListOrdered size={14} />}
        label="沪深A股"
        onClick={() => setView({ type: 'market' })}
      />
      <SideItem
        active={view.type === 'backtest'}
        icon={<FlaskConical size={14} />}
        label="回测"
        onClick={() => setView({ type: 'backtest' })}
      />
      <SideItem
        active={view.type === 'alerts'}
        icon={<AlertTriangle size={14} />}
        label="预警"
        onClick={() => setView({ type: 'alerts' })}
      />
      <SideItem
        active={view.type === 'selection'}
        icon={<Filter size={14} />}
        label="选股"
        onClick={() => setView({ type: 'selection' })}
      />
      <SideItem
        active={view.type === 'ai'}
        icon={<Sparkles size={14} />}
        label="AI"
        onClick={() => setView({ type: 'ai' })}
      />
      <SideItem
        active={view.type === 'pa'}
        icon={<Crosshair size={14} />}
        label="价格行为 AI"
        onClick={() => setView({ type: 'pa' })}
      />
      <SideItem
        active={view.type === 'settings'}
        icon={<Settings size={14} />}
        label="设置"
        onClick={() => setView({ type: 'settings' })}
      />
      {view.type === 'detail' && (
        <>
          <div className="sidebar-title">个股</div>
          <SideItem
            active
            icon={<CircleDot size={14} />}
            label={detailName === detailCode ? detailCode : `${detailName} ${detailCode}`}
          />
          <SideItem
            icon={<Newspaper size={14} />}
            label="新闻聚合"
            onClick={() => window.dispatchEvent(new CustomEvent('localstock:focus-news'))}
          />
          <SideItem
            icon={<ArrowLeft size={14} />}
            label="返回自选"
            onClick={() => setView({ type: 'watchlist' })}
          />
        </>
      )}
    </div>
  )
}
