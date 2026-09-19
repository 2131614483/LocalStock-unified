import type { IndicatorConfig } from '../lib/indicators'

interface Props {
  config: IndicatorConfig
  onChange: (c: IndicatorConfig) => void
}

const ITEMS: Array<{ key: keyof IndicatorConfig; label: string }> = [
  { key: 'macd', label: 'MACD' },
  { key: 'kdj', label: 'KDJ' },
  { key: 'rsi', label: 'RSI' }
]

/** 指标副图显示/隐藏开关（勾选即显示，配置持久化到 settings） */
export default function IndicatorToggles({ config, onChange }: Props) {
  return (
    <div className="chart-indicators">
      <span className="chart-indicators-label">指标</span>
      {ITEMS.map((it) => (
        <label key={it.key} className="chart-indicator-item" title={`显示/隐藏 ${it.label}`}>
          <input
            type="checkbox"
            checked={config[it.key]}
            onChange={() => onChange({ ...config, [it.key]: !config[it.key] })}
          />
          {it.label}
        </label>
      ))}
    </div>
  )
}
