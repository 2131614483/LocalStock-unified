import type { Quote } from '../../shared/types'
import { getQuotes as getQuotesEM } from './eastmoney'
import { getQuotesT } from './tencent'
import { getLocalQuotesAsync } from './sqlite-worker-client'

// 东财实时快照（push2）限流较严，失败后冷却一段时间再尝试，期间用腾讯快照
let emDownUntil = 0
const EM_COOLDOWN_MS = 60_000

export async function getQuotesSafe(secids: string[]): Promise<Quote[]> {
  const requested = [...new Set(secids)]
  const found = new Map<string, Quote>()
  if (Date.now() >= emDownUntil) {
    try {
      const quotes = await getQuotesEM(secids)
      for (const quote of quotes) found.set(quote.secid, quote)
    } catch (err) {
      console.error('[quotes] 东财快照失败，60s 内改用腾讯:', (err as Error).message)
      emDownUntil = Date.now() + EM_COOLDOWN_MS
    }
  }
  // 东财可能只返回批次中的沪深股票而漏掉北交所，必须按缺失 secid 补查。
  let missing = requested.filter((secid) => !found.has(secid))
  if (missing.length) {
    try {
      const quotes = await getQuotesT(missing)
      for (const quote of quotes) found.set(quote.secid, quote)
    } catch (err) {
      console.error('[quotes] 腾讯快照失败，改用本地最新日线:', (err as Error).message)
    }
  }
  // 网络不可用或在线源不支持时仍展示本地最新行情，避免详情页永久“加载中”。
  missing = requested.filter((secid) => !found.has(secid))
  if (missing.length) {
    const local = await getLocalQuotesAsync(missing)
    for (const quote of local ?? []) found.set(quote.secid, quote)
  }
  return requested.map((secid) => found.get(secid)).filter((q): q is Quote => !!q)
}
