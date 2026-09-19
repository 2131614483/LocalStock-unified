import type { Drawing } from '../../shared/types'
import { getDrawings, getSetting, saveDrawings, clearDrawings, setSetting } from '../db'
import { runBacktest } from '../backtest'
import { runDrawAlgo } from '../drawings'
import { resolveKline } from '../market/kline-resolver'
import { getMinuteAnnotations, setMinuteAnnotations } from '../minute-ai'
import { beginWrite, checkWriteAllowed, markWriteFailed } from './write-gate'
import { SELECTION_WRITE_TOOLS } from './tools-selection'
import type { AiTool } from './tools'

/** 把 AI 给的画线数据规范化成 Drawing[]（补 id/时间/颜色/source） */
function sanitizeDrawings(input: unknown): Drawing[] {
  if (!Array.isArray(input)) throw new Error('drawings 必须是数组')
  const now = Date.now()
  return input
    .filter((d) => d && typeof d === 'object')
    .map((d) => {
      const raw = d as Record<string, unknown>
      const points = Array.isArray(raw.points)
        ? raw.points
            .filter((p) => p && typeof p === 'object')
            .map((p) => ({
              x: Number((p as { x?: unknown }).x ?? 0),
              y: Number((p as { y?: unknown }).y ?? 0)
            }))
        : []
      const type = String(raw.type ?? 'segment')
      return {
        id: String(raw.id ?? `ai_${now}_${Math.random().toString(36).slice(2, 8)}`),
        type,
        points,
        color: String(raw.color ?? '#2f81f7'),
        label: raw.label !== undefined ? String(raw.label) : undefined,
        source: 'algo' as const,
        createdAt: Number(raw.createdAt ?? now),
        updatedAt: now
      } as Drawing
    })
}

