import { fetchText } from './http'
import type { KlinePoint, KlineResult } from '../../shared/types'

/** 分钟K线数据源：新浪主源（scale=1/5/15/30/60），腾讯 mkline 备选；120 分钟由 60 分钟聚合 */

interface SinaKline {
  day: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  amount: string
}

/** secid "0.000858" -> "sz000858"；"1.600519" -> "sh600519" */
function symbolOf(secid: string): string {
  const parts = secid.split('.')
  const market = parts.length > 1 ? parts[0] : ''
  const code = parts[parts.length - 1]
  return (market === '1' ? 'sh' : 'sz') + code
}

/** "202608111500" -> "2026-08-11 15:00" */
function formatTencentTime(dt: string): string {
  if (dt.length >= 12) {
    return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)} ${dt.slice(8, 10)}:${dt.slice(10, 12)}`
  }
  return dt
}

/** 60 分钟条两两合并为 120 分钟（仅合并同日相邻两根；跨日/孤立条保持原样） */
function mergeTo120(bars: KlinePoint[]): KlinePoint[] {
  const out: KlinePoint[] = []
  for (let i = 0; i < bars.length; i++) {
    const a = bars[i]
    const b = bars[i + 1]
    if (b && a.time.slice(0, 10) === b.time.slice(0, 10)) {
      out.push({
        time: b.time,
        open: a.open,
        close: b.close,
        high: Math.max(a.high, b.high),
        low: Math.min(a.low, b.low),
        volume: a.volume + b.volume,
        amount: a.amount + b.amount
      })
      i++
    } else {
      out.push(a)
    }
  }
  return out
}

/** 新浪分钟K线（scale=1/5/15/30/60；120 由 60 聚合） */
export async function getMinuteKlineSina(secid: string, scale: number): Promise<KlineResult | null> {
  const symbol = symbolOf(secid)
  const effective = scale === 120 ? 60 : scale
  const url =
    `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData` +
    `?symbol=${symbol}&scale=${effective}&ma=no&datalen=800`
  const buf = await fetchText(url)
  const text = buf.toString('utf-8')
  const m = text.match(/var _data=\((.*)\)\s*;?/s)
  if (!m) return null
  let arr: SinaKline[]
  try {
    arr = JSON.parse(m[1])
  } catch {
    return null
  }
  if (!Array.isArray(arr) || !arr.length) return null
  let points: KlinePoint[] = arr.map((x) => ({
    time: x.day,
    open: Number(x.open),
    close: Number(x.close),
    high: Number(x.high),
    low: Number(x.low),
    volume: Math.round(Number(x.volume) / 100), // 股 -> 手
    amount: Number(x.amount)
  }))
  if (scale === 120) points = mergeTo120(points)
  return { secid, name: '', points }
}

/** 腾讯分钟K线备选（m1/m5/m15/m30/m60） */
export async function getMinuteKlineTencent(secid: string, scale: number): Promise<KlineResult | null> {
  const period = `m${scale === 120 ? 60 : scale}`
  const symbol = symbolOf(secid)
  const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},${period},,800`
  const buf = await fetchText(url)
  let j: { data?: Record<string, Record<string, unknown>> }
  try {
    j = JSON.parse(buf.toString('utf-8'))
  } catch {
    return null
  }
  const arr = (j?.data?.[symbol]?.[period] ?? []) as unknown as Array<unknown[]>
  if (!Array.isArray(arr) || !arr.length) return null
  let points: KlinePoint[] = arr
    .map((row) => {
      const [dt, open, close, high, low, volume] = row as [string, string, string, string, string, string]
      if (!dt || open === undefined) return null
      return {
        time: formatTencentTime(dt),
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volume: Number(volume) || 0,
        amount: 0
      }
    })
    .filter((p): p is KlinePoint => p !== null)
  if (scale === 120) points = mergeTo120(points)
  return { secid, name: '', points }
}

/** 分钟K线统一入口：新浪主源，失败/空回退腾讯 */
export async function getMinuteKline(secid: string, scale: number): Promise<KlineResult | null> {
  const sina = await getMinuteKlineSina(secid, scale)
  if (sina && sina.points.length) return sina
  return getMinuteKlineTencent(secid, scale)
}
