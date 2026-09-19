import { useEffect, useRef } from 'react'
import { paPhaseLabel, usePa } from '../../store/pa'

/** 「实时」面板：思考流 / 正文流 + 阶段进度 */
export default function PaStreamPanel() {
  const {
    running,
    phase,
    stage1Reasoning,
    stage1Content,
    stage2Reasoning,
    stage2Content,
    error,
    startedAt,
    finishedAt
  } = usePa()

  const bottomRef = useRef<HTMLDivElement>(null)
  const reasoning = stage1Reasoning + stage2Reasoning
  const content = stage1Content + stage2Content

  // 流式追加时自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [reasoning.length, content.length])

  const elapsed = startedAt ? Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000) : 0

  return (
    <div className="pa-panel">
      <div className="pa-status">
        <span className={`pa-phase pa-phase-${phase}`}>{paPhaseLabel(phase)}</span>
        {running && <span className="pa-hint">正在生成…</span>}
        {startedAt && <span className="pa-hint">已用时 {elapsed}s</span>}
      </div>

      {error && <div className="pa-error">{error}</div>}

      {!reasoning && !content && !error && (
        <div className="pa-empty">尚未开始分析。选择股票与周期后点击「开始分析」。</div>
      )}

      {reasoning && (
        <section className="pa-stream-block">
          <h4>思考过程</h4>
          <pre className="pa-stream pa-stream-reasoning">{reasoning}</pre>
        </section>
      )}

      {content && (
        <section className="pa-stream-block">
          <h4>模型输出</h4>
          <pre className="pa-stream">{content}</pre>
        </section>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