export const WRITE_TOOLS: AiTool[] = [
  {
    name: 'write_strategy',
    description:
      '写入回测策略 Python 代码（覆盖回测页当前自动保存的策略）。代码须含 initialize()，用 log() 不用 print()，股票格式如 600519.XSHG。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: '完整策略 Python 源码' } },
      required: ['code']
    },
    handler: async (a, ctx) => {
      const code = String(a.code ?? '')
      if (!code.trim()) throw new Error('策略代码不能为空')
      const prev = getSetting('backtest.code') ?? ''
      const gate = beginWrite({
        tool: 'write_strategy',
        summary: `写入回测策略代码（${code.length} 字符）`,
        args: { codeLength: code.length },
        snapshot: prev
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        setSetting('backtest.code', code)
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  {
    name: 'run_backtest',
    description:
      '运行量化回测（用当前策略代码与参数）。args: code=策略源码, startDate=YYYY-MM-DD, endDate=YYYY-MM-DD, capital=初始资金。返回收益/回撤/夏普/交易明细。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        capital: { type: 'number' }
      },
      required: ['code', 'startDate', 'endDate', 'capital']
    },
    handler: async (a) => {
      const gate = checkWriteAllowed()
      if (!gate.ok) return { rejected: gate.error }
      return runBacktest({
        code: String(a.code ?? ''),
        startDate: String(a.startDate ?? ''),
        endDate: String(a.endDate ?? ''),
        capital: Number(a.capital ?? 1000000)
      })
    }
  },
  {
    name: 'draw_lines',
    description:
      '直接写入某只股票的画线（覆盖该股当前画线）。drawings 为数组，每项 {type: segment|ray|hline|rect|fib|channel, points: [{x: K线索引, y: 价格}], color, label}。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        secid: { type: 'string' },
        drawings: {
          type: 'array',
          items: { type: 'object' },
          description: '画线数组（见描述）'
        }
      },
      required: ['secid', 'drawings']
    },
    handler: async (a, ctx) => {
      const secid = String(a.secid ?? '')
      const drawings = sanitizeDrawings(a.drawings)
      const prev = getDrawings(secid).current
      const gate = beginWrite({
        tool: 'draw_lines',
        secid,
        summary: `写入 ${secid} 画线 ${drawings.length} 条`,
        args: { count: drawings.length },
        snapshot: prev
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        saveDrawings(secid, drawings)
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id, count: drawings.length }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  {
    name: 'clear_drawings',
    description: '清空某只股票的全部画线（进回收站，可从历史版本恢复）。secid 如 "1.600519"。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: { secid: { type: 'string' } },
      required: ['secid']
    },
    handler: async (a, ctx) => {
      const secid = String(a.secid ?? '')
      const prev = getDrawings(secid).current
      const gate = beginWrite({
        tool: 'clear_drawings',
        secid,
        summary: `清空 ${secid} 画线`,
        snapshot: prev
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        clearDrawings(secid)
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  {
    name: 'run_draw_algo',
    description:
      '运行 Python 画线算法，把生成画线合并到该股现有画线并保存。code 内用 draw_line/draw_ray/draw_hline/draw_rect/draw_fib/draw_channel 函数，禁用 print()。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        secid: { type: 'string' },
        code: { type: 'string' },
        klt: { type: 'number', description: 'K线周期，默认 101 日K' }
      },
      required: ['secid', 'code']
    },
    handler: async (a, ctx) => {
      const secid = String(a.secid ?? '')
      const code = String(a.code ?? '')
      const klt = Number(a.klt ?? 101)
      const kline = await resolveKline(secid, klt, 1)
      if (!kline || !kline.points.length) throw new Error('无 K 线数据')
      const prev = getDrawings(secid).current
      const gate = beginWrite({
        tool: 'run_draw_algo',
        secid,
        summary: `运行画线算法 ${secid}（klt=${klt}）`,
        args: { codeLength: code.length, klt },
        snapshot: prev
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        const r = await runDrawAlgo(secid, code, kline)
        if (!r.ok || !r.drawings) throw new Error(r.error ?? '画线算法失败')
        saveDrawings(secid, [...prev, ...r.drawings])
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id, count: r.drawings.length }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  {
    name: 'apply_minute_annotations',
    description:
      '把分时图预测标注写入当前会话并推送到分时图渲染。annotations 数组，每项 {type: hline|segment|ray|markArea|markPoint, x1:每日分钟序号0..239, y1:价格, x2?, y2?, color?, label?}；opinion 为给用户的一句话观点。与 minute_analyze 配套使用：先 minute_analyze 得到标注，再用本工具落屏。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        secid: { type: 'string' },
        annotations: { type: 'array', items: { type: 'object' } },
        opinion: { type: 'string' }
      },
      required: ['secid', 'annotations']
    },
    handler: async (a, ctx) => {
      const secid = String(a.secid ?? '')
      const annotations = Array.isArray(a.annotations)
        ? (a.annotations as Array<Record<string, unknown>>).filter((x) => x?.type).map((x) => ({
            id: String(x.id ?? `ma_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
            type: String(x.type) as 'hline' | 'segment' | 'ray' | 'markArea' | 'markPoint',
            x1: Number(x.x1 ?? 0),
            y1: Number(x.y1 ?? 0),
            x2: x.x2 !== undefined ? Number(x.x2) : undefined,
            y2: x.y2 !== undefined ? Number(x.y2) : undefined,
            color: String(x.color ?? '#2f81f7'),
            label: x.label !== undefined ? String(x.label) : undefined
          }))
        : []
      const opinion = String(a.opinion ?? '').slice(0, 120)
      const prev = getMinuteAnnotations(secid)
      const gate = beginWrite({
        tool: 'apply_minute_annotations',
        secid,
        summary: `分时图预测标注 ${annotations.length} 条（${secid}）`,
        args: { count: annotations.length },
        snapshot: prev
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        setMinuteAnnotations(secid, annotations, opinion)
        ctx.pushMinute(secid)
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id, count: annotations.length }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  ...SELECTION_WRITE_TOOLS
]
