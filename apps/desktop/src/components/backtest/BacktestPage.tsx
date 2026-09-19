import { useEffect } from 'react'
import { useBacktest } from '../../store/backtest'
import { useApp } from '../../store/app'
import DataDownloadPanel from './DataDownloadPanel'
import StrategyEditor from './StrategyEditor'
import BacktestResult from './BacktestResult'

/** secid "0.000858" -> 策略代码 "000858.XSHE" */
function secidToStrategyCode(secid: string): string {
  const [m, code] = secid.split('.')
  return `${code}.${m === '1' ? 'XSHG' : 'XSHE'}`
}

export default function BacktestPage() {
  const loadDataStatus = useBacktest((s) => s.loadDataStatus)
  const loadTemplates = useBacktest((s) => s.loadTemplates)
  const error = useBacktest((s) => s.error)
  const result = useBacktest((s) => s.result)
  const backtestTarget = useApp((s) => s.backtestTarget)
  const setBacktestTarget = useApp((s) => s.setBacktestTarget)

  // 订阅下载进度推送
  useEffect(() => {
    const off = window.api.backtest.onDownloadProgress(
      useBacktest.getState().setDownloadProgress
    )
    return off
  }, [])

  useEffect(() => {
    void loadDataStatus()
    void loadTemplates()
  }, [loadDataStatus, loadTemplates])

  // 从详情页跳转：把目标股票自动填入策略代码的 g.stocks
  useEffect(() => {
    if (backtestTarget) {
      const stock = secidToStrategyCode(backtestTarget.secid)
      const current = useBacktest.getState().code
      if (/g\.stocks\s*=/.test(current)) {
        const next = current.replace(/g\.stocks\s*=\s*\[[^\]]*\]/, `g.stocks = ['${stock}']`)
        if (next !== current) useBacktest.getState().setCode(next)
      }
    }
  }, [backtestTarget])

  return (
    <div className="backtest-page">
      {backtestTarget && (
        <div className="backtest-target-bar">
          <span className="table-title">
            🎯 回测目标：{backtestTarget.name}（{backtestTarget.secid}）
          </span>
          <span className="editor-hint">已自动填入策略股票池</span>
          <button className="btn" onClick={() => setBacktestTarget(null)}>
            清除目标
          </button>
        </div>
      )}
      <DataDownloadPanel />
      <StrategyEditor />
      {error && <div className="backtest-error">⚠ {error}</div>}
      {result && <BacktestResult />}
    </div>
  )
}
