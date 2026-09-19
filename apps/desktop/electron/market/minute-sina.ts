import { fetchText } from './http'
import type { MinutePoint, MinuteResult } from '../../shared/types'
import { getLocalPreClose } from './kline-local'

const UA_SINA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export interface SinaMinute {
  day: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  amount: string
}

/** 解析新浪 JSONP 响应（`var _data=(...)`），非法输入返回空数组 */
export function parseSinaJsonp(text: string): SinaMinute[] {
  const m = text.match(/var _data=\((.*)\)\s*;?/s)
  if (!m) return []
  try {
    const arr = JSON.parse(m[1])
    return Array.isArray(arr) ? (arr as SinaMinute[]) : []
  } catch {
    return []
  }
}

/** 按交易日分组构建分时点（纯函数，不访问本地库）。days>1 时点带 "MM-DD HH:MM" + 每日昨收 */
export function buildMinutePoints(
  data: SinaMinute[],
  days: number,
  firstPreClose: number
): { points: MinutePoint[]; lastPreClose: number; lastDay: string } {
  const groups = new Map<string, SinaMinute[]>()
  for (const m of data) {
    const day = m.day.slice(0, 10)
    const arr = groups.get(day)
    if (arr) arr.push(m)
    else groups.set(day, [m])
  }
  const dayList = [...groups.keys()].sort()
  const targetDays = dayList.slice(-days)
  const points: MinutePoint[] = []
  let lastPreClose = firstPreClose
  for (let di = 0; di < targetDays.length; di++) {    const day = targetDays[di]
    const rows = groups.get(day) ?? []
    const dayPreClose = di === 0 ? lastPreClose : Number(rowsPrevClose(day, groups))
    let cumAmount = 0
    let cumVol = 0
    for (const m of rows) {
      const price = parseFloat(m.close)
      const vol = parseFloat(m.volume)
      const amount = parseFloat(m.amount)
      if (!Number.isFinite(price) || !Number.isFinite(vol)) continue
      cumAmount += amount
      cumVol += vol
      points.push({
        time: days > 1 ? `${day.slice(5)} ${m.day.slice(11, 16)}` : m.day.slice(11, 16),
        price,
        avg: cumVol > 0 ? Number((cumAmount / cumVol).toFixed(3)) : price,
        high: parseFloat(m.high) || price,
        low: parseFloat(m.low) || price,
        volume: Math.round(vol / 100), // 股 -> 手
        amount,
        preClose: dayPreClose
      })
    }
    lastPreClose = Number(rows[rows.length - 1]?.close) || lastPreClose
  }
  return { points, lastPreClose, lastDay: targetDays[targetDays.length - 1] ?? '' }
}

/**
 * 新浪分钟线（CN_MarketDataService.getKLineData，scale=1 每分钟），
 * 返回最近约 4-5 个交易日的逐分钟数据（day, open/high/low/close, volume, amount）。
 * volume 单位股、amount 单位元，累计 amount/volume 即均价。
 */
async function fetchSinaMinute(symbol: string): Promise<SinaMinute[]> {
  const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=1&ma=no&datalen=1023`
  const buf = await fetchText(url)
  return parseSinaJsonp(buf.toString('utf-8'))
}

/** secid -> 新浪 symbol；北交所按代码前缀识别为 bj。 */
export function symbolOf(secid: string): string {
  const parts = secid.split('.')
  const market = parts.length > 1 ? parts[0] : ''
  const code = parts[parts.length - 1]
  const prefix = /^(?:4|8|920)/.test(code) ? 'bj' : market === '1' ? 'sh' : 'sz'
  return prefix + code
}

/** 从新浪分钟线提取分时数据（days=1 当日 / days=5 最近 5 个交易日）。
 *  多日时每个点 time 为 "MM-DD HH:MM"，并带当日昨收（首日昨收近似用本地最新昨收）。 */
export async function getMinuteSina(secid: string, days = 1): Promise<MinuteResult | null> {
  const data = await fetchSinaMinute(symbolOf(secid))
  if (!data.length) return null
  const { points, lastPreClose, lastDay } = buildMinutePoints(data, days, getLocalPreClose(secid))
  if (!points.length) return null
  return { secid, name: '', preClose: lastPreClose, date: lastDay, points }
}

/** 取指定日前一交易日（存在于 groups 中）的最后收盘价 */
function rowsPrevClose(day: string, groups: Map<string, SinaMinute[]>): number {
  const days = [...groups.keys()].sort()
  const idx = days.indexOf(day)
  if (idx <= 0) return 0
  const prev = groups.get(days[idx - 1])
  return Number(prev?.[prev.length - 1]?.close) || 0
}
