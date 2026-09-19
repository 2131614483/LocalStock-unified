// A股涨跌配色与数值格式化（同花顺风格：红涨绿跌）

export const UP_COLOR = '#f5222d'
export const DOWN_COLOR = '#14b143'
export const FLAT_COLOR = '#9aa0a6'

export type Trend = 'up' | 'down' | 'flat'

export function trendOf(v: number | undefined): Trend {
  if (v === undefined || v === null) return 'flat'
  if (v > 0) return 'up'
  if (v < 0) return 'down'
  return 'flat'
}

export function trendColor(v: number | undefined): string {
  if (trendOf(v) === 'up') return UP_COLOR
  if (trendOf(v) === 'down') return DOWN_COLOR
  return FLAT_COLOR
}

export function trendClass(v: number | undefined): string {
  return trendOf(v)
}

export function isFiniteNum(v: number | undefined): v is number {
  return v !== undefined && v !== null && Number.isFinite(v)
}

export function formatPrice(v: number | undefined): string {
  if (!isFiniteNum(v)) return '--'
  return v!.toFixed(2)
}

export function formatSigned(v: number | undefined): string {
  if (!isFiniteNum(v)) return '--'
  return `${v! > 0 ? '+' : ''}${v!.toFixed(2)}`
}

export function formatPercent(v: number | undefined): string {
  if (!isFiniteNum(v)) return '--'
  return `${v! > 0 ? '+' : ''}${v!.toFixed(2)}%`
}

/** 成交量（手）→ 手/万手/亿手 */
export function formatVolume(vol: number | undefined): string {
  if (!isFiniteNum(vol)) return '--'
  const v = vol!
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return v.toFixed(0)
}

/** 成交额（元）→ 万/亿 */
export function formatAmount(amount: number | undefined): string {
  if (!isFiniteNum(amount)) return '--'
  const v = amount!
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return v.toFixed(0)
}

/** 市值（元）→ 亿/万亿 */
export function formatMv(mv: number | undefined): string {
  if (!isFiniteNum(mv)) return '--'
  const v = mv!
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  return `${(v / 1e4).toFixed(0)}万`
}

/** 通用数值（市盈率/换手率等） */
export function formatNum(v: number | undefined, digits = 2): string {
  if (!isFiniteNum(v)) return '--'
  return v!.toFixed(digits)
}
