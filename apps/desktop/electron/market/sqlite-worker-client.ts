import { Worker } from 'worker_threads'
import { join } from 'path'
import type { KlineResult, MarketListParams, MarketListResult, Quote, SelectionFilter } from '../../shared/types'
import type { ScanCandidate } from '../selection/scanner'
import { stockDataPath } from '../backtest'

/**
 * 行情库只读查询的 Worker 客户端（主进程侧）。
 * 把 getLocalKline / getLocalMarketList / getLocalPreClose 的同步查询
 * 委托给 sqlite-worker 线程执行，主进程不再被 3GB 库的同步查询阻塞。
 */

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (result: unknown) => void>()

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(join(__dirname, 'sqlite-worker.js'))
    // 主进程解析行情库路径传给 worker（worker 内不访问 electron app）
    worker.postMessage({ id: 0, type: 'init', args: [stockDataPath()] })
    worker.on('message', (msg: { id: number; result: unknown }) => {
      const cb = pending.get(msg.id)
      if (cb) {
        pending.delete(msg.id)
        cb(msg.result)
      }
    })
    const flush = (): void => {
      for (const cb of pending.values()) cb(null)
      pending.clear()
      worker = null
    }
    worker.on('error', (e) => {
      console.error('[sqlite-worker] error:', e)
      flush()
    })
    worker.on('exit', (code) => {
      console.error('[sqlite-worker] exit code =', code)
      flush()
    })
  } catch (e) {
    console.error('[sqlite-worker] 启动失败，回退主进程直接查询:', e)
    return null
  }
  return worker
}

function call<T>(type: string, ...args: unknown[]): Promise<T | null> {
  const w = getWorker()
  if (!w) return Promise.resolve(null)
  const id = nextId++
  return new Promise<T | null>((resolve) => {
    pending.set(id, resolve as (result: unknown) => void)
    w.postMessage({ id, type, args })
  })
}

/**
 * 丢弃当前 worker（切换行情库后调用）。
 * 下次查询会重新起一个，并以新路径 init —— 否则 worker 会一直用旧库。
 */
export function resetMarketDbWorker(): void {
  const w = worker
  worker = null
  // 未完成的请求直接判为无结果，调用方会回退到在线数据源
  for (const cb of pending.values()) cb(null)
  pending.clear()
  if (!w) return
  w.removeAllListeners()
  void w.terminate().catch(() => {
    // 已退出等情况忽略
  })
}

export function getLocalKlineAsync(secid: string, klt: number): Promise<KlineResult | null> {
  return call<KlineResult>('getKline', secid, klt)
}

export function getLocalMarketListAsync(params: MarketListParams): Promise<MarketListResult | null> {
  return call<MarketListResult>('getMarketList', params)
}

export function getLocalQuotesAsync(secids: string[]): Promise<Quote[] | null> {
  return call<Quote[]>('getQuotes', secids)
}

/** 全市场技术面选股扫描（worker 执行） */
export function runSelectionAsync(
  filters: SelectionFilter[]
): Promise<ScanCandidate[] | null> {
  return call<ScanCandidate[]>('runSelection', filters)
}

/** 全市场最新日线快照候选（worker 执行，供无技术条件的选股） */
export function scanAllMarketAsync(): Promise<ScanCandidate[] | null> {
  return call<ScanCandidate[]>('scanAllMarket')
}
