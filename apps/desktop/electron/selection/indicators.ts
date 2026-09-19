/**
 * 技术指标计算（纯函数，供选股扫描 worker 使用）。
 * 数组均按时间升序，索引 i 对应第 i 根 K 线。
 */

/** 简单均线：返回每根对应的 SMA，不足 n 根时为 null */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= n) sum -= values[i - n]
    if (i >= n - 1) out[i] = sum / n
  }
  return out
}

/** 指数均线：返回从 0 起每根 EMA */
export function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1)
  const out: number[] = new Array(values.length)
  let prev = values[0] ?? 0
  out[0] = prev
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export interface MacdResult {
  dif: number[]
  dea: number[]
  hist: number[]
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): MacdResult {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif = closes.map((_, i) => emaFast[i] - emaSlow[i])
  const dea = ema(dif, signal)
  const hist = dif.map((v, i) => v - dea[i])
  return { dif, dea, hist }
}

/** RSI（Wilder 平滑），返回最后索引值，数据不足返回 null */
export function rsiLast(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}
