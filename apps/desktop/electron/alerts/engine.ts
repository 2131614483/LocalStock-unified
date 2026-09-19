// 预警规则引擎：纯函数，输入 K线数据 + 规则，判定是否触发。
// 规则类型：ma_cross（均线金叉/死叉）、price_above/below（价格突破阈值）、volume_spike（量能放大）。
import type { AlertRule, AlertRuleType } from '../../shared/types'

export type { AlertRule, AlertRuleType }

export interface AlertEvalResult {
  fired: boolean
  /** 触发信号标识（用于去重，如 "ma5>ma20" / "1300>1200"） */
  signal?: string
  /** 触发描述 */
  message: string
}

function ma(values: number[], n: number, end: number): number | null {
  if (end + 1 < n) return null
  let sum = 0
  for (let i = end - n + 1; i <= end; i++) sum += values[i]
  return sum / n
}

/** 计算规则是否触发。closes/volumes 为按时间升序的收盘价/成交量数组 */
export function evaluateRule(rule: AlertRule, closes: number[], volumes: number[]): AlertEvalResult {
  const n = closes.length
  if (!n) return { fired: false, message: '无数据' }
  const close = closes[n - 1]

  switch (rule.type) {
    case 'price_above': {
      const t = rule.threshold ?? 0
      const fired = close > t
      return {
        fired,
        signal: `${close.toFixed(2)}>${t}`,
        message: `${rule.name}：现价 ${close.toFixed(2)} 突破 ${t}`
      }
    }
    case 'price_below': {
      const t = rule.threshold ?? 0
      const fired = close < t
      return {
        fired,
        signal: `${close.toFixed(2)}<${t}`,
        message: `${rule.name}：现价 ${close.toFixed(2)} 跌破 ${t}`
      }
    }
    case 'volume_spike': {
      const win = rule.fast ?? 20 // 均量窗口
      const ratio = rule.threshold ?? 2 // 量比阈值，默认 2 倍
      const vol = volumes[n - 1] ?? 0
      const avg = ma(volumes, win, n - 2) // 当日之前的 win 根均量（不含当日）
      if (!avg || avg <= 0) return { fired: false, message: '均量不足' }
      const fired = vol > avg * ratio
      return {
        fired,
        signal: `${vol}>${Math.round(avg * ratio)}`,
        message: `${rule.name}：成交量 ${vol} 手，达 ${ratio} 倍均量(${Math.round(avg)})`
      }
    }
    case 'ma_cross': {
      const fastN = rule.fast ?? 5
      const slowN = rule.slow ?? 20
      const fNow = ma(closes, fastN, n - 1)
      const sNow = ma(closes, slowN, n - 1)
      const fPrev = ma(closes, fastN, n - 2)
      const sPrev = ma(closes, slowN, n - 2)
      if (fNow === null || sNow === null || fPrev === null || sPrev === null) {
        return { fired: false, message: '均线数据不足' }
      }
      // 金叉：快线今上穿慢线（昨快≤慢，今快>慢）
      const golden = fPrev <= sPrev && fNow > sNow
      // 死叉：快线今下穿慢线
      const death = fPrev >= sPrev && fNow < sNow
      return {
        fired: golden || death,
        signal: golden ? `golden${fastN}/${slowN}` : death ? `death${fastN}/${slowN}` : '',
        message: `${rule.name}：MA${fastN}${golden ? '金叉' : '死叉'}MA${slowN}` +
          `（${fNow.toFixed(2)} vs ${sNow.toFixed(2)}）`
      }
    }
  }
}
