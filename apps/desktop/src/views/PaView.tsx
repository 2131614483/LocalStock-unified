import { useEffect, useState } from 'react'
import PaToolbar from '../components/pa/PaToolbar'
import PaKlineChart from '../components/pa/PaKlineChart'
import PaStreamPanel from '../components/pa/PaStreamPanel'
import PaDiagnosisPanel from '../components/pa/PaDiagnosisPanel'
import PaDecisionPanel from '../components/pa/PaDecisionPanel'
import PaRawPanel from '../components/pa/PaRawPanel'
import PaServerBanner from '../components/pa/PaServerBanner'
import PaStrategyLibraryPanel from '../components/pa/PaStrategyLibraryPanel'
import PaDecisionFlowPanel from '../components/pa/PaDecisionFlowPanel'
import PaFutureTrendPanel from '../components/pa/PaFutureTrendPanel'
import SplitPane from '../components/SplitPane'
import { usePa } from '../store/pa'

type Tab = 'stream' | 'diagnosis' | 'decision' | 'flow' | 'future' | 'strategy' | 'raw'

const TABS: { key: Tab; label: string }[] = [
  { key: 'stream', label: '实时' },
  { key: 'diagnosis', label: '市场诊断' },
  { key: 'decision', label: '交易决策' },
  { key: 'flow', label: '决策树可视化' },
  { key: 'future', label: '未来走势预期' },
  { key: 'strategy', label: '双策略库' },
  { key: 'raw', label: '原始' }
]

/** 价格行为 AI 页（移植自 PA_Agent_616，界面以 React 重写） */
export default function PaView() {
  const [tab, setTab] = useState<Tab>('stream')
  const loadConfig = usePa((s) => s.loadConfig)
  const loadKline = usePa((s) => s.loadKline)
  const record = usePa((s) => s.record)
  const kline = usePa((s) => s.kline)
  const klineLoading = usePa((s) => s.klineLoading)
  const running = usePa((s) => s.running)
  const symbol = usePa((s) => s.symbol)

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  // 订阅主进程托管的服务状态（启动中/就绪/依赖缺失/错误）
  useEffect(() => {
    const off = usePa.getState().watchServer()
    return off
  }, [])

  // 切换股票/周期时刷新行情（分析期间不打断）
  useEffect(() => {
    if (!running) void loadKline()
  }, [symbol, loadKline, running])

  // 有结果后自动切到「交易决策」，便于直接看结论
  useEffect(() => {
    if (record?.stage2_decision) setTab('decision')
  }, [record])

  const decision = record?.stage2_decision?.decision ?? null

  return (
    <div className="pa-page">
      <PaToolbar />
      <PaServerBanner />
      <SplitPane
        direction="horizontal"
        initial={520}
        min={320}
        max={900}
        storageKey="pa.split"
        reserveForSecond={260}
        className="pa-split"
      >
        <PaKlineChart kline={kline} loading={klineLoading} decision={decision} />
        <div className="pa-side">
          <div className="pa-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`pa-tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="pa-tab-body">
            {tab === 'stream' && <PaStreamPanel />}
            {tab === 'diagnosis' && <PaDiagnosisPanel />}
            {tab === 'decision' && <PaDecisionPanel />}
            {tab === 'flow' && <PaDecisionFlowPanel />}
            {tab === 'future' && <PaFutureTrendPanel />}
            {tab === 'strategy' && <PaStrategyLibraryPanel />}
            {tab === 'raw' && <PaRawPanel />}
          </div>
        </div>
      </SplitPane>
    </div>
  )
}
