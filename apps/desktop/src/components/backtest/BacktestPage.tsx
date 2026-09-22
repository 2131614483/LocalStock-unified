import { useEffect, useState } from 'react'
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
  const [targetMessage, setTargetMessage] = useState('')

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

  useEffect(() => {
    setTargetMessage('')
  }, [backtestTarget])

  const replaceCurrentStrategyStock = (): void => {
    if (!backtestTarget) return
    const stock = secidToStrategyCode(backtestTarget.secid)
    const current = useBacktest.getState().code
    if (!/g\.stocks\s*=/.test(current)) {
      setTargetMessage('当前策略没有 g.stocks 股票池，无法自动替换。')
      return
    }
    const next = current.replace(/g\.stocks\s*=\s*\[[^\]]*\]/, `g.stocks = ['${stock}']`)
    if (next === current) {
      setTargetMessage('当前策略已使用该目标股票。')
      return
    }
    setCode(next)
    void saveCode(next).then(
      () => setTargetMessage(`已替换为 ${backtestTarget.name}（${stock}）。`),
      () => setTargetMessage('股票已替换，但自动保存失败；请稍后重试。')
    )
  }

  return (
    <div className="backtest-page">
      {backtestTarget && (
        <div className="backtest-target-bar">
          <span className="table-title">
            🎯 回测目标：{backtestTarget.name}（{backtestTarget.secid}）
          </span>
          <span className="editor-hint">可一键替换策略股票池</span>
          <button className="btn primary" onClick={replaceCurrentStrategyStock}>
            替换当前策略股票
          </button>
          <button className="btn" onClick={() => setBacktestTarget(null)}>
            清除目标
          </button>
          {targetMessage && <span className="editor-hint">{targetMessage}</span>}
        </div>
      )}
      <DataDownloadPanel />
      <StrategyEditor />
      {error && <div className="backtest-error">⚠ {error}</div>}
      {result && <BacktestResult />}
    </div>
  )
}
