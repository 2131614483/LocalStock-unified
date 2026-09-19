import type { SelectionHit, SelectionRule } from '../../shared/types'
import { listWatchlist, addWatchlist } from '../db'
import { loadAiConfig } from './provider'
import { beginWrite, checkWriteAllowed, markWriteFailed } from './write-gate'
import { listRules, saveRule, deleteRule, runScan, saveResult, listResults } from '../selection'
import type { AiTool } from './tools'

// ---------- 只读 ----------

export const SELECTION_READ_TOOLS: AiTool[] = [
  {
    name: 'list_selection_rules',
    description: '列出已保存的自动选股规则（含筛选条件/排序/定时）。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listRules()
  },
  {
    name: 'get_selection_results',
    description: '获取最近选股扫描结果（含每只命中股票与理由）。',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } }
    },
    handler: async (a) => listResults(Number(a.limit ?? 20))
  }
]

// ---------- 写入 ----------

export const SELECTION_WRITE_TOOLS: AiTool[] = [
  {
    name: 'save_selection_rule',
    description:
      '保存/更新一条选股规则。rule 结构：{id?, name, mode:"rule"|"ai", enabled, filters:[...], top?, scheduleMinutes?}。filters 为筛选条件数组，kind 取值：ma_cross(快慢线金叉) / ma_align(均线多头) / price_breakout(lookback日新高) / volume_surge(量比) / volume_shrink / macd_cross / rsi_range / change_pct_range(涨幅%) / amount_range(成交额元) / pe_range / pb_range / mv_range(市值元) / industry_in(行业列表)。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: { rule: { type: 'object', description: '选股规则对象' } },
      required: ['rule']
    },
    handler: async (a, ctx) => {
      const rule = a.rule as Partial<SelectionRule>
      const prev = listRules().find((r) => r.id === rule.id) ?? null
      const gate = beginWrite({
        tool: 'save_selection_rule',
        summary: `保存选股规则「${rule.name ?? rule.id ?? '未命名'}」`,
        args: { ruleId: rule.id, name: rule.name },
        snapshot: prev
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        const rules = saveRule(rule)
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id, ruleId: rules.find((r) => r.id === rule.id)?.id }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  {
    name: 'delete_selection_rule',
    description: '删除一条选股规则（可回滚恢复）。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    handler: async (a, ctx) => {
      const id = String(a.id ?? '')
      const prev = listRules().find((r) => r.id === id) ?? null
      if (!prev) throw new Error(`规则不存在: ${id}`)
      const gate = beginWrite({
        tool: 'delete_selection_rule',
        summary: `删除选股规则「${prev.name}」`,
        args: { ruleId: id },
        snapshot: prev
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        deleteRule(id)
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  {
    name: 'run_selection',
    description:
      '运行一次规则选股扫描（mode=rule，基于本地行情库全市场技术面 + 快照基本面），返回命中股票列表与理由。rule 可传已保存规则或临时构造。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: { rule: { type: 'object' } },
      required: ['rule']
    },
    handler: async (a) => {
      const gate = checkWriteAllowed()
      if (!gate.ok) return { rejected: gate.error }
      return runScan(a.rule as SelectionRule)
    }
  },
  {
    name: 'save_selection_result',
    description:
      '保存一次选股结果（供 AI 动态模式落库展示）。result 结构：{ruleId, ruleName, mode:"ai", hits:[{secid, code, name, price?, changePercent?, amount?, reasons:[...]}]}。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: { result: { type: 'object' } },
      required: ['result']
    },
    handler: async (a, ctx) => {
      const r = a.result as { ruleId?: string; ruleName?: string; hits?: SelectionHit[] }
      const resultId = `rs_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const gate = beginWrite({
        tool: 'save_selection_result',
        summary: `保存 AI 选股结果（${r.hits?.length ?? 0} 只）`,
        args: { resultId, ruleId: r.ruleId, count: r.hits?.length ?? 0 }
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        const result = {
          id: resultId,
          ruleId: r.ruleId ?? 'ai',
          ruleName: r.ruleName ?? 'AI 智能选股',
          mode: 'ai' as const,
          scannedAt: Date.now(),
          total: r.hits?.length ?? 0,
          hits: r.hits ?? []
        }
        saveResult(result)
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id, resultId }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  },
  {
    name: 'apply_selection_to_watchlist',
    description:
      '把选股命中股票加入自选股。items 为 {secid, code, name}[]。此操作受设置「允许 AI 写入自选股」开关控制，默认关闭。',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { secid: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' } } }
        }
      },
      required: ['items']
    },
    handler: async (a, ctx) => {
      const cfg = loadAiConfig()
      if (!cfg.allowWatchlistWrite) {
        return {
          rejected:
            '「允许 AI 把选股结果写入自选股」开关未开启。请先向用户说明，让用户在 AI 设置中开启，或由用户手动添加。'
        }
      }
      const items = Array.isArray(a.items)
        ? (a.items as Array<{ secid: string; code: string; name: string }>).filter((x) => x?.secid)
        : []
      const before = listWatchlist().map((w) => w.secid)
      const gate = beginWrite({
        tool: 'apply_selection_to_watchlist',
        summary: `加入自选 ${items.length} 只`,
        args: { secids: items.map((i) => i.secid) },
        snapshot: before
      })
      if (!gate.ok) return { rejected: gate.error }
      try {
        for (const it of items) addWatchlist({ secid: it.secid, code: it.code, name: it.name })
        ctx.refresh()
        return { ok: true, auditId: gate.entry.id, added: items.length }
      } catch (err) {
        markWriteFailed(gate.entry.id)
        throw err
      }
    }
  }
]
