import { useState } from 'react'
import type { MinuteAnnotation, MinuteResult } from '../../shared/types'
import { getMarketStatus } from '../../shared/market-session'
import { useAi } from '../store/ai'

const QUICK_ACTIONS = [
  { key: 'close', label: '预测收盘', intent: '预测今日收盘价，画 hline 收盘预测' },
  { key: 'support', label: '支撑压力', intent: '画出关键支撑位与压力位（hline）' },
  { key: 'trend', label: '剩余走势', intent: '画出今日剩余时间可能走势（segment/ray 趋势线到收盘）' },
  { key: 'next', label: '预测次日', intent: '已临近收盘/已收盘，预测次日走势（趋势线画到 239 或标次日目标价）' }
]

interface Props {
  secid: string
  name: string
  minute: MinuteResult | null
  annotations: MinuteAnnotation[]
  opinion: string
  loading: boolean
  onAnalyze(intent: string): void
  onRemove(id: string): void
  onClear(): void
}

const TYPE_LABEL: Record<string, string> = {
  hline: '水平线',
  segment: '线段',
  ray: '射线',
  markArea: '区域',
  markPoint: '目标点'
}

export default function MinutePredictPanel({
  secid,
  name,
  minute,
  annotations,
  opinion,
  loading,
  onAnalyze,
  onRemove,
  onClear
}: Props) {
  const [prompt, setPrompt] = useState('')
  const market = getMarketStatus()

  const handleChat = (): void => {
    const intent = prompt.trim()
    useAi.getState().setPanelOpen(true)
    void useAi
      .getState()
      .send(
        `请分析 ${name}（${secid}）的当日分时走势。先用 minute_analyze 工具得到结构化预测标注，再用 apply_minute_annotations 工具把它画到分时图上，然后解释你的判断依据。${intent ? `\n补充要求：${intent}` : ''}`,
        { viewType: 'minute', secid, name, extra: intent || market.label }
      )
  }

  return (
    <div className="minute-predict">
      <div className="minute-predict-head">
        <span className="panel-title">AI 分时预测</span>
        <span className={`mp-market mp-market-${market.isTrading ? 'trading' : market.phase === 'closed' ? 'closed' : 'idle'}`}>
          {market.label}
          <em>{market.nextLabel}</em>
        </span>
      </div>

      <div className="mp-quick">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            className="btn"
            disabled={loading || !minute}
            onClick={() => onAnalyze(a.intent)}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="mp-legend" title="AI 画线图例说明">
        <span className="mp-legend-item">
          <i className="mp-legend-line" style={{ background: '#f5222d' }} />
          压力/看跌
        </span>
        <span className="mp-legend-item">
          <i className="mp-legend-line" style={{ background: '#14b143' }} />
          支撑/看涨
        </span>
        <span className="mp-legend-item">
          <i className="mp-legend-line dashed" style={{ color: '#2f81f7' }} />
          预测趋势
        </span>
        <span className="mp-legend-item">
          <i className="mp-legend-point" style={{ background: '#2f81f7' }} />
          目标价
        </span>
        <span className="mp-legend-item">
          <i className="mp-legend-area" style={{ background: 'rgba(47,129,247,0.18)' }} />
          预测区间
        </span>
      </div>

      <div className="mp-opinion">
        {loading ? (
          <span className="mp-loading">AI 分析中…</span>
        ) : opinion ? (
          <span>{opinion}</span>
        ) : (
          <span className="mp-hint">点上方按钮生成预测；AI 会基于剩余交易时间（{market.isTrading ? `${market.minutesLeft} 分钟` : '已收盘/休市'}）判断走势。</span>
        )}
      </div>

      <div className="mp-annotations">
        <div className="mp-annotations-title">
          标注（{annotations.length}）
          {annotations.length > 0 && (
            <button className="btn" onClick={onClear}>
              清空
            </button>
          )}
        </div>
        {annotations.length === 0 && <div className="mp-empty">暂无标注，预测结果会画在左侧分时图上</div>}
        {annotations.map((a) => (
          <div key={a.id} className="mp-annot">
            <span className="mp-annot-type">{TYPE_LABEL[a.type] ?? a.type}</span>
            <span className="mp-annot-price" style={{ color: a.color }}>
              {a.y1?.toFixed(2)}
              {a.y2 ? ` ~ ${a.y2.toFixed(2)}` : ''}
            </span>
            {a.label && <span className="mp-annot-label">{a.label}</span>}
            <button className="row-action" title="删除" onClick={() => onRemove(a.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mp-chat">
        <input
          className="input"
          placeholder="提问/追加要求（走 AI 对话，可追问依据）…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button className="btn primary" disabled={loading} onClick={handleChat}>
          对话
        </button>
      </div>
    </div>
  )
}
