import type { AiConfig, StockPrediction } from '../../shared/types'
import { loadAiConfig } from '../ai/provider'

/**
 * 监盘 AI 实时预测：单次结构化 JSON 调用（不走 agent 工具循环，省掉多轮往返以提速）。
 * 输入为主进程预计算的紧凑行情快照 + 上次预测对照（提升准确度），输出数组型预测。
 */

export interface PredictStockInput {
  secid: string
  code: string
  name: string
  /** 最新价 */
  price: number
  /** 当日涨跌幅 % */
  changePercent: number
  /** 日内最高/最低 */
  high: number
  low: number
  /** 最近价格序列（降采样，时间升序，如最近 10 个采样点） */
  series: Array<{ t: number; p: number }>
  /** 最近动量 %（如近 10 分钟） */
  momentumPct: number
  /** 上次预测价格（对照，空则无） */
  prevPrice?: number
  /** 上次预测摘要 */
  prevPrediction?: string
}

const SYSTEM_PROMPT = `你是 A 股实时监盘分析助手。基于用户给出的实时行情快照做超短期(接下来15-60分钟)走势判断。
要求：
1. 只输出一个 JSON 对象，格式：{"predictions":[{"secid":"...","direction":"up|down|flat","confidence":0-1,"targetPrice":数字,"support":数字,"resistance":数字,"reason":"一句话理由(≤25字，必须引用具体价格/百分比)"}]}
2. direction=up 偏涨 / down 偏跌 / flat 震荡；confidence 是 0~1 的小数。
3. 结合动量、当日涨跌、区间高低、量能变化、与上次预测的偏差综合判断，不要只凭单根K线。
4. 严禁输出 JSON 以外的任何文字、Markdown 或注释。如果某股票数据不足，直接跳过它。`

function buildUserMessage(stocks: PredictStockInput[]): string {
  const lines = stocks.map((s) => {
    const series = s.series.map((x) => x.p.toFixed(2)).join(',')
    return {
      secid: s.secid,
      name: `${s.name}(${s.code})`,
      price: s.price,
      changePercent: s.changePercent,
      high: s.high,
      low: s.low,
      series,
      momentumPct: s.momentumPct,
      prevPrice: s.prevPrice,
      prevPrediction: s.prevPrediction
    }
  })
  return JSON.stringify({ stocks: lines })
}

function clampNum(v: unknown, fallback?: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return v
}

/** 鲁棒 JSON 提取：剥离推理模型 <think> 段 → 直接解析 → 截取首个 { ... } 平衡段 */
function extractJson(text: string): unknown {
  // qwen3 等推理模型经 Ollama/OpenAI 兼容端点可能输出 <think>…</think>，先剥掉
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  // 未闭合的 <think>（截断）也剥到闭合处为止
  const openIdx = cleaned.indexOf('<think>')
  if (openIdx >= 0 && !cleaned.includes('</think>')) {
    cleaned = cleaned.slice(0, openIdx) + cleaned.slice(cleaned.lastIndexOf('</think>') + 8)
  }
  const trimmed = cleaned.trim()
  if (!trimmed) throw new Error('AI 输出为空')
  try {
    return JSON.parse(trimmed)
  } catch {
    // 忽略
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // 忽略
    }
  }
  throw new Error('AI 输出非 JSON')
}

export function parsePredictions(raw: unknown): StockPrediction[] {
  if (!raw || typeof raw !== 'object') return []
  const arr = (raw as { predictions?: unknown }).predictions
  if (!Array.isArray(arr)) return []
  const out: StockPrediction[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const direction = p.direction === 'down' ? 'down' : p.direction === 'flat' ? 'flat' : 'up'
    const confidenceRaw = Number(p.confidence)
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0.5
    out.push({
      secid: String(p.secid ?? ''),
      code: String(p.code ?? ''),
      name: String(p.name ?? ''),
      direction,
      confidence,
      targetPrice: clampNum(p.targetPrice),
      support: clampNum(p.support),
      resistance: clampNum(p.resistance),
      reason: String(p.reason ?? '').slice(0, 80),
      predictedAt: Date.now()
    })
  }
  return out
}

export async function callPredictApi(
  cfg: AiConfig,
  system: string,
  user: string,
  temperature: number
): Promise<unknown> {
  if (cfg.provider === 'anthropic') {
    if (!cfg.apiKey) throw new Error('未配置 API Key')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 6000,
        temperature,
        system,
        messages: [{ role: 'user', content: user }]
      })
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = (data.content ?? []).map((b) => b.text ?? '').join('')
    return extractJson(text)
  }

  // OpenAI 兼容（DeepSeek/Ollama）。不用 response_format=json_object：
  // 推理模型的 reasoning 会吃掉大量 token，反而更慢更贵；用严格提示词 + 鲁棒提取替代。
  const base = (cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature,
      max_tokens: 6000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  })
  if (!res.ok) throw new Error(`OpenAI 兼容 API ${res.status}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> }
  const text = data.choices?.[0]?.message?.content ?? ''
  return extractJson(text)
}

/** 批量预测全部监控股（一条请求），失败返回 []（监盘不中断） */
export async function predictStocks(stocks: PredictStockInput[]): Promise<StockPrediction[]> {
  if (!stocks.length) return []
  const cfg = loadAiConfig()
  try {
    const raw = await callPredictApi(cfg, SYSTEM_PROMPT, buildUserMessage(stocks), 0.2)
    const parsed = parsePredictions(raw)
    if (!parsed.length) return []
    // 回填缺失的 code/name/预测时间戳
    const bySecid = new Map(stocks.map((s) => [s.secid, s]))
    const now = Date.now()
    return parsed
      .filter((p) => p.secid && bySecid.has(p.secid))
      .map((p) => {
        const src = bySecid.get(p.secid)!
        return {
          ...p,
          code: p.code || src.code,
          name: p.name || src.name,
          predictedAt: now
        }
      })
  } catch (err) {
    console.error('[monitor] AI 预测失败:', err instanceof Error ? err.message : String(err))
    return []
  }
}
