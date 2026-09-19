import { parentPort } from 'worker_threads'
import { getLocalKline, getLocalPreClose } from './kline-local'
import { getLocalMarketList, getLocalQuotes } from './market-list-local'
import { setDbPath } from './db-path'
import { scanTechnical, scanAllMarket } from '../selection/scanner'
import type { SelectionFilter } from '../../shared/types'
import type { KlineResult, MarketListParams, MarketListResult } from '../../shared/types'

/**
 * 行情库只读查询 Worker：在独立线程持有 better-sqlite3 连接，
 * 把耗时的同步查询（日/周/月/季 K 线、沪深列表、选股扫描）移出主进程，避免阻塞 IPC。
 * 协议：request {id, type, args} → response {id, result}（result 为 null 表示无数据/错误）。
 * 首条消息应为 {type:'init', args:[dbPath]}（主进程解析好路径，worker 不访问 electron app）。
 */
parentPort?.on('message', (msg: { id: number; type: string; args: unknown[] }) => {
  let result: unknown = null
  try {
    if (msg.type === 'init') {
      setDbPath(msg.args[0] as string)
      result = true
    } else if (msg.type === 'getKline') {
      result = getLocalKline(msg.args[0] as string, msg.args[1] as number)
    } else if (msg.type === 'getMarketList') {
      result = getLocalMarketList(msg.args[0] as MarketListParams)
    } else if (msg.type === 'getQuotes') {
      result = getLocalQuotes(msg.args[0] as string[])
    } else if (msg.type === 'getPreClose') {
      result = getLocalPreClose(msg.args[0] as string)
    } else if (msg.type === 'runSelection') {
      result = scanTechnical(msg.args[0] as SelectionFilter[])
    } else if (msg.type === 'scanAllMarket') {
      result = scanAllMarket()
    }
  } catch (e) {
    result = null
  }
  parentPort?.postMessage({ id: msg.id, result })
})
