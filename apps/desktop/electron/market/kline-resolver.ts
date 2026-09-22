import type { KlineResult } from '../../shared/types'
import { getKline as getKlineEM } from './eastmoney'
import { MINUTE_KLTS } from './kline-local'
import { getMinuteKline } from './minute-kline'
import { writeLocalMinuteKline, readLocalMinuteKline } from './minute-kline-local'
import { getLocalKlineAsync } from './sqlite-worker-client'
import { klineCacheKey, readCache, writeCache, ttlForKlt } from './cache'
import { isIndexSecid } from '../../shared/market-session'

/**
 * 日/周/月/季/分钟 K 线解析（本地优先 + 在线回退）：
 * 1. 本地行情库（worker，日/周/月/季）→ 2. 新鲜缓存 → 3. 在线拉取落缓存 → 4. 过期缓存(stale)。
 * 与 ipc market:getKline 同逻辑，AI 工具复用同一数据链。
 * 指数（1.000xxx/0.399xxx）：在线优先（完整 OHLC 蜡烛），本地 index_daily close 线作离线回退。
 */
export async function resolveKline(
  secid: string,
  klt: number,
  fqt: number
): Promise<KlineResult | null> {
  // 指数日/周/月/季：在线优先（蜡烛），本地 index_daily close 线回退
  if (isIndexSecid(secid) && !MINUTE_KLTS.has(klt)) {
    const key = klineCacheKey(secid, klt, fqt)
    const cached = readCache<KlineResult>(key, ttlForKlt(klt))
    if (cached && !cached.stale) return cached.value
    try {
      const r = await getKlineEM(secid, klt, fqt)
      if (r.points.length) {
        writeCache(key, r)
        return r
      }
    } catch (err) {
      console.error('[kline] 指数东财在线失败:', (err as Error).message)
    }
    const local = await getLocalKlineAsync(secid, klt)
    if (local) return { ...local, stale: true } // 本地 close 线，显式标记延迟
    if (cached) return { ...cached.value, stale: true }
    return null
  }

  // 本地行情库：日/周/月/季（worker 线程执行；分钟级返回 null）
  const local = await getLocalKlineAsync(secid, klt)
  if (local) return local
  const key = klineCacheKey(secid, klt, fqt)
  const cached = readCache<KlineResult>(key, ttlForKlt(klt))
  if (cached && !cached.stale) return cached.value // 新鲜缓存
  // 分钟K线（1/5/15/30/60/120）：新浪主源 + 腾讯备选，成功落库，失败回退 stale 缓存/本地
  if (MINUTE_KLTS.has(klt)) {
    // 已持久化的分钟 K 线（包括导入的 ETF 数据）优先展示，不为已有本地数据发起网络请求。
    const localM = readLocalMinuteKline(secid, klt)
    if (localM && localM.length) return { secid, name: '', points: localM }
    try {
      const r = await getMinuteKline(secid, klt)
      if (r && r.points.length) {
        writeCache(key, r)
        writeLocalMinuteKline(secid, klt, r.points)
        return r
      }
    } catch (err) {
      console.error('[minute-kline] 在线拉取失败:', (err as Error).message)
    }
    if (cached) return { ...cached.value, stale: true } // 在线失败 → 过期缓存，显式标记
    return null
  }
  // 在线东财（日/周/月/季在线回退）
  try {
    const result = await getKlineEM(secid, klt, fqt)
    if (result.points.length) {
      writeCache(key, result)
      return result
    }
  } catch (err) {
    console.error('[kline] 东财在线失败:', (err as Error).message)
  }
  if (cached) return { ...cached.value, stale: true }
  return null
}
