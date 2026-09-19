import type { Drawing, DrawingPoint, DrawingType } from '../../shared/types'

export const DRAWING_TYPES: Array<{ type: DrawingType; label: string }> = [
  { type: 'segment', label: '趋势线' },
  { type: 'ray', label: '射线' },
  { type: 'hline', label: '水平线' },
  { type: 'rect', label: '矩形' },
  { type: 'fib', label: '斐波那契' },
  { type: 'channel', label: '通道' }
]

export const DRAWING_COLORS = [
  '#2f81f7',
  '#f5222d',
  '#14b143',
  '#f5c542',
  '#e879f9',
  '#ffffff'
]

// 默认画线色：白色（K线/均线均无纯白，最清晰；原默认 #2f81f7 与 MA20 同色易混淆）
export const DEFAULT_COLOR = '#ffffff'

/** 各线型需要的点数 */
export const DRAWING_MIN_POINTS: Record<DrawingType, number> = {
  segment: 2,
  ray: 2,
  hline: 1,
  rect: 2,
  fib: 2,
  channel: 2
}

/** 新建画线 */
export function newDrawing(
  type: DrawingType,
  points: DrawingPoint[],
  color: string,
  source: 'manual' | 'algo' = 'manual',
  scope?: string
): Drawing {
  const now = Date.now()
  return {
    id: `${source === 'algo' ? 'a' : 'm'}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    points,
    color,
    source,
    ...(scope ? { scope } : {}),
    createdAt: now,
    updatedAt: now
  }
}
