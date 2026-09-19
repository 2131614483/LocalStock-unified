import { useEffect } from 'react'
import type { FloatViewId } from '../shared/types'
import { INDEX_SECIDS } from '../shared/types'
import { useApp } from './store/app'
import { useAi } from './store/ai'
import WatchlistView from './views/WatchlistView'
import MarketView from './views/MarketView'
import StockDetail from './components/StockDetail'
import BacktestPage from './components/backtest/BacktestPage'
import AlertsPage from './components/AlertsPage'
import SelectionPage from './components/selection/SelectionPage'
import AiPage from './components/ai/AiPage'
import SettingsPage from './components/settings/SettingsPage'
import TitleBarControls from './components/TitleBarControls'

/** 浮窗渲染器：按 URL 参数渲染单个视图（独立系统窗口，可自由缩放/拖拽/隐藏） */

const VIEW_TITLES: Record<string, string> = {
  watchlist: '自选股',
  market: '沪深A股',
  backtest: '回测',
  alerts: '预警',
  selection: '选股',
  ai: 'AI 助手',
  monitor: '实时监盘',
  settings: '设置',
  detail: '个股详情'
}

function viewTitle(v: string): string {
  return VIEW_TITLES[v] ?? v
}

export default function FloatApp() {
  const q = new URLSearchParams(window.location.search)
  const view = (q.get('view') as FloatViewId) || 'watchlist'
  const secid = q.get('secid') || ''
  const name = q.get('name') || ''

  useEffect(() => {
    void useApp.getState().loadWatchlist()
    useAi.getState().init()
    const off = window.api.market.onQuotes(useApp.getState().setQuotes)
    return off
  }, [])

  useEffect(() => {
    const st = useApp.getState()
    const secids = [...INDEX_SECIDS]
    if (view === 'watchlist') secids.push(...st.watchlist.map((w) => w.secid))
    else if (view === 'detail' && secid) secids.push(secid)
    void window.api.market.subscribe(secids, st.refreshInterval)
  }, [view, secid, useApp((s) => s.watchlist.length)])

  // 市场视图挂载即拉取列表
  useEffect(() => {
    if (view === 'market') void useApp.getState().loadMarketList()
  }, [view])

  return (
    <div className="float-app">
      <div className="float-titlebar">
        <span className="float-titlebar-title">{name || viewTitle(view)}</span>
        <TitleBarControls />
      </div>
      {view === 'watchlist' && <WatchlistView />}
      {view === 'market' && <MarketView />}
      {view === 'backtest' && <BacktestPage />}
      {view === 'alerts' && <AlertsPage />}
      {view === 'selection' && <SelectionPage />}
      {view === 'ai' && <AiPage />}
      {view === 'settings' && <SettingsPage />}
      {view === 'detail' && <StockDetail key={secid} secid={secid} name={name} />}
    </div>
  )
}
