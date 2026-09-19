import { usePa } from '../../store/pa'

const ORDER_TYPE_CLASS: Record<string, string> = {
  限价单: 'pa-order-limit',
  突破单: 'pa-order-stop',
  市价单: 'pa-order-market',
  不下单: 'pa-order-none'
}

/** 阶段二「交易决策」面板 */
export default function PaDecisionPanel() {
  const record = usePa((s) => s.record)
  const payload = record?.stage2_decision
  const decision = payload?.decision

  if (!decision) {
    return <div className="pa-empty">尚无交易决策。完成分析后在此展示阶段二的决策与依据。</div>
  }

  const orderType = decision.order_type ?? '—'
  const orderClass = ORDER_TYPE_CLASS[orderType] ?? ''
  const isNoOrder = orderType === '不下单'
  const factors = Array.isArray(decision.key_factors) ? decision.key_factors : []
  const watchPoints = Array.isArray(decision.watch_points) ? decision.watch_points : []

  return (
    <div className="pa-panel">
      <div className={`pa-order-banner ${orderClass}`}>
        <span className="pa-order-type">{orderType}</span>
        {decision.order_direction && <span className="pa-order-dir">{decision.order_direction}</span>}
      </div>

      <div className="pa-kv-grid">
        <Kv label="入场价" value={decision.entry_price} />
        <Kv label="止盈价" value={decision.take_profit_price} />
        <Kv label="第二止盈" value={decision.take_profit_price_2} />
        <Kv label="止损价" value={decision.stop_loss_price} />
        <Kv label="交易置信度" value={decision.trade_confidence} suffix="%" />
        <Kv label="预估胜率" value={decision.estimated_win_rate} suffix="%" />
      </div>

      {!isNoOrder && typeof decision.entry_price === 'number' && typeof decision.stop_loss_price === 'number' && (
        <RiskReward entry={decision.entry_price} stop={decision.stop_loss_price} target={decision.take_profit_price} />
      )}

      {decision.reasoning && (
        <section className="pa-block">
          <h4>决策依据</h4>
          <p>{decision.reasoning}</p>
        </section>
      )}

      {factors.length > 0 && (
        <section className="pa-block">
          <h4>关键因素</h4>
          <ul className="pa-list">
            {factors.map((f, i) => (
              <li key={i}>{typeof f === 'string' ? f : JSON.stringify(f)}</li>
            ))}
          </ul>
        </section>
      )}

      {watchPoints.length > 0 && (
        <section className="pa-block">
          <h4>观察要点</h4>
          <ul className="pa-list">
            {watchPoints.map((w, i) => (
              <li key={i}>{typeof w === 'string' ? w : JSON.stringify(w)}</li>
            ))}
          </ul>
        </section>
      )}

      {decision.risk_assessment && (
        <section className="pa-block pa-block-warn">
          <h4>风险评价</h4>
          <p>{decision.risk_assessment}</p>
        </section>
      )}

      {decision.invalidation_condition && (
        <section className="pa-block">
          <h4>失效条件</h4>
          <p>{decision.invalidation_condition}</p>
        </section>
      )}

      {payload?.decision_trace && payload.decision_trace.length > 0 && (
        <section className="pa-block">
          <h4>决策树路径（{payload.decision_trace.length} 步）</h4>
          <ol className="pa-list pa-trace">
            {payload.decision_trace.map((step, i) => (
              <li key={i}>{renderStep(step)}</li>
            ))}
          </ol>
        </section>
      )}

      {Boolean(payload?.next_bar_prediction) && (
        <section className="pa-block">
          <h4>下一根 K 线预期</h4>
          <p>{formatPrediction(payload.next_bar_prediction)}</p>
        </section>
      )}
      {Boolean(payload?.next_cycle_prediction) && (
        <section className="pa-block">
          <h4>下一市场周期预期</h4>
          <p>{formatPrediction(payload.next_cycle_prediction)}</p>
        </section>
      )}
    </div>
  )
}

function formatPrediction(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '—')
  const p = value as Record<string, unknown>
  const headline = p.direction ?? p.cycle ?? p.prediction ?? '—'
  const reason = p.reasoning ?? p.reason ?? p.basis
  return reason ? `${String(headline)} · ${String(reason)}` : String(headline)
}

function renderStep(step: unknown): string {
  if (typeof step === 'string') return step
  if (step && typeof step === 'object') {
    const o = step as Record<string, unknown>
    const q = o.question ?? o.node ?? o.step
    const r = o.reason ?? o.answer ?? o.result
    if (q || r) return [q, r].filter(Boolean).map(String).join(' → ')
    return JSON.stringify(step)
  }
  return String(step)
}

function RiskReward({
  entry,
  stop,
  target
}: {
  entry: number
  stop: number
  target?: number | null
}) {
  const risk = Math.abs(entry - stop)
  if (risk <= 0) return null
  const reward = typeof target === 'number' ? Math.abs(target - entry) : null
  const ratio = reward === null ? null : reward / risk
  return (
    <div className="pa-risk">
      <span>
        风险 <strong>{risk.toFixed(2)}</strong>
      </span>
      {reward !== null && (
        <span>
          报酬 <strong>{reward.toFixed(2)}</strong>
        </span>
      )}
      {ratio !== null && (
        <span className={ratio >= 2 ? 'pa-good' : ratio >= 1 ? '' : 'pa-bad'}>
          盈亏比 <strong>{ratio.toFixed(2)}</strong>
        </span>
      )}
    </div>
  )
}

function Kv({
  label,
  value,
  suffix = ''
}: {
  label: string
  value: unknown
  suffix?: string
}) {
  const text =
    value === null || value === undefined || value === ''
      ? '—'
      : typeof value === 'number'
        ? `${value.toFixed(2)}${suffix}`
        : `${String(value)}${suffix}`
  return (
    <div className="pa-kv">
      <span className="pa-kv-label">{label}</span>
      <span className="pa-kv-value">{text}</span>
    </div>
  )
}
