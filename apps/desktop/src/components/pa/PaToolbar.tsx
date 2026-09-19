import { useEffect, useRef, useState } from 'react'
import type { PaAnalysisMode, PaServiceConfig, PaSymbol, PaTimeframe } from '../../../shared/types'
import { usePa } from '../../store/pa'
import PaImportResultDialog from './PaImportResultDialog'

const TIMEFRAMES: { value: PaTimeframe; label: string }[] = [
  { value: '1d', label: '日线' },
  { value: '1w', label: '周线' },
  { value: '1M', label: '月线' }
]

const MODES: { value: PaAnalysisMode; label: string; desc: string }[] = [
  { value: 'original', label: '原始过程', desc: '保留完整二阶段上下文，适合复盘' },
  { value: 'optimized', label: '优化过程', desc: '精简重复上下文，速度更快' }
]

export default function PaToolbar() {
  const {
    symbol,
    symbolName,
    timeframe,
    barCount,
    analysisMode,
    config,
    running,
    status,
    server,
    setSymbol,
    setTimeframe,
    setBarCount,
    setAnalysisMode,
    saveConfig,
    analyze,
    cancel
  } = usePa()

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<PaSymbol[]>([])
  const [open, setOpen] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const [showImport, setShowImport] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // 服务状态由 PaView 的 watchServer 统一订阅，这里不重复拉取

  // 点击外部关闭搜索下拉
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    const q = keyword.trim()
    if (!q) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.pa
        .searchSymbols(q, 20)
        .then((rows) => {
          if (!cancelled) {
            setResults(rows)
            setOpen(true)
          }
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [keyword])

  const pick = (item: PaSymbol): void => {
    setSymbol(item.symbol, item.name)
    setKeyword('')
    setResults([])
    setOpen(false)
  }

  const connected = status?.connected === true
  const serverState = server?.state ?? 'stopped'
  const ready = serverState === 'ready' && connected
  const connLabel =
    serverState === 'starting'
      ? '服务启动中…'
      : serverState === 'no-deps'
        ? '需安装运行环境'
        : serverState === 'error'
          ? '服务异常'
          : ready
            ? `服务已连接 · ${status?.symbolCount ?? 0} 只`
            : '服务未运行'

  return (
    <div className="pa-toolbar">
      <div className="pa-field">
        <label>版本</label>
        <select
          value={config?.profile ?? 'stable'}
          disabled={running}
          title="稳定版沿用原策略；激进版采用 PA_Agent_624 的连续性校验、双止盈与走势预期"
          onChange={(e) => void saveConfig({ profile: e.target.value as PaServiceConfig['profile'] })}
        >
          <option value="stable">稳定版</option>
          <option value="aggressive">激进版</option>
        </select>
      </div>
      <div className="pa-field pa-symbol-field" ref={boxRef}>
        <label>股票</label>
        <input
          className="pa-symbol-input"
          value={open ? keyword : symbol}
          placeholder="代码或名称"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setKeyword(e.target.value)
            setOpen(true)
          }}
        />
        {symbolName && !open && <span className="pa-symbol-name">{symbolName}</span>}
        {open && results.length > 0 && (
          <div className="pa-suggest">
            {results.map((r) => (
              <div key={r.symbol} className="pa-suggest-item" onClick={() => pick(r)}>
                <span>{r.symbol}</span>
                <span className="pa-suggest-name">{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pa-field">
        <label>周期</label>
        <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as PaTimeframe)}>
          {TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="pa-field">
        <label>K线数</label>
        <input
          type="number"
          min={30}
          max={500}
          step={10}
          value={barCount}
          onChange={(e) => setBarCount(Number(e.target.value))}
        />
      </div>

      <div className="pa-field">
        <label>分析过程</label>
        <select
          value={analysisMode}
          onChange={(e) => setAnalysisMode(e.target.value as PaAnalysisMode)}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.desc}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="pa-actions">
        <button type="button" className="pa-btn" disabled={running} onClick={() => setShowImport(true)}>粘贴 JSON 渲染</button>
        <button
          type="button"
          className="pa-btn"
          disabled={!ready || running}
          title={ready ? '导出当前版本的两阶段本地 TXT 分析包，不调用大模型' : connLabel}
          onClick={() => {
            setExportMsg('正在导出…')
            void window.api.pa.exportOffline({ symbol, timeframe, barCount, analysisMode })
              .then((result) => setExportMsg(`已导出至：${result.directory}`))
              .catch((err: unknown) => setExportMsg(`导出失败：${err instanceof Error ? err.message : String(err)}`))
          }}
        >
          导出本地 TXT
        </button>
        {running ? (
          <button type="button" className="pa-btn pa-btn-danger" onClick={() => void cancel()}>
            取消分析
          </button>
        ) : (
          <button
            type="button"
            className="pa-btn pa-btn-primary"
            disabled={!ready}
            title={ready ? undefined : connLabel}
            onClick={() => void analyze()}
          >
            开始分析
          </button>
        )}
      </div>

      <div className={`pa-conn ${ready ? 'ok' : 'bad'}`}>
        <span title={status?.error ?? server?.error ?? server?.baseUrl ?? ''}>{connLabel}</span>
        {exportMsg && <span className="pa-export-msg" title={exportMsg}>{exportMsg}</span>}
      </div>
      {showImport && <PaImportResultDialog onClose={() => setShowImport(false)} />}
    </div>
  )
}
