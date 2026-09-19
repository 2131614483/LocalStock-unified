import { usePa } from '../../store/pa'

/** 阶段一「市场诊断」面板 */
export default function PaDiagnosisPanel() {
  const record = usePa((s) => s.record)
  const strategyFiles = usePa((s) => s.strategyFiles)
  const diagnosis = record?.stage1_diagnosis

  if (!diagnosis) {
    return <div className="pa-empty">尚无诊断结果。完成分析后在此展示阶段一的市场诊断。</div>
  }

  const signals = Array.isArray(diagnosis.key_signals) ? diagnosis.key_signals : []
  const patterns = Array.isArray(diagnosis.detected_patterns) ? diagnosis.detected_patterns : []

  return (
    <div className="pa-panel">
      <div className="pa-kv-grid">
        <Kv label="周期位置" value={diagnosis.cycle_position} />
        <Kv label="方向" value={diagnosis.direction} />
        <Kv label="诊断置信度" value={diagnosis.diagnosis_confidence} suffix="%" />
        <Kv label="市场阶段" value={diagnosis.market_phase} />
        <Kv label="闸门结论" value={diagnosis.gate_result} />
      </div>

      {diagnosis.entry_setup && (
        <section className="pa-block">
          <h4>入场设定</h4>
          <p>{diagnosis.entry_setup}</p>
        </section>
      )}

      {diagnosis.htf_context && (
        <section className="pa-block">
          <h4>大周期背景</h4>
          <p>{diagnosis.htf_context}</p>
        </section>
      )}

      {signals.length > 0 && (
        <section className="pa-block">
          <h4>关键信号</h4>
          <ul className="pa-list">
            {signals.map((s, i) => (
              <li key={i}>{typeof s === 'string' ? s : JSON.stringify(s)}</li>
            ))}
          </ul>
        </section>
      )}

      {patterns.length > 0 && (
        <section className="pa-block">
          <h4>识别形态</h4>
          <ul className="pa-list">
            {patterns.map((p, i) => (
              <li key={i}>{typeof p === 'string' ? p : JSON.stringify(p)}</li>
            ))}
          </ul>
        </section>
      )}

      {diagnosis.risk_warning && (
        <section className="pa-block pa-block-warn">
          <h4>风险提示</h4>
          <p>{diagnosis.risk_warning}</p>
        </section>
      )}

      {(strategyFiles.length > 0 || (diagnosis.strategy_files_needed?.length ?? 0) > 0) && (
        <section className="pa-block">
          <h4>路由到的策略文件</h4>
          <div className="pa-tags">
            {(strategyFiles.length ? strategyFiles : diagnosis.strategy_files_needed ?? []).map(
              (f) => (
                <span className="pa-tag" key={f}>
                  {f}
                </span>
              )
            )}
          </div>
        </section>
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
    value === null || value === undefined || value === '' ? '—' : `${String(value)}${suffix}`
  return (
    <div className="pa-kv">
      <span className="pa-kv-label">{label}</span>
      <span className="pa-kv-value">{text}</span>
    </div>
  )
}
