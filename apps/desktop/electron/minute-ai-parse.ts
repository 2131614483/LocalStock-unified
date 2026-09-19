import type { MinuteAnnotation, StockPrediction } from '../shared/types'

/** 分时预测标注解析（纯函数，可单测） */
export function parseAnnotations(
  raw: unknown,
  nowIdx: number
): { annotations: MinuteAnnotation[]; opinion: string } {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const arr = obj.annotations
  const opinion = String(obj.opinion ?? '').slice(0, 80)
  const annotations: MinuteAnnotation[] = []
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const a = item as Record<string, unknown>
      const type =
        a.type === 'markPoint' || a.type === 'segment' || a.type === 'ray' || a.type === 'markArea'
          ? a.type
          : 'hline'
      const x1 = clampIdx(a.x1)
      const y1 = clampPrice(a.y1)
      if (x1 > nowIdx + 4 || y1 <= 0) continue // 只允许画到未来一点，不画离谱远处
      const ann: MinuteAnnotation = {
        id: `ma_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type,
        x1,
        y1,
        color: String(a.color ?? '#2f81f7')
      }
      if (a.x2 !== undefined) ann.x2 = clampIdx(a.x2)
      if (a.y2 !== undefined) ann.y2 = clampPrice(a.y2)
      if (a.label) ann.label = String(a.label).slice(0, 20)
      annotations.push(ann)
    }
  }
  return { annotations, opinion }
}

function clampIdx(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(239, Math.round(n))) : 0
}

function clampPrice(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 把分时标注转成监盘统计用的结构化预测（方向/目标/支撑阻力/理由），供命中率统计 */
export function buildPredictionFromAnnotations(
  secid: string,
  name: string,
  annotations: MinuteAnnotation[],
  opinion: string,
  price: number
): StockPrediction {
  const code = secid.split('.')[1] ?? ''
  const targets = annotations.filter((a) => a.type === 'markPoint' || a.type === 'segment')
  const hlines = annotations.filter((a) => a.type === 'hline')
  const above = targets.filter((a) => a.y1 > price)
  const below = targets.filter((a) => a.y1 < price)
  let direction: 'up' | 'down' | 'flat' = 'flat'
  if (above.length > below.length) direction = 'up'
  else if (below.length > above.length) direction = 'down'
  const supports = hlines.filter((h) => h.y1 < price).map((h) => h.y1)
  const resistances = hlines.filter((h) => h.y1 > price).map((h) => h.y1)
  return {
    secid,
    code,
    name,
    direction,
    confidence: 0.6,
    targetPrice:
      direction === 'up'
        ? Math.min(...above.map((a) => a.y1))
        : direction === 'down'
          ? Math.max(...below.map((a) => a.y1))
          : undefined,
    support: supports.length ? Math.max(...supports) : undefined,
    resistance: resistances.length ? Math.min(...resistances) : undefined,
    reason: (opinion || '分时预测').slice(0, 60),
    predictedAt: Date.now()
  }
}
