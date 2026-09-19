import { usePa } from '../../store/pa'

/** 激进版的两类预测独立呈现，而不是挤在交易决策文字里。 */
export default function PaFutureTrendPanel() {
  const payload = usePa((s) => s.record?.stage2_decision)
  const items = [
    ['下一根 K 线预期', payload?.next_bar_prediction],
    ['下一市场周期预期', payload?.next_cycle_prediction]
  ] as const
  if (!items.some(([, value]) => value && typeof value === 'object')) return <div className="pa-empty">当前结果没有未来走势预期。激进版分析完成后会在此显示。</div>
  return <div className="pa-panel pa-future-grid">{items.map(([title, value]) => {
    if (!value || typeof value !== 'object') return null
    const prediction = value as Record<string, unknown>
    const probs = prediction.probabilities && typeof prediction.probabilities === 'object' ? Object.entries(prediction.probabilities as Record<string, unknown>) : []
    return <section key={title} className="pa-future-card"><h3>{title}</h3><strong>{String(prediction.direction ?? prediction.prediction ?? prediction.cycle ?? (prediction.unpredictable ? '不可预测' : '—'))}</strong>
      {probs.length > 0 && <div className="pa-tags">{probs.map(([key, prob]) => <span key={key} className="pa-tag">{key} {String(prob)}%</span>)}</div>}
      <p>{String(prediction.reasoning ?? prediction.reason ?? prediction.basis ?? '未提供说明')}</p>
    </section>
  })}</div>
}
