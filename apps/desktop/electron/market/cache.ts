import { getKlineCache, setKlineCache } from '../db'
import { KLT } from '../../shared/types'

const HOUR_MS = 3600 * 1000
const MINUTE_MS = 60 * 1000

/** 各周期缓存 TTL：日K 5 分钟；周/月/季 1 小时；分钟K线按柱周期（1分→1min … 120分→2h）；分时 1 分钟 */
export function ttlForKlt(klt: number): number {
  if (klt === KLT.DAY) return 5 * MINUTE_MS
  if (klt === KLT.WEEK || klt === KLT.MONTH || klt === KLT.QUARTER) return HOUR_MS
  if (
    klt === KLT.MIN1 ||
    klt === KLT.MIN5 ||
    klt === KLT.MIN15 ||
    klt === KLT.MIN30 ||
    klt === KLT.MIN60 ||
    klt === KLT.MIN120
  ) {
    return Math.min(klt, 120) * MINUTE_MS
  }
  return MINUTE_MS
}

export function klineCacheKey(secid: string, klt: number, fqt: number): string {
  return `kline:${secid}:${klt}:${fqt}`
}

export function minuteCacheKey(secid: string): string {
  return `minute:${secid}`
}

/** 缓存读取结果：stale=true 表示已过期（调用方可回退使用，但必须显式标记，不得伪装成实时） */
export interface CacheRead<T> {
  value: T
  stale: boolean
}

/** 读取缓存：存在则返回 {value, stale}（过期也返回并标记）；无缓存返回 null */
export function readCache<T>(key: string, ttl: number): CacheRead<T> | null {
  const cached = getKlineCache(key)
  if (!cached) return null
  const stale = Date.now() - cached.updatedAt > ttl
  return { value: cached.data as T, stale }
}

export function writeCache(key: string, data: unknown): void {
  setKlineCache(key, data)
}
