import { fetchJson } from './http'
import type {
  KlinePoint,
  KlineResult,
  MarketListParams,
  MarketListResult,
  MinutePoint,
  MinuteResult,
  Quote,
  SearchResult
} from '../../shared/types'
import { INDEX_SECIDS } from '../../shared/types'

// 东财 ulist/clist 通用字段：f2现价 f3涨跌幅 f4涨跌额 f5成交量(手) f6成交额
// f7振幅 f8换手率 f9市盈率 f10量比 f12代码 f13市场 f14名称
// f15最高 f16最低 f17今开 f18昨收 f20总市值 f21流通市值 f23市净率 f100行业
const QUOTE_FIELDS =
  'f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100'

/** 沪深A股筛选参数 */
const A_SHARE_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'

function toNumber(v: unknown): number | undefined {
  if (v === '-' || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function mapQuote(raw: Record<string, unknown>, isIndex = false): Quote | null {  const code = String(raw.f12 ?? '')
  const name = String(raw.f14 ?? '')
  const market = String(raw.f13 ?? '')
  if (!code || !name) return null

  const price = toNumber(raw.f2)
  const preClose = toNumber(raw.f18)
  return {
    secid: `${market}.${code}`,
    code,
    name,
    price: price ?? 0,
    change: toNumber(raw.f4) ?? 0,
    changePercent: toNumber(raw.f3) ?? 0,
    open: toNumber(raw.f17) ?? 0,
    high: toNumber(raw.f15) ?? 0,
    low: toNumber(raw.f16) ?? 0,
    preClose: preClose ?? 0,
    volume: toNumber(raw.f5) ?? 0,
    amount: toNumber(raw.f6) ?? 0,
    amplitude: toNumber(raw.f7),
    turnoverRate: toNumber(raw.f8),
    pe: toNumber(raw.f9),
    pb: toNumber(raw.f23),
    volumeRatio: toNumber(raw.f10),
    totalMv: toNumber(raw.f20),
    floatMv: toNumber(raw.f21),
    industry: isIndex ? undefined : (String(raw.f100 ?? '') || undefined),
    isIndex
  }
}

/** 多股/指数快照 */
export async function getQuotes(secids: string[]): Promise<Quote[]> {
  if (!secids.length) return []
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=${secids.join(',')}&fields=${QUOTE_FIELDS}`
  const json = await fetchJson<{ data?: { diff?: Array<Record<string, unknown>> } }>(url)
  const diff = json?.data?.diff ?? []
  return diff
    .map((raw) => mapQuote(raw, raw.f100 === undefined || String(raw.f100) === '-'))
    .filter((q): q is Quote => q !== null)
}

/** 沪深A股列表（分页 + 排序） */
export async function getMarketList(params: MarketListParams): Promise<MarketListResult> {
  const { pn, pz, fid, order } = params
  const po = order === 'asc' ? 0 : 1
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=${pz}&po=${po}&np=1` +
    `&fltt=2&invt=2&fid=${fid}&fs=${A_SHARE_FS}&fields=${QUOTE_FIELDS}`
  const json = await fetchJson<{ data?: { total?: number; diff?: Array<Record<string, unknown>> } }>(url)
  const data = json?.data
  const list = (data?.diff ?? []).map((raw) => mapQuote(raw)).filter((q): q is Quote => q !== null)
  return { total: data?.total ?? 0, list }
}

/** 解析东财 K 线字符串数组（"时间,开,收,高,低,量,额"）为 KlinePoint */
export function parseKlines(klines: string[]): KlinePoint[] {
  return klines.map((line) => {
    const [time, open, close, high, low, volume, amount] = line.split(',')
    return {
      time,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount)
    }
  })
}

/** 解析东财分时字符串数组（"时间,价,均,高,低,量,额"）为 MinutePoint */
export function parseTrends(trends: string[]): MinutePoint[] {
  return trends.map((line) => {
    const [time, price, avg, high, low, volume, amount] = line.split(',')
    return {
      time: time.length >= 16 ? time.slice(11, 16) : time, // 保留 "09:30"
      price: Number(price),
      avg: Number(avg),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount)
    }
  })
}

/** K线 */
export async function getKline(secid: string, klt: number, fqt: number, lmt = 800): Promise<KlineResult> {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&klt=${klt}&fqt=${fqt}&beg=19900101&end=20500101&lmt=${lmt}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`
  const json = await fetchJson<{
    data?: { code?: string; name?: string; preKPrice?: number; klines?: string[] }
  }>(url)
  const data = json?.data
  return {
    secid,
    name: data?.name ?? '',
    preClose: data?.preKPrice,
    points: parseKlines(data?.klines ?? [])
  }
}

/** 当日分时 */
export async function getMinute(secid: string): Promise<MinuteResult> {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0`
  const json = await fetchJson<{
    data?: { name?: string; preClose?: number; trends?: string[] }
  }>(url)
  const data = json?.data
  return {
    secid,
    name: data?.name ?? '',
    preClose: Number(data?.preClose ?? 0),
    points: parseTrends(data?.trends ?? [])
  }
}

const SEARCH_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8'

/** 股票搜索：代码 / 名称 / 拼音 */
export async function searchStocks(keyword: string): Promise<SearchResult[]> {
  const k = keyword.trim()
  if (!k) return []
  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(k)}&type=14&token=${SEARCH_TOKEN}`
  const json = await fetchJson<{
    QuotationCodeTable?: { Data?: Array<Record<string, unknown>> }
  }>(url)
  const items = json?.QuotationCodeTable?.Data ?? []
  return items
    // 北交所搜索结果 Classify=NEEQ、SecurityTypeName=京A，也属于本软件股票范围。
    .filter((it) =>
      String(it.Classify ?? '') === 'AStock' || String(it.SecurityTypeName ?? '') === '京A'
    )
    .map((it) => ({
      code: String(it.Code ?? ''),
      name: String(it.Name ?? ''),
      pinyin: String(it.PinYin ?? ''),
      secid: String(it.QuoteID ?? ''),
      type: String(it.SecurityTypeName ?? '')
    }))
    .filter((s) => s.secid && s.name)
}
