import {
  Star,
  ListOrdered,
  FlaskConical,
  AlertTriangle,
  Filter,
  Sparkles,
  Settings,
  ArrowLeft,
  CircleDot,
  Landmark,
  Building2
  , Newspaper
  , Crosshair
} from 'lucide-react'
import { useApp } from '../store/app'
import type { MarketCategory } from '../../shared/types'

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
  const marketCategory = useApp((s) => s.marketList.params.category ?? 'a_share')
  const loadMarketList = useApp((s) => s.loadMarketList)
  const detailQuote = useApp((s) => {
    const current = s.view
    return current.type === 'detail'
      ? s.quotes.find((quote) => quote.secid === current.secid)
      : undefined
  })
  const detailCode = view.type === 'detail' ? (view.secid.split('.').pop() ?? view.secid) : ''
  const detailName = view.type === 'detail' ? (detailQuote?.name || view.name || detailCode) : ''
  const openMarket = (category: MarketCategory): void => {
    setView({ type: 'market' })
    void loadMarketList({ category, pn: 1 })
  }

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
        active={view.type === 'market' && marketCategory === 'a_share'}
        icon={<ListOrdered size={14} />}
        label="沪深A股"
        onClick={() => openMarket('a_share')}
      />
      <SideItem
        active={view.type === 'market' && marketCategory === 'fund'}
        icon={<Landmark size={14} />}
        label="基金 / ETF"
        onClick={() => openMarket('fund')}
      />
      <SideItem
        active={view.type === 'market' && marketCategory === 'index'}
        icon={<Building2 size={14} />}
        label="大盘指数"
        onClick={() => openMarket('index')}
      />
      <div className="sidebar-title">股票市场</div>
      <SideItem
        active={view.type === 'market' && marketCategory === 'shanghai'}
        icon={<ListOrdered size={14} />}
        label="沪市 A 股"
        onClick={() => openMarket('shanghai')}
      />
      <SideItem
        active={view.type === 'market' && marketCategory === 'shenzhen'}
        icon={<ListOrdered size={14} />}
        label="深市 A 股"
        onClick={() => openMarket('shenzhen')}
      />
      <SideItem
        active={view.type === 'market' && marketCategory === 'chinext'}
        icon={<ListOrdered size={14} />}
        label="创业板"
        onClick={() => openMarket('chinext')}
      />
      <SideItem
        active={view.type === 'market' && marketCategory === 'star'}
        icon={<ListOrdered size={14} />}
        label="科创板"
        onClick={() => openMarket('star')}
      />
      <SideItem
        active={view.type === 'market' && marketCategory === 'beijing'}
        icon={<ListOrdered size={14} />}
        label="北交所"
        onClick={() => openMarket('beijing')}
      />
      <SideItem
        active={view.type === 'market' && marketCategory === 'b_share'}
        icon={<ListOrdered size={14} />}
        label="沪深 B 股"
        onClick={() => openMarket('b_share')}
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
