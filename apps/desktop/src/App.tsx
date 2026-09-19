import { Sparkles, MonitorPlay, PanelsTopLeft } from 'lucide-react'
import { useEffect } from 'react'
import type { SearchResult } from '../shared/types'
import { INDEX_SECIDS } from '../shared/types'
import { useApp } from './store/app'
import { useAi } from './store/ai'
import IndexBar from './components/IndexBar'
import SearchBox from './components/SearchBox'
import Sidebar from './components/Sidebar'
import StockDetail from './components/StockDetail'
import RefreshControl from './components/RefreshControl'
import BacktestPage from './components/backtest/BacktestPage'
import AlertsPage from './components/AlertsPage'
import SelectionPage from './components/selection/SelectionPage'
import AiPage from './components/ai/AiPage'
import AIPanel from './components/ai/AIPanel'
import SettingsPage from './components/settings/SettingsPage'
import WindowMenu from './components/WindowMenu'
import TitleBarControls from './components/TitleBarControls'
import SplitPane from './components/SplitPane'
import { useShortcuts } from './lib/shortcuts'
import WatchlistView from './views/WatchlistView'
import MarketView from './views/MarketView'
import PaView from './views/PaView'
import InputMemoryManager from './components/InputMemoryManager'

export default function App() {
  const view = useApp((s) => s.view)
  const watchlist = useApp((s) => s.watchlist)
  const refreshInterval = useApp((s) => s.refreshInterval)
  const setView = useApp((s) => s.setView)
  const loadWatchlist = useApp((s) => s.loadWatchlist)
  const loadMarketList = useApp((s) => s.loadMarketList)
  const aiPanelOpen = useAi((s) => s.panelOpen)
  const setAiPanelOpen = useAi((s) => s.setPanelOpen)
  useShortcuts()

  useEffect(() => {
    void loadWatchlist()
    // 初始化 AI 订阅
    useAi.getState().init()
  }, [loadWatchlist])

  // 启动时读取已保存的刷新频率
  useEffect(() => {
    void window.api.settings.get('refreshInterval').then((v) => {
      if (v) {
        const n = Number(v)
        if ([1000, 3000, 5000].includes(n)) useApp.getState().setRefreshInterval(n)
      }
    })
  }, [])

  // 订阅主进程行情推送
  useEffect(() => {
    const off = window.api.market.onQuotes(useApp.getState().setQuotes)
    return off
  }, [])

  // 视图/自选/刷新频率变化时更新订阅范围
  useEffect(() => {
    const st = useApp.getState()
    const secids = [...INDEX_SECIDS]
    if (st.view.type === 'watchlist') secids.push(...st.watchlist.map((w) => w.secid))
    else if (st.view.type === 'detail') secids.push(st.view.secid)
    void window.api.market.subscribe(secids, refreshInterval)
  }, [view, watchlist, refreshInterval])

  // 进入市场列表视图时拉取一次
  useEffect(() => {
    if (view.type === 'market') void loadMarketList()
  }, [view.type, loadMarketList])

  const handleSelect = (r: SearchResult): void => {
    setView({ type: 'detail', secid: r.secid, name: r.name })
  }
  const handleSelectIndex = (secid: string, name: string): void => {
    setView({ type: 'detail', secid, name })
  }

  return (
    <div className="app">
      <div className="toolbar">
        <div className="index-bar-wrap">
          <IndexBar onSelectIndex={handleSelectIndex} />
        </div>
        <RefreshControl />
        <SearchBox onSelect={handleSelect} />
        <button
          className={`ai-toggle ${aiPanelOpen ? 'active' : ''}`}
          onClick={() => setAiPanelOpen(!aiPanelOpen)}
          title="AI 助手"
        >
          <Sparkles size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          AI
        </button>
        <button
          className="ai-toggle"
          onClick={() => void window.api.monitor.openWindow()}
          title="打开实时监盘窗口（单例，可复用）"
        >
          <MonitorPlay size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          监盘
        </button>
        <WindowMenu />
        <TitleBarControls />
      </div>
      <div className="main">
        <SplitPane direction="vertical" initial={168} min={120} max={380} storageKey="split.sidebar">
          <Sidebar />
          <div className="content">
            {view.type === 'watchlist' && <WatchlistView />}
            {view.type === 'market' && <MarketView />}
            {view.type === 'backtest' && <BacktestPage />}
            {view.type === 'alerts' && <AlertsPage />}
            {view.type === 'selection' && <SelectionPage />}
            {view.type === 'ai' && <AiPage />}
            {view.type === 'pa' && <PaView />}
            {view.type === 'settings' && <SettingsPage />}
            {view.type === 'detail' && (
              <StockDetail key={view.secid} secid={view.secid} name={view.name} />
            )}
          </div>
        </SplitPane>
        {aiPanelOpen && <AIPanel />}
      </div>
      <InputMemoryManager />
    </div>
  )
}
