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
  const workspaceReady = useBacktest((s) => s.workspaceReady)
  const setCode = useBacktest((s) => s.setCode)
  const saveCode = useBacktest((s) => s.saveCode)
  const error = useBacktest((s) => s.error)
  const result = useBacktest((s) => s.result)
  const backtestTarget = useApp((s) => s.backtestTarget)
  const setBacktestTarget = useApp((s) => s.setBacktestTarget)
  const loadBacktestTarget = useApp((s) => s.loadBacktestTarget)

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
    void loadBacktestTarget()
  }, [loadDataStatus, loadTemplates, loadBacktestTarget])

  // 从详情页跳转：把目标股票自动填入策略代码的 g.stocks
  useEffect(() => {
    if (workspaceReady && backtestTarget) {
      const stock = secidToStrategyCode(backtestTarget.secid)
      const current = useBacktest.getState().code
      if (/g\.stocks\s*=/.test(current)) {
        const next = current.replace(/g\.stocks\s*=\s*\[[^\]]*\]/, `g.stocks = ['${stock}']`)
        if (next !== current) {
          setCode(next)
          // 详情页带入的股票也是工作区改动，立即落盘，避免刷新后又回到模板默认股票。
          void saveCode(next).catch(() => {})
        }
      }
    }
  }, [backtestTarget, saveCode, setCode, workspaceReady])

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
