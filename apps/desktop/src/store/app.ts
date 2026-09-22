import { create } from 'zustand'
import type { MarketListParams, Quote, WatchItem } from '../../shared/types'
import { INDEX_SECIDS } from '../../shared/types'

export type View =
  | { type: 'watchlist' }
  | { type: 'market' }
  | { type: 'detail'; secid: string; name: string }
  | { type: 'backtest' }
  | { type: 'alerts' }
  | { type: 'selection' }
  | { type: 'ai' }
  | { type: 'pa' }
  | { type: 'settings' }

export interface MarketListState {
  total: number
  rows: Quote[]
  params: MarketListParams
  loading: boolean
  /** 本次列表拉取时间（快照提示用） */
  loadedAt: number | null
}

interface AppState {
  view: View
  watchlist: WatchItem[]
  /** 主进程订阅推送的所有快照（指数 + 当前视图个股） */
  quotes: Quote[]
  /** 从 quotes 中筛出的指数快照 */
  indexQuotes: Quote[]
  marketList: MarketListState
  /** 行情刷新间隔（毫秒） */
  refreshInterval: number
  /** 详情页跳转回测的目标股票 */
  backtestTarget: { secid: string; name: string } | null

  setView(view: View): void
  setBacktestTarget(target: { secid: string; name: string } | null): void
  loadBacktestTarget(): Promise<void>
  loadWatchlist(): Promise<void>
  toggleWatchlist(item: WatchItem): Promise<boolean>
  setQuotes(quotes: Quote[]): void
  loadMarketList(params?: Partial<MarketListParams>): Promise<void>
  setRefreshInterval(ms: number): void
}

const DEFAULT_LIST_PARAMS: MarketListParams = {
  pn: 1,
  pz: 100,
  fid: 'f3',
  order: 'desc',
  category: 'a_share'
}

export const useApp = create<AppState>((set, get) => ({
  view: { type: 'watchlist' },
  watchlist: [],
  quotes: [],
  indexQuotes: [],
  marketList: { total: 0, rows: [], params: DEFAULT_LIST_PARAMS, loading: false, loadedAt: null },
  refreshInterval: 3000,
  backtestTarget: null,

  setView: (view) => set({ view }),

  setBacktestTarget: (target) => {
    set({ backtestTarget: target })
    void window.api.settings.set('backtest.target', JSON.stringify(target)).catch(() => {})
  },

  loadBacktestTarget: async () => {
    // 从详情页刚带来的选择优先，不能被一个较早的异步读取覆盖。
    if (get().backtestTarget) return
    try {
      const raw = await window.api.settings.get('backtest.target')
      if (!raw) return
      const value: unknown = JSON.parse(raw)
      if (
        value &&
        typeof value === 'object' &&
        'secid' in value &&
        'name' in value &&
        typeof value.secid === 'string' &&
        typeof value.name === 'string'
      ) {
        set({ backtestTarget: { secid: value.secid, name: value.name } })
      }
    } catch {
      // 无效的旧设置不影响回测页正常打开。
    }
  },

  loadWatchlist: async () => {
    try {
      const list = await window.api.watchlist.list()
      set({ watchlist: list })
    } catch (err) {
      console.error('[store] loadWatchlist', err)
    }
  },

  toggleWatchlist: async (item) => {
    const cur = get().watchlist
    const exists = cur.some((w) => w.secid === item.secid)
    try {
      if (exists) {
        await window.api.watchlist.remove(item.secid)
        set({ watchlist: cur.filter((w) => w.secid !== item.secid) })
      } else {
        await window.api.watchlist.add(item)
        set({ watchlist: [...cur, item] })
      }
      return !exists
    } catch (err) {
      console.error('[store] toggleWatchlist', err)
      return false
    }
  },

  setQuotes: (quotes) => {
    const idxSecids = new Set(INDEX_SECIDS)
    set({
      quotes,
      indexQuotes: quotes.filter((q) => idxSecids.has(q.secid))
    })
  },

  loadMarketList: async (patch) => {
    const current = get().marketList.params
    const params: MarketListParams = { ...current, ...patch }
    set({ marketList: { ...get().marketList, params, loading: true } })
    try {
      const result = await window.api.market.getMarketList(params)
      set({
        marketList: {
          total: result.total,
          rows: result.list,
          params,
          loading: false,
          loadedAt: Date.now()
        }
      })
    } catch (err) {
      console.error('[store] loadMarketList', err)
      set({ marketList: { ...get().marketList, loading: false } })
    }
  },

  setRefreshInterval: (ms) => {
    set({ refreshInterval: ms })
    void window.api.settings.set('refreshInterval', String(ms)).catch(() => {})
  }
}))
