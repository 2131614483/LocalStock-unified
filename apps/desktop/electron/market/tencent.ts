import iconv from 'iconv-lite'
import { fetchText } from './http'
import type { OrderBook, OrderLevel, Quote } from '../../shared/types'

/** secid -> 腾讯代码。北交所和深市在应用内都使用 market=0，需按代码前缀区分。 */
export function secidToTencent(secid: string): string {
  const [market, code] = secid.split('.')
  const prefix = /^(?:4|8|920)/.test(code) ? 'bj' : market === '1' ? 'sh' : 'sz'
  return `${prefix}${code}`
}

function secidFromQcode(qcode: string): string {
  const m = qcode.match(/^(sh|sz|bj)(\d+)$/)
  if (!m) return qcode
  const prefix = m[1] === 'sh' ? '1' : '0'
  return `${prefix}.${m[2]}`
}

export function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '' || v === '0.0000') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 腾讯行情 qt.gtimg.cn，GBK 文本，~ 分隔。
 * 索引：1名称 2代码 3现价 4昨收 5今开 6成交量(手) 9-18买一~买五(价,量)
 * 19-28卖一~卖五(价,量) 30时间 31涨跌额 32涨跌幅 33最高 34最低
 * 35"价/量/额" 37成交额(万) 38换手 39市盈 43振幅 44流通市值(亿) 45总市值(亿)
 * 46市净率 47涨停 48跌停 49量比
 */
export function parseCommon(p: string[]): Omit<OrderBook, 'bid' | 'ask'> {
  const amountParts = (p[35] ?? '').split('/')
  const amountYuan = amountParts.length >= 3 ? num(amountParts[2]) : num(p[37])! * 1e4

  return {
    secid: '',
    name: p[1] ?? '',
    price: num(p[3]) ?? 0,
    change: num(p[31]) ?? 0,
    changePercent: num(p[32]) ?? 0,
    open: num(p[5]) ?? 0,
    high: num(p[33]) ?? 0,
    low: num(p[34]) ?? 0,
    preClose: num(p[4]) ?? 0,
    volume: num(p[6]) ?? 0,
    amount: amountYuan ?? 0,
    turnoverRate: num(p[38]),
    pe: num(p[39]),
    pb: num(p[46]),
    amplitude: num(p[43]),
    volumeRatio: num(p[49]),
    totalMv: num(p[45]) !== undefined ? num(p[45])! * 1e8 : undefined,
    floatMv: num(p[44]) !== undefined ? num(p[44])! * 1e8 : undefined,
    limitUp: num(p[47]),
    limitDown: num(p[48]),
    time: p[30] ?? ''
  }
}

/** 五档盘口（单只） */
export async function getOrderBook(secid: string): Promise<OrderBook | null> {
  const q = secidToTencent(secid)
  const buf = await fetchText(`https://qt.gtimg.cn/q=${q}`)
  const text = iconv.decode(buf, 'gbk')
  const lineMatch = text.match(/v_\w+="(.*)"/)
  if (!lineMatch) return null
  const p = lineMatch[1].split('~')
  if (p.length < 50) return null

  const level = (base: number): OrderLevel[] =>
    Array.from({ length: 5 }, (_, i) => ({
      price: num(p[base + i * 2]) ?? 0,
      volume: num(p[base + i * 2 + 1]) ?? 0
    }))

  return {
    ...parseCommon(p),
    secid,
    bid: level(9),
    ask: level(19)
  }
}

const BATCH_SIZE = 50

/** 多股快照（腾讯批量，作为东财快照的备用源） */
export async function getQuotesT(secids: string[]): Promise<Quote[]> {
  const quotes: Quote[] = []
  for (let i = 0; i < secids.length; i += BATCH_SIZE) {
    const batch = secids.slice(i, i + BATCH_SIZE)
    const buf = await fetchText(
      `https://qt.gtimg.cn/q=${batch.map(secidToTencent).join(',')}`
    )
    const text = iconv.decode(buf, 'gbk')
    for (const line of text.split('\n')) {
      const m = line.match(/v_(\w+)="(.*)"/)
      if (!m) continue
      const p = m[2].split('~')
      if (p.length < 10) continue
      const common = parseCommon(p)
      const isIndex = /^(上证|深证|创业板|沪深300|科创|中证)/.test(common.name)
      quotes.push({
        ...common,
        secid: secidFromQcode(m[1]),
        code: p[2] ?? '',
        isIndex
      })
    }
  }
  return quotes
}
