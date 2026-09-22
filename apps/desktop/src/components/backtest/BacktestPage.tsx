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

type StockReplaceKind = 'pool' | 'single' | 'none'

/**
 * 把策略中实际参与交易的固定标的替换为回测目标。
 * 兼容常用的 g.stocks = [...]、单行动态赋值以及 g.stock = '...' 写法；
 * 刻意不向未知策略强塞 g.stocks，避免“显示已替换但策略根本没有使用它”。
 */
function replaceStrategyStock(code: string, stock: string): { code: string; kind: StockReplaceKind } {
  const poolLiteral = /\bg\s*\.\s*stocks\s*=\s*\[[\s\S]*?\]/
  if (poolLiteral.test(code)) {
    return { code: code.replace(poolLiteral, `g.stocks = ['${stock}']`), kind: 'pool' }
  }

  const poolAssignment = /^([\t ]*)g\s*\.\s*stocks\s*=\s*[^\r\n]*/m
  if (poolAssignment.test(code)) {
    return { code: code.replace(poolAssignment, "$1g.stocks = ['" + stock + "']"), kind: 'pool' }
  }

  const singleStock = /\bg\s*\.\s*stock\s*=\s*(['"])[^'"\r\n]*\1/
  if (singleStock.test(code)) {
    return { code: code.replace(singleStock, `g.stock = '${stock}'`), kind: 'single' }
  }

  return { code, kind: 'none' }
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

  // 从详情页跳转：仅在工作区策略完成恢复后，才自动替换固定股票池。
  // 否则异步加载会把空代码误判成“没有股票池”。
  useEffect(() => {
    if (workspaceReady && backtestTarget) {
      const stock = secidToStrategyCode(backtestTarget.secid)
      const current = useBacktest.getState().code
      const replacement = replaceStrategyStock(current, stock)
      if (replacement.kind !== 'none' && replacement.code !== current) {
        setCode(replacement.code)
        // 详情页带入的股票也是工作区改动，立即落盘，避免刷新后又回到模板默认股票。
        void saveCode(replacement.code).catch(() => {})
      }
    }
  }, [backtestTarget, saveCode, setCode, workspaceReady])

  useEffect(() => {
    setTargetMessage('')
  }, [backtestTarget])

  const replaceCurrentStrategyStock = (): void => {
    if (!backtestTarget) return
    if (!workspaceReady) {
      setTargetMessage('策略正在载入，请稍候再替换。')
      return
    }
    const stock = secidToStrategyCode(backtestTarget.secid)
    const current = useBacktest.getState().code
    const replacement = replaceStrategyStock(current, stock)
    if (replacement.kind === 'none') {
      setTargetMessage('当前策略没有可识别的固定股票标的（g.stocks 或 g.stock），未修改策略。')
      return
    }
    const next = replacement.code
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
          <button className="btn primary" onClick={replaceCurrentStrategyStock} disabled={!workspaceReady}>
            {workspaceReady ? '替换当前策略股票' : '策略载入中…'}
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
