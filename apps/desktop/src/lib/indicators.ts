// 技术指标计算（纯函数，NaN 表示数据不足/无效，ECharts 自动跳过）

/** 哪些指标副图显示 */
export interface IndicatorConfig {
  macd: boolean
  kdj: boolean
  rsi: boolean
}

export const DEFAULT_INDICATORS: IndicatorConfig = { macd: true, kdj: false, rsi: false }

function ema(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  const k = 2 / (n + 1)
  let prev = NaN
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) {
      out[i] = NaN
      continue
    }
    prev = Number.isNaN(prev) ? values[i] : values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export interface MACDResult {
  dif: number[]
  dea: number[]
  macd: number[] // 柱 = 2*(DIF-DEA)
}

export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): MACDResult {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif = closes.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i]
  )
  const dea = ema(dif, signal)
  const macd = dif.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(dea[i]) ? NaN : 2 * (v - dea[i])
  )
  return { dif, dea, macd }
}

export interface KDJResult {
  k: number[]
  d: number[]
  j: number[]
}

export function calcKDJ(highs: number[], lows: number[], closes: number[], n = 9): KDJResult {
  const k: number[] = []
  const d: number[] = []
  const j: number[] = []
  let prevK = NaN
  let prevD = NaN
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) {
      k.push(NaN)
      d.push(NaN)
      j.push(NaN)
      continue
    }
    let llv = Infinity
    let hhv = -Infinity
    for (let m = i - n + 1; m <= i; m++) {
      if (lows[m] < llv) llv = lows[m]
      if (highs[m] > hhv) hhv = highs[m]
    }
    const rsv = hhv - llv > 0 ? ((closes[i] - llv) / (hhv - llv)) * 100 : 50
    prevK = Number.isNaN(prevK) ? rsv : (2 / 3) * prevK + (1 / 3) * rsv
    prevD = Number.isNaN(prevD) ? prevK : (2 / 3) * prevD + (1 / 3) * prevK
    k.push(prevK)
    d.push(prevD)
    j.push(3 * prevK - 2 * prevD)
  }
  return { k, d, j }
}

/** Wilder 平滑 RSI */
export function calcRSI(closes: number[], n = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN)
  let avgGain = NaN
  let avgLoss = NaN
  for (let i = 1; i < closes.length; i++) {
    const chg = closes[i] - closes[i - 1]
    const gain = chg > 0 ? chg : 0
    const loss = chg < 0 ? -chg : 0
    if (Number.isNaN(avgGain)) {
      if (i < n) continue
      let g = 0
      let l = 0
      for (let m = i - n + 1; m <= i; m++) {
        const c = closes[m] - closes[m - 1]
        g += c > 0 ? c : 0
        l += c < 0 ? -c : 0
      }
      avgGain = g / n
      avgLoss = l / n
    } else {
      avgGain = (avgGain * (n - 1) + gain) / n
      avgLoss = (avgLoss * (n - 1) + loss) / n
    }
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}
