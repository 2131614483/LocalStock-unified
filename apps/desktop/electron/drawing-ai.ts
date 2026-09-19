import { ipcMain } from 'electron'
import type { KlineResult } from '../shared/types'
import { loadAiConfig } from './ai/provider'
import { callPredictApi } from './monitor/predict'

/**
 * 算法画线 · AI 生成/调优代码（单次 LLM 调用，无工具循环）：
 * 输入 = 用户需求 + 当前代码（调优时）+ K线紧凑摘要；
 * 输出 = JSON {code, note}，渲染层把 code 填回代码框，note 展示为说明。
 * 复用 callPredictApi（Anthropic/OpenAI 兼容双通道 + 鲁棒 JSON 提取）。
 */

const SYSTEM_PROMPT = `你是 A 股 K 线画线算法助手。用户会用自然语言描述想要的画线，你生成或修改 Python 画线代码。

【代码运行环境】（严格执行，不要 import 任何库，不要定义函数，不要 print，直接写顶层语句）：
- 变量 data：{"dates": ["YYYY-MM-DD"...], "opens": [...], "highs": [...], "lows": [...], "closes": [...], "volumes": [...], "n": 总根数}，全部 list[float/int]，索引 0=最旧，n-1=最新。
- 画线函数（直接调用）：
  - draw_line(x1, y1, x2, y2, color='#2f81f7', label=None)  线段，x 为 K 线索引
  - draw_hline(y, color='#f5222d', label=None)  水平线（横贯全图）
  - draw_ray(x1, y1, x2, y2, color=..., label=...)  射线（从第一点向第二点方向延伸）
  - draw_rect(x1, y1, x2, y2, color=..., label=...)  矩形
  - draw_fib(x1, y1, x2, y2, color=..., label=...)  斐波那契回撤
  - draw_channel(x1, y1, x2, y2, color=..., label=...)  平行通道
- 颜色约定：压力/看跌 '#f5222d'，支撑/看涨 '#14b143'，中性/趋势 '#2f81f7'，提醒 '#f5c542'。
- label 是短中文标签（可选）。

【硬性约束】
1. 只输出一个 JSON 对象：{"code": "完整Python代码", "note": "一句话说明（≤60字，简述画了什么线、逻辑）"}
2. code 是字符串（内部的引号与换行须合法转义）。代码里禁止 print/import/函数定义/try，只允许顶层赋值、算术、if 与画线函数调用；数据访问只用 data 与 n。
3. 用户给了旧代码（oldCode 非空）时是"调优"：在旧代码基础上按需求修改，保留可用的部分。
4. 生成 2~6 条画线为宜；价格必须来自 data（不要凭空猜测价位）。
5. 严禁输出 JSON 以外的文字（不要 markdown 代码围栏）。`

interface DrawAiCodeRequest {
  intent: string
  oldCode?: string
  kline: {
    n: number
    firstDate: string
    lastDate: string
    lastClose: number
    high: number
    low: number
    // 最近 60 根收盘价采样（降采样），供 AI 感知走势
    recentCloses: number[]
  }
}

/** 从 KlineResult 提取紧凑摘要（避免整包 K 线塞给 LLM） */
export function summarizeKline(k: KlineResult): DrawAiCodeRequest['kline'] {
  const pts = k.points
  const closes = pts.map((p) => p.close)
  const step = Math.max(1, Math.floor(pts.length / 60))
  const recent = pts.slice(-Math.min(60 * step, pts.length)).filter((_, i) => i % step === 0)
  return {
    n: pts.length,
    firstDate: pts[0]?.time ?? '',
    lastDate: pts[pts.length - 1]?.time ?? '',
    lastClose: pts[pts.length - 1]?.close ?? 0,
    high: Math.max(...pts.map((p) => p.high)),
    low: Math.min(...pts.map((p) => p.low)),
    recentCloses: (recent.length ? recent : pts.slice(-60)).map((p) => p.close)
  }
}

export function registerDrawingAiIpc(): void {
  ipcMain.handle(
    'drawing:aiCode',
    async (_e, intent: string, oldCode: string | undefined, kline: KlineResult) => {
      try {
        if (!intent?.trim()) return { ok: false, error: '请描述你想要的画线' }
        if (!kline?.points?.length) return { ok: false, error: '当前无K线数据' }
        const cfg = loadAiConfig()
        if (cfg.provider === 'anthropic' && !cfg.apiKey) {
          return { ok: false, error: '尚未配置 AI 的 API Key（AI 面板 → 设置）' }
        }
        const user = JSON.stringify({
          intent: intent.trim(),
          oldCode: oldCode?.trim() || undefined,
          kline: summarizeKline(kline)
        })
        const raw = await callPredictApi(cfg, SYSTEM_PROMPT, user, 0.2)
        const obj = raw as { code?: unknown; note?: unknown }
        const code = typeof obj?.code === 'string' ? obj.code : ''
        if (!code.trim()) return { ok: false, error: 'AI 未返回代码，请重试或换个描述' }
        return {
          ok: true,
          code,
          note: typeof obj?.note === 'string' ? obj.note.slice(0, 120) : undefined
        }
      } catch (err) {
        return { ok: false, error: `AI 生成失败：${err instanceof Error ? err.message : String(err)}` }
      }
    }
  )
}
