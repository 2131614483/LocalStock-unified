import { ipcMain } from 'electron'
import type { MinuteAnnotation, MinuteResult } from '../shared/types'
import { getMarketStatus, minuteIndexFor } from '../shared/market-session'
import { loadAiConfig } from './ai/provider'
import { callPredictApi } from './monitor/predict'
import { savePrediction, savePredictionHistory } from './monitor/store'
import { resolveMinute } from './market/minute-resolver'
import { parseAnnotations, buildPredictionFromAnnotations } from './minute-ai-parse'

/**
 * 分时图 AI 预测/画线：
 *  - 快捷路径：渲染层把当日分时 + intent 传来，主进程预计算紧凑特征 → DeepSeek 单次结构化调用
 *    → 返回标注（x=每日分钟序号 0..239，可超出当前数据=未来；y=价格）+ 一句话观点。
 *  - 标注为会话内内存（关详情页即清），不落 drawings 表（分时坐标语义与 K 线不同）。
 */

const SESSION = new Map<
  string,
  { annotations: MinuteAnnotation[]; opinion: string; ts: number }
>()

export function getMinuteAnnotations(secid: string): {
  annotations: MinuteAnnotation[]
  opinion: string
} | null {
  const s = SESSION.get(secid)
  return s ? { annotations: s.annotations, opinion: s.opinion } : null
}

export function setMinuteAnnotations(
  secid: string,
  annotations: MinuteAnnotation[],
  opinion: string
): void {
  SESSION.set(secid, { annotations, opinion, ts: Date.now() })
}

const SYSTEM_PROMPT = `你是 A 股当日分时图分析助手，在分时图上做画线预测。
输入是一个股票的当日分时快照：现价/均价/昨收/涨跌幅/日内高低/量能/剩余交易分钟 + 用户意图。
要求：
1. 只输出一个 JSON 对象：{"opinion":"一句话观点(≤40字,引用具体价格)", "annotations":[{"type":"hline|segment|ray|markArea|markPoint","x1":分钟序号,"y1":价格,"x2":可选,"y2":可选,"label":"可选短标签"}]}
2. x 是每日分钟序号（0=09:30 … 239=15:00），可画到未来（>当前序号）。y 是价格。
   hline 支撑/压力：x1=0,x2=239；segment/ray 趋势：两点；markArea 区域：四角 x1,y1,x2,y2；markPoint 目标价：x1=当前/未来序号,y1=目标价。
3. 结合剩余交易分钟：交易中预测当日剩余走势；已收盘/临近收盘则预测次日（把趋势线画到 239 或用 markPoint 标次日目标）。
4. 1~5 条标注，颜色：压力/看跌 #f5222d，支撑/看涨 #14b143，中性 #2f81f7。
5. 严禁输出 JSON 以外的文字。`

/** 分析当日分时并返回预测标注（minute 缺省时主进程自行拉取，供 agent 工具用） */
export async function analyzeMinute(
  secid: string,
  intent: string,
  minute?: MinuteResult
): Promise<{ annotations: MinuteAnnotation[]; opinion: string }> {
  const data = minute ?? (await resolveMinute(secid, 1))
  if (!data || !data.points.length) return { annotations: [], opinion: '暂无分时数据' }

  const points = data.points
  const preClose = data.preClose || points[0].preClose || points[0].price || 0
  const last = points[points.length - 1]
  const nowIdx = minuteIndexFor(last.time) ?? points.length - 1
  const prices = points.map((p) => p.price)
  const highs = points.map((p) => p.high).filter((v) => v > 0)
  const lows = points.map((p) => p.low).filter((v) => v > 0)
  const step = Math.max(1, Math.floor(points.length / 16))
  const series = points
    .filter((_, i) => i % step === 0)
    .map((p) => ({ t: p.time, p: p.price }))
  const totalVol = points.reduce((s, p) => s + (p.volume || 0), 0)
  const changePct = preClose > 0 ? ((last.price - preClose) / preClose) * 100 : 0
  const market = getMarketStatus()

  const user = JSON.stringify({
    secid,
    name: data.name,
    intent: intent || '分析当前分时走势并画支撑压力/预测',
    market: { phase: market.phase, isTrading: market.isTrading, label: market.label, minutesElapsed: market.minutesElapsed, minutesLeft: market.minutesLeft },
    nowIndex: nowIdx,
    price: last.price,
    avg: last.avg || 0,
    preClose,
    changePercent: Number(changePct.toFixed(2)),
    high: highs.length ? Math.max(...highs) : last.price,
    low: lows.length ? Math.min(...lows) : last.price,
    totalVolume: totalVol,
    series
  })

  const cfg = loadAiConfig()
  const raw = await callPredictApi(cfg, SYSTEM_PROMPT, user, 0.25)
  return parseAnnotations(raw, nowIdx)
}

// ---------- IPC ----------

export function registerMinuteIpc(getWindow: () => Electron.BrowserWindow | null): void {
  ipcMain.handle('minute:analyze', async (e, secid: string, intent: string, minute?: MinuteResult) => {
    const r = await analyzeMinute(secid, intent, minute)
    setMinuteAnnotations(secid, r.annotations, r.opinion)
    // 分时预测接入监盘统计：记入预测历史+缓存（供监盘窗命中率/预测展示）
    const last = minute?.points?.[minute.points.length - 1]
    if (last?.price && last.price > 0) {
      const p = buildPredictionFromAnnotations(secid, minute?.name ?? '', r.annotations, r.opinion, last.price)
      if (p.direction !== 'flat' || p.support !== undefined || p.resistance !== undefined || p.targetPrice !== undefined) {
        savePrediction(p)
        savePredictionHistory(p, last.price)
      }
    }
    if (!e.sender.isDestroyed()) {
      e.sender.send('minute:annotations', { secid, ...r })
    }
    return r
  })
  ipcMain.handle('minute:get', (_e, secid: string) => getMinuteAnnotations(secid))
  ipcMain.handle('minute:clear', (e, secid: string) => {
    SESSION.delete(secid)
    if (!e.sender.isDestroyed()) {
      e.sender.send('minute:annotations', { secid, annotations: [], opinion: '' })
    }
    return { ok: true }
  })
}

/** AI agent 工具写入后推送（不经 IPC 请求） */
export function pushMinuteAnnotations(
  getWindow: () => Electron.BrowserWindow | null,
  secid: string
): void {
  const s = getMinuteAnnotations(secid)
  const w = getWindow()
  if (w && !w.isDestroyed()) {
    w.webContents.send('minute:annotations', {
      secid,
      annotations: s?.annotations ?? [],
      opinion: s?.opinion ?? ''
    })
  }
}
