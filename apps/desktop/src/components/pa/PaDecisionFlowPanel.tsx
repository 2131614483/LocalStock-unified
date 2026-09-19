import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { useEChart } from '../../lib/useEChart'
import { usePa } from '../../store/pa'

/** 将模型的 decision_trace 画成可缩放、可拖拽的决策路径图。 */
export default function PaDecisionFlowPanel() {
  const payload = usePa((s) => s.record?.stage2_decision)
  const steps = useMemo(() => normaliseTrace(payload?.decision_trace), [payload])
  const option = useMemo<EChartsOption | null>(() => {
    if (!steps.length) return null
    const stepByKey = new Map<string, TraceStep>()
    const nodes = steps.map((step, index) => ({
      id: `step-${index}`, name: `§${step.nodeId} · ${step.answer || '判断'}`, value: `step-${index}`,
      x: 80 + index * 180, y: 120 + (index % 2) * 120,
      symbolSize: 66, itemStyle: { color: index === steps.length - 1 ? '#22c55e' : '#2389ff' },
      label: { show: true, formatter: `§${step.nodeId}\n${step.answer || '判断'}`, color: '#e6edf3', fontSize: 11, width: 150, overflow: 'break' as const }
    }))
    steps.forEach((step, index) => stepByKey.set(`step-${index}`, step))
    const terminal = payload?.terminal && typeof payload.terminal === 'object'
      ? { id: 'terminal', name: `结论：${String((payload.terminal as Record<string, unknown>).outcome ?? '完成')}`, value: 'terminal', x: 80 + steps.length * 180, y: 120, symbolSize: 70, itemStyle: { color: '#eab308' }, label: { show: true, formatter: '最终结论', color: '#fff', fontSize: 11, width: 140, overflow: 'break' as const } }
      : null
    if (terminal) nodes.push(terminal)
    return {
      backgroundColor: 'transparent', tooltip: { trigger: 'item', formatter: (params: unknown) => {
        const data = (params as { data?: { value?: string } })?.data
        return tooltipText(data?.value ? stepByKey.get(data.value) : undefined)
      } },
      series: [{ type: 'graph', layout: 'none', roam: true, data: nodes,
        links: nodes.slice(1).map((node, index) => ({ source: nodes[index].id, target: node.id, lineStyle: { color: '#4b89c7', width: 2 } })),
        lineStyle: { curveness: 0.12 }, edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 8 }]
    }
  }, [payload, steps])
  const { ref } = useEChart(option)
  if (!option) return <div className="pa-empty">尚无决策路径。完成分析或导入包含 decision_trace 的 JSON 后，在此可视化展示。</div>
  return <div className="pa-flow"><p>蓝色节点为 AI 实际判断路径；黄色节点为最终结论。滚轮缩放、拖拽平移；下方保留每个节点的完整判断内容。</p><div ref={ref} className="pa-flow-canvas" />
    <div className="pa-flow-details">{steps.map((step, index) => <article key={`${step.nodeId}-${index}`} className="pa-flow-detail-card">
      <header><strong>§{step.nodeId}</strong><span className={step.answer === '是' ? 'yes' : step.answer === '否' ? 'no' : ''}>{step.answer || '未标注'}</span>{step.section && <em>{step.section}</em>}</header>
      <dl><dt>判断问题</dt><dd>{step.question || '—'}</dd>{step.reason && <><dt>判断依据</dt><dd>{step.reason}</dd></>}{step.barRange && <><dt>K 线范围</dt><dd>{step.barRange}</dd></>}{step.branch && <><dt>分支</dt><dd>{step.branch}</dd></>}</dl>
      {step.extra && <pre>{step.extra}</pre>}
    </article>)}</div>
  </div>
}

interface TraceStep { nodeId: string; section: string; question: string; answer: string; reason: string; barRange: string; branch: string; extra: string }
function normaliseTrace(value: unknown): TraceStep[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (typeof item === 'string') return { nodeId: String(index + 1), section: '', question: item, answer: '', reason: '', barRange: '', branch: '', extra: '' }
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const used = new Set(['node_id', 'node', 'step', 'section', 'question', 'answer', 'result', 'reason', 'bar_range', 'branch'])
    const rest = Object.fromEntries(Object.entries(source).filter(([key]) => !used.has(key)))
    return {
      nodeId: String(source.node_id ?? source.node ?? source.step ?? index + 1), section: String(source.section ?? ''),
      question: String(source.question ?? ''), answer: String(source.answer ?? source.result ?? ''), reason: String(source.reason ?? ''),
      barRange: String(source.bar_range ?? ''), branch: String(source.branch ?? ''), extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
    }
  })
}
function tooltipText(step: TraceStep | undefined): string {
  if (!step) return '最终结论'
  return [`§${step.nodeId}${step.section ? ` · ${step.section}` : ''}`, step.question, `答案：${step.answer || '—'}`, step.reason && `依据：${step.reason}`, step.barRange && `K线：${step.barRange}`].filter(Boolean).join('<br/>')
}
