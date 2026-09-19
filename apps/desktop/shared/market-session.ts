// A 股交易时段纯函数（主进程与渲染层共用；实时数据 15:00 收盘结束）
// 每日 240 分钟：9:30-11:30（120 分）+ 13:00-15:00（120 分），周一~周五。

export type MarketPhase = 'pre' | 'morning' | 'lunch' | 'afternoon' | 'closed' | 'weekend'

export interface MarketStatus {
  phase: MarketPhase
  isTrading: boolean
  /** 已交易分钟数（9:30 起，收盘后为 240） */
  minutesElapsed: number
  /** 距 15:00 剩余分钟（收盘后为 0） */
  minutesLeft: number
  /** 展示文案，如 "交易中 · 剩 42 分钟" / "已收盘" / "午间休市" */
  label: string
  /** 下一关键时点描述，如 "收盘 15:00" / "开盘 09:30" */
  nextLabel: string
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 分钟序号（0..239）→ "HH:MM" 时间标签（跳过午休 11:30-13:00） */
export function minuteTimeAt(idx: number): string {
  const i = clamp(Math.round(idx), 0, 239)
  const total = i < 120 ? 9 * 60 + 30 + i : 13 * 60 + (i - 120)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "HH:MM" → 分钟序号（0..239；午休/收盘后/开盘前返回 null） */
export function minuteIndexFor(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return null
  const total = Number(m[1]) * 60 + Number(m[2])
  const start = 9 * 60 + 30
  const morningEnd = 11 * 60 + 30
  const afternoonStart = 13 * 60
  const close = 15 * 60
  if (total < start || total >= close) return null
  if (total >= morningEnd && total < afternoonStart) return null // 午休
  if (total < morningEnd) return total - start // 0..119（09:30..11:29）
  return 120 + (total - afternoonStart) // 120..239（13:00..14:59）
}

/** 是否指数 secid：沪指 1.000xxx、深指 0.399xxx（指数不走 stock_daily，走 index_daily/在线） */
export function isIndexSecid(secid: string): boolean {
  return /^1\.000\d{3}$/.test(secid) || /^0\.399\d{3}$/.test(secid)
}

/** 单日分时图表序号：0..239，11:30→119、15:00→239（午休数据并入 119），非法返回 -1 */
export function chartIndexFor(time: string): number {
  const i = minuteIndexFor(time)
  if (i !== null) return i
  if (time >= '11:30' && time < '13:00') return 119
  if (time >= '15:00') return 239
  return -1
}

export function getMarketStatus(now = new Date()): MarketStatus {
  const day = now.getDay()
  const isWeekend = day === 0 || day === 6
  const t = now.getHours() * 60 + now.getMinutes()
  const start = 9 * 60 + 30
  const morningEnd = 11 * 60 + 30
  const afternoonStart = 13 * 60
  const close = 15 * 60

  if (isWeekend) {
    return {
      phase: 'weekend',
      isTrading: false,
      minutesElapsed: 0,
      minutesLeft: 0,
      label: '休市（周末）',
      nextLabel: '下周一 09:30 开盘'
    }
  }
  if (t < start) {
    return {
      phase: 'pre',
      isTrading: false,
      minutesElapsed: 0,
      minutesLeft: 240,
      label: '未开盘',
      nextLabel: '09:30 开盘'
    }
  }
  if (t < morningEnd) {
    const elapsed = t - start
    return {
      phase: 'morning',
      isTrading: true,
      minutesElapsed: elapsed,
      minutesLeft: 240 - elapsed,
      label: `交易中 · 剩 ${240 - elapsed} 分钟`,
      nextLabel: '11:30 午休'
    }
  }
  if (t < afternoonStart) {
    return {
      phase: 'lunch',
      isTrading: false,
      minutesElapsed: 120,
      minutesLeft: 120,
      label: '午间休市',
      nextLabel: '13:00 开盘'
    }
  }
  if (t < close) {
    const elapsed = 120 + (t - afternoonStart)
    return {
      phase: 'afternoon',
      isTrading: true,
      minutesElapsed: elapsed,
      minutesLeft: close - t,
      label: `交易中 · 剩 ${close - t} 分钟`,
      nextLabel: '15:00 收盘'
    }
  }
  return {
    phase: 'closed',
    isTrading: false,
    minutesElapsed: 240,
    minutesLeft: 0,
    label: '已收盘',
    nextLabel: '次日 09:30 开盘'
  }
}
