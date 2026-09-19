import type { MinuteResult } from '../../shared/types'
import { getMinute as getMinuteEM } from './eastmoney'
import { getMinuteSina } from './minute-sina'
import { readLocalMinute, writeLocalMinute } from './minute-local'
import { getLocalPreClose } from './kline-local'
import { minuteCacheKey, readCache, writeCache } from './cache'
import { isIndexSecid } from '../../shared/market-session'

/**
 * 分时解析（本地优先 + 在线回退），与 ipc market:getMinute 同逻辑，AI 工具复用。
 */
export async function resolveMinute(secid: string, days = 1): Promise<MinuteResult | null> {
  const key = days > 1 ? `minute:${secid}:${days}d` : minuteCacheKey(secid)
  const cached = readCache<MinuteResult>(key, 60_000)
  if (cached && !cached.stale) return cached.value // 新鲜缓存
  // 多日分时：本地只存最近交易日，跳过本地直接新浪
  if (days > 1) {
    try {
      const sina = await getMinuteSina(secid, days)
      if (sina && sina.points.length) {
        writeCache(key, sina)
        return sina
      }
    } catch (err) {
      console.error('[minute] 新浪多日分时失败:', (err as Error).message)
    }
    if (cached) return { ...cached.value, stale: true }
    return null
  }
  // 指数分时：东财优先（secid 直传可靠），新浪次之（指数本地无 stock_minute）
  if (isIndexSecid(secid)) {
    try {
      const result = await getMinuteEM(secid)
      if (result.points.length) {
        writeCache(key, result)
        return result
      }
    } catch (err) {
      console.error('[minute] 指数东财失败:', (err as Error).message)
    }
    try {
      const sina = await getMinuteSina(secid, 1)
      if (sina && sina.points.length) {
        writeCache(key, sina)
        return sina
      }
    } catch (err) {
      console.error('[minute] 指数新浪失败:', (err as Error).message)
    }
    if (cached) return { ...cached.value, stale: true }
    return null
  }
  // 1. 优先本地持久化的分时（stock_minute 表，最新交易日）
  const local = readLocalMinute(secid)
  if (local && local.points.length) {
    const preClose = getLocalPreClose(secid) || 0
    return { secid, name: '', date: local.date, preClose, points: local.points }
  }
  // 2. 新浪分钟线拉取，并写入本地库
  try {
    const sina = await getMinuteSina(secid, 1)
    if (sina && sina.points.length) {
      if (sina.date) writeLocalMinute(secid, sina.date, sina.points)
      writeCache(key, sina)
      return sina
    }
  } catch (err) {
    console.error('[minute] 新浪分时失败:', (err as Error).message)
  }
  // 3. 回退东财
  try {
    const result = await getMinuteEM(secid)
    if (result.points.length) {
      writeCache(key, result)
      return result
    }
  } catch (err) {
    console.error('[minute] 东财失败:', (err as Error).message)
  }
  // 全部在线失败 → 回退过期缓存，显式标记 stale
  if (cached) return { ...cached.value, stale: true }
  return null
}
