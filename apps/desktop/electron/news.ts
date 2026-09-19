import { ipcMain } from 'electron'
import type { NewsAnalysis, StockNewsItem } from '../shared/types'
import { loadAiConfig } from './ai/provider'
import { callPredictApi } from './monitor/predict'

const CACHE = new Map<string, { at: number; items: StockNewsItem[] }>()
const CACHE_MS = 5 * 60_000

function clean(value: unknown): string {
  return String(value ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;|\s+/g, ' ').trim()
}

async function fetchNewsPage(code: string, name: string, page: number, limit: number): Promise<{ total: number; items: StockNewsItem[] }> {
  const keyword = `${name} ${code}`.trim()
  const param = {
    uid: '', keyword, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: page, pageSize: Math.min(100, Math.max(1, limit)), preTag: '', postTag: '' } }
  }
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=LocalStockNews&param=${encodeURIComponent(JSON.stringify(param))}`
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Referer: 'https://so.eastmoney.com/' } })
  if (!response.ok) throw new Error(`新闻源返回 ${response.status}`)
  const text = await response.text()
  const jsonText = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
  const parsed = JSON.parse(jsonText) as { hitsTotal?: number; result?: { cmsArticleWebOld?: Array<Record<string, unknown>> } }
  const items = (parsed.result?.cmsArticleWebOld ?? []).map((item) => ({
    id: String(item.code ?? item.url ?? ''),
    title: clean(item.title),
    content: clean(item.content),
    publishedAt: String(item.date ?? ''),
    source: clean(item.mediaName) || '东方财富聚合',
    url: String(item.url ?? '')
  })).filter((item) => item.title && item.publishedAt).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return { total: Number(parsed.hitsTotal) || items.length, items }
}

async function fetchNews(code: string, name: string, limit: number): Promise<StockNewsItem[]> {
  return (await fetchNewsPage(code, name, 1, limit)).items
}

async function fetchNewsRange(code: string, name: string, start: string, end: string): Promise<StockNewsItem[]> {
  const first = await fetchNewsPage(code, name, 1, 100)
  // 该新闻搜索源实际只开放前10页；更早日期由公司公告源补足。
  const maxPage = Math.max(1, Math.min(10, Math.ceil(first.total / 100)))
  let lo = 1
  let hi = maxPage
  let targetPage = 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const page = mid === 1 ? first : await fetchNewsPage(code, name, mid, 100)
    const oldest = page.items.at(-1)?.publishedAt.slice(0, 10) || ''
    if (!oldest || oldest <= end) { targetPage = mid; hi = mid - 1 } else lo = mid + 1
  }
  const collected: StockNewsItem[] = []
  for (let pageNo = targetPage; pageNo <= maxPage && pageNo < targetPage + 8; pageNo += 1) {
    const page = pageNo === 1 ? first : await fetchNewsPage(code, name, pageNo, 100)
    collected.push(...page.items.filter((item) => item.publishedAt.slice(0, 10) >= start && item.publishedAt.slice(0, 10) <= end))
    const oldest = page.items.at(-1)?.publishedAt.slice(0, 10)
    if (!oldest || oldest < start) break
  }
  const announcements = await fetchAnnouncements(code, start, end)
  return [...new Map([...collected, ...announcements].map((item) => [item.id || item.url, item])).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

async function fetchAnnouncements(code: string, start: string, end: string): Promise<StockNewsItem[]> {
  const result: StockNewsItem[] = []
  for (let page = 1; page <= 12; page += 1) {
    const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=100&page_index=${page}&ann_type=A&client_source=web&stock_list=${encodeURIComponent(code)}&f_node=0&s_node=0`
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!response.ok) break
    const json = await response.json() as { data?: { list?: Array<Record<string, unknown>> } }
    const rows = json.data?.list ?? []
    for (const row of rows) {
      const date = String(row.notice_date ?? row.display_time ?? '').slice(0, 10)
      if (date < start || date > end) continue
      const id = String(row.art_code ?? '')
      const title = clean(row.title_ch ?? row.title)
      const columns = Array.isArray(row.columns) ? row.columns as Array<Record<string, unknown>> : []
      const category = clean(columns[0]?.column_name) || '公司公告'
      result.push({ id, title, content: `公司公告（${category}）：${title}`, publishedAt: `${date} 00:00:00`, source: `公司公告·${category}`, url: `https://data.eastmoney.com/notices/detail/${code}/${id}.html` })
    }
    const oldest = String(rows.at(-1)?.notice_date ?? '').slice(0, 10)
    if (!rows.length || (oldest && oldest < start)) break
  }
  return result
}

const NEWS_SYSTEM = `你是 LocalStock 的A股新闻研究助手。根据给定股票、时间范围和新闻原文，输出严格JSON：
{"summary":"综合总结","timeline":[{"date":"YYYY-MM-DD","event":"事件","impact":"可能影响"}],"risks":["风险或不确定性"]}。
要求：只使用所给新闻，不编造；合并重复报道；区分事实与推测；按日期升序；中文简洁；不构成投资建议。`

export function registerNewsIpc(): void {
  ipcMain.handle('news:list', async (_e, secid: string, name: string, limit = 100) => {
    const code = secid.split('.').pop() || secid
    const key = `${code}|${name}|${limit}`
    const cached = CACHE.get(key)
    if (cached && Date.now() - cached.at < CACHE_MS) return { items: cached.items, cached: true }
    const items = await fetchNews(code, name, limit)
    CACHE.set(key, { at: Date.now(), items })
    return { items, cached: false }
  })
  ipcMain.handle('news:range', async (_e, secid: string, name: string, start: string, end: string) => {
    const code = secid.split('.').pop() || secid
    const key = `range|${code}|${name}|${start}|${end}`
    const cached = CACHE.get(key)
    if (cached) return { items: cached.items, cached: true }
    const items = await fetchNewsRange(code, name, start, end)
    CACHE.set(key, { at: Date.now(), items })
    return { items, cached: false }
  })
  ipcMain.handle('news:analyze', async (_e, secid: string, name: string, start: string, end: string, items: StockNewsItem[]) => {
    try {
      if (!items?.length) return { ok: false, error: '所选时间范围内没有新闻' }
      const cfg = loadAiConfig()
      if (cfg.provider === 'anthropic' && !cfg.apiKey) return { ok: false, error: '尚未配置 AI API Key' }
      const compact = items.slice(0, 60).map((item) => ({ date: item.publishedAt, title: item.title, source: item.source, content: item.content.slice(0, 500) }))
      const raw = await callPredictApi(cfg, NEWS_SYSTEM, JSON.stringify({ stock: { secid, name }, range: { start, end }, news: compact }), 0.15) as Partial<NewsAnalysis>
      return {
        ok: true,
        analysis: {
          summary: typeof raw.summary === 'string' ? raw.summary : 'AI未返回综合总结',
          timeline: Array.isArray(raw.timeline) ? raw.timeline.slice(0, 40) : [],
          risks: Array.isArray(raw.risks) ? raw.risks.filter((v): v is string => typeof v === 'string').slice(0, 12) : []
        } satisfies NewsAnalysis
      }
    } catch (error) {
      return { ok: false, error: `AI新闻梳理失败：${error instanceof Error ? error.message : String(error)}` }
    }
  })
}
