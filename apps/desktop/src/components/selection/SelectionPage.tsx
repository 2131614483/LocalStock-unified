import { useEffect, useMemo, useState } from 'react'
import type { SelectionFilter, SelectionHit, SelectionRule } from '../../../shared/types'
import { useSelection, emptyRule } from '../../store/selection'
import { useApp } from '../../store/app'
import { useAi } from '../../store/ai'

/** 筛选条件定义（表单参数） */
const FILTER_DEFS: Array<{
  kind: SelectionFilter['kind']
  label: string
  params: Array<{ key: string; label: string }>
}> = [
  { kind: 'ma_cross', label: '均线金叉', params: [{ key: 'fast', label: '快线' }, { key: 'slow', label: '慢线' }, { key: 'within', label: '近N日' }] },
  { kind: 'ma_align', label: '均线多头', params: [{ key: 'shorts', label: '短周期,逗号' }, { key: 'longs', label: '长周期,逗号' }] },
  { kind: 'price_breakout', label: '突破新高', params: [{ key: 'lookback', label: '回看N日' }, { key: 'pct', label: '突破%' }] },
  { kind: 'volume_surge', label: '放量', params: [{ key: 'ratio', label: '量比≥' }] },
  { kind: 'volume_shrink', label: '缩量', params: [{ key: 'ratio', label: '量比≤' }] },
  { kind: 'macd_cross', label: 'MACD交叉', params: [{ key: 'fast', label: '快' }, { key: 'slow', label: '慢' }, { key: 'signal', label: '信号' }] },
  { kind: 'rsi_range', label: 'RSI区间', params: [{ key: 'period', label: '周期' }, { key: 'min', label: '最小' }, { key: 'max', label: '最大' }] },
  { kind: 'change_pct_range', label: '涨跌幅%', params: [{ key: 'min', label: '最小' }, { key: 'max', label: '最大' }] },
  { kind: 'amount_range', label: '成交额', params: [{ key: 'min', label: '最小(亿)' }, { key: 'max', label: '最大(亿)' }] },
  { kind: 'turnover_range', label: '换手率%', params: [{ key: 'min', label: '最小' }, { key: 'max', label: '最大' }] },
  { kind: 'pe_range', label: '市盈率PE', params: [{ key: 'min', label: '最小' }, { key: 'max', label: '最大' }] },
  { kind: 'pb_range', label: '市净率PB', params: [{ key: 'min', label: '最小' }, { key: 'max', label: '最大' }] },
  { kind: 'mv_range', label: '总市值', params: [{ key: 'min', label: '最小(亿)' }, { key: 'max', label: '最大(亿)' }] },
  { kind: 'industry_in', label: '行业包含', params: [{ key: 'list', label: '行业,逗号' }] }
]

const YI = 1e8

/** 筛选条件 → 表单字符串值（amount/mv 转亿显示） */
function filterToParams(f: SelectionFilter): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(f)) {
    if (k === 'kind') continue
    if (Array.isArray(v)) out[k] = v.join(',')
    else if (v !== undefined && v !== null) out[k] = String(v)
  }
  if (f.kind === 'amount_range' || f.kind === 'mv_range') {
    for (const k of ['min', 'max']) {
      if (out[k] !== undefined) out[k] = String(Math.round((Number(out[k]) / YI) * 100) / 100)
    }
  }
  return out
}

/** 表单字符串值 → 筛选条件（amount/mv 转回元） */
function paramsToFilter(kind: SelectionFilter['kind'], p: Record<string, string>): SelectionFilter {
  const f: Record<string, unknown> = { kind }
  const conv = kind === 'amount_range' || kind === 'mv_range'
  for (const [k, v] of Object.entries(p)) {
    if (v === '' || v === undefined) continue
    if (k === 'shorts' || k === 'longs' || k === 'list') {
      f[k] = String(v)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (k === 'list' ? s : Number(s)))
    } else {
      f[k] = conv ? Number(v) * YI : Number(v)
    }
  }
  return f as SelectionFilter
}

function FilterEditor({ rule, setRule }: { rule: SelectionRule; setRule: (r: SelectionRule) => void }) {
  const addFilter = (): void => {
    const kind = FILTER_DEFS[0].kind
    setRule({ ...rule, filters: [...rule.filters, paramsToFilter(kind, {})] })
  }
  return (
    <div className="sel-filters">
      <div className="sel-filters-title">
        筛选条件（全部满足）
        <button className="btn" onClick={addFilter}>+ 添加条件</button>
      </div>
      {rule.filters.length === 0 && <div className="sel-filters-empty">暂无条件 —— 不加条件则扫描全市场</div>}
      {rule.filters.map((f, i) => {
        const def = FILTER_DEFS.find((d) => d.kind === f.kind) ?? FILTER_DEFS[0]
        const params = filterToParams(f)
        const update = (p: Record<string, string>): void => {
          const next = rule.filters.slice()
          next[i] = paramsToFilter(def.kind, p)
          setRule({ ...rule, filters: next })
        }
        return (
          <div className="sel-filter-row" key={i}>
            <select
              value={f.kind}
              onChange={(e) => {
                const kind = e.target.value as SelectionFilter['kind']
                const next = rule.filters.slice()
                next[i] = paramsToFilter(kind, {})
                setRule({ ...rule, filters: next })
              }}
            >
              {FILTER_DEFS.map((d) => (
                <option key={d.kind} value={d.kind}>
                  {d.label}
                </option>
              ))}
            </select>
            {def.params.map((p) => (
              <input
                key={p.key}
                className="input"
                placeholder={p.label}
                style={{ width: 90 }}
                value={params[p.key] ?? ''}
                onChange={(e) => update({ ...params, [p.key]: e.target.value })}
              />
            ))}
            <button className="btn" onClick={() => setRule({ ...rule, filters: rule.filters.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

function ResultTable({ hits }: { hits: SelectionHit[] }) {
  const setView = useApp((s) => s.setView)
  const toggleWatchlist = useApp((s) => s.toggleWatchlist)
  const setBacktestTarget = useApp((s) => s.setBacktestTarget)
  const watchlist = useApp((s) => s.watchlist)
  return (
    <table className="stock-table sel-result-table">
      <thead>
        <tr>
          <th className="left">名称</th>
          <th>现价</th>
          <th>涨跌幅</th>
          <th className="left">命中理由</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {hits.map((h) => {
          const inWatch = watchlist.some((w) => w.secid === h.secid)
          return (
            <tr key={h.secid}>
              <td className="left">
                <span className="name-cell">
                  <span className="stock-name">{h.name}</span>
                  <span className="stock-code">{h.code}</span>
                </span>
              </td>
              <td>{h.price?.toFixed(2)}</td>
              <td className={(h.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{h.changePercent?.toFixed(2)}%</td>
              <td className="left sel-reasons">{h.reasons.join(' · ')}</td>
              <td>
                <button className="btn" onClick={() => setView({ type: 'detail', secid: h.secid, name: h.name })}>
                  详情
                </button>{' '}
                <button
                  className="btn"
                  onClick={() => {
                    setBacktestTarget({ secid: h.secid, name: h.name })
                    setView({ type: 'backtest' })
                  }}
                >
                  回测
                </button>{' '}
                {!inWatch && (
                  <button
                    className="btn"
                    onClick={() =>
                      void toggleWatchlist({ secid: h.secid, code: h.code, name: h.name })
                    }
                  >
                    加自选
                  </button>
                )}
              </td>
            </tr>
          )
        })}
        {hits.length === 0 && (
          <tr>
            <td colSpan={5} className="empty">
              暂无命中
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

export default function SelectionPage() {
  const { rules, results, scanning, error, load, save, remove, run } = useSelection()
  const setView = useApp((s) => s.setView)
  const [mode, setMode] = useState<'rule' | 'ai'>('rule')
  const [current, setCurrent] = useState<SelectionRule>(() => ({ ...emptyRule(), name: '放量突破' }))
  const [nl, setNl] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const latest = useMemo(() => results[0] ?? null, [results])

  const handleRun = (): void => {
    const rule = current.id ? current : { ...current, id: `tmp_${Date.now()}` }
    void run(rule)
  }

  const handleSave = (): void => {
    void save(current).then(() => void load())
  }

  const handleAi = (): void => {
    const prompt =
      '请分析当前市场，结合行情/技术面/基本面数据，选出 10 只值得关注的股票，逐只说明理由（一句话），然后用 save_selection_result 工具保存结果（ruleName 填当前规则名或「AI 智能选股」）。'
    useAi.getState().setPanelOpen(true)
    void useAi.getState().send(prompt, { viewType: 'selection', extra: nl.trim() || undefined })
  }

  const handleNlToRule = (): void => {
    const prompt = `请把以下自然语言选股条件转换成 save_selection_rule 的结构化规则（filters 数组，kind 用英文标识），并用 save_selection_rule 工具保存。\n\n${nl}`
    useAi.getState().setPanelOpen(true)
    void useAi.getState().send(prompt, { viewType: 'selection' })
  }

  return (
    <div className="backtest-page">
      <div className="sel-head">
        <div className="sel-title">
          自动选股
          <span className="table-total">规则 {rules.length} · 模式：</span>
        </div>
        <div className="sel-mode">
          <button className={`btn ${mode === 'rule' ? 'active' : ''}`} onClick={() => setMode('rule')}>
            规则引擎
          </button>
          <button className={`btn ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            AI 智能
          </button>
        </div>
      </div>

      {mode === 'rule' ? (
        <>
          <div className="editor-panel">
            <div className="template-list sel-rule-list">
              <div className="panel-title">我的规则</div>
              {rules.map((r) => (
                <div
                  key={r.id}
                  className={`template-item ${current.id === r.id ? 'active' : ''}`}
                  onClick={() => setCurrent({ ...r, filters: r.filters ?? [] })}
                >
                  {r.name}
                  <span className="sel-rule-mode">{r.mode === 'ai' ? 'AI' : '规则'}</span>
                  <span className="sel-rule-del" onClick={(e) => { e.stopPropagation(); void remove(r.id) }}>
                    ✕
                  </span>
                </div>
              ))}
            </div>
            <div className="editor-main">
              <div className="editor-head">
                <input
                  className="input"
                  placeholder="规则名称"
                  style={{ flex: 1 }}
                  value={current.name}
                  onChange={(e) => setCurrent({ ...current, name: e.target.value })}
                />
                <div className="editor-head-right">
                  <label className="param-label">
                    取前
                    <input
                      type="number"
                      style={{ width: 60 }}
                      value={current.top ?? 30}
                      onChange={(e) => setCurrent({ ...current, top: Number(e.target.value) })}
                    />
                    只
                  </label>
                  <label className="param-label">
                    排序
                    <select
                      value={current.sort?.field ?? 'changePercent'}
                      onChange={(e) =>
                        setCurrent({
                          ...current,
                          sort: { field: e.target.value, order: current.sort?.order ?? 'desc' }
                        })
                      }
                    >
                      <option value="changePercent">涨跌幅</option>
                      <option value="amount">成交额</option>
                      <option value="score">命中理由数</option>
                    </select>
                  </label>
                  <label className="param-label">
                    定时(分)
                    <input
                      type="number"
                      style={{ width: 60 }}
                      placeholder="关"
                      value={current.scheduleMinutes ?? ''}
                      onChange={(e) =>
                        setCurrent({
                          ...current,
                          scheduleMinutes: e.target.value ? Number(e.target.value) : null
                        })
                      }
                    />
                  </label>
                </div>
              </div>
              <FilterEditor rule={current} setRule={setCurrent} />
              <div className="sel-nl">
                <input
                  className="input"
                  placeholder="或用自然语言描述，让 AI 生成规则：如「近20日放量突破年线、PE<40、市值100-500亿」"
                  value={nl}
                  onChange={(e) => setNl(e.target.value)}
                />
                <button className="btn" disabled={!nl.trim()} onClick={handleNlToRule}>
                  AI 转规则
                </button>
              </div>
              <div className="sel-actions">
                <button className="btn" onClick={handleSave}>
                  保存规则
                </button>
                <button className="btn primary run-btn" disabled={scanning} onClick={handleRun}>
                  {scanning ? '扫描中…' : '▶ 开始选股'}
                </button>
              </div>
              {error && <div className="backtest-error">⚠ {error}</div>}
            </div>
          </div>
        </>
      ) : (
        <div className="editor-main" style={{ minHeight: 220 }}>
          <div className="panel-title">AI 智能选股</div>
          <div className="editor-hint">
            由 AI 结合行情/技术面/基本面数据分析并给出候选（会在右侧 AI 面板中执行）。可补充偏好描述。
          </div>
          <textarea
            className="code-editor"
            style={{ minHeight: 90 }}
            placeholder="可选：偏好/风险/行业/风格等，如「偏好低估值蓝筹、回避高位股」"
            value={nl}
            onChange={(e) => setNl(e.target.value)}
          />
          <button className="btn primary run-btn" onClick={handleAi}>
            ✦ 开始 AI 选股
          </button>
        </div>
      )}

      <div className="table-card">
        <div className="table-toolbar">
          <span className="table-title">
            最近结果
            <span className="table-total">
              {latest ? `${latest.ruleName} · ${latest.hits.length} 只命中（共扫 ${latest.total} 只）` : '暂无'}
            </span>
          </span>
          {latest && (
            <span className="updated-at">
              {new Date(latest.scannedAt).toLocaleString('zh-CN')}
            </span>
          )}
        </div>
        {latest ? (
          <ResultTable hits={latest.hits} />
        ) : (
          <div className="empty">还没有扫描结果，点「开始选股」或「AI 选股」</div>
        )}
      </div>

      {results.length > 1 && (
        <div className="sel-history">
          <div className="panel-title">历史结果</div>
          {results.slice(1, 8).map((r) => (
            <div className="history-item" key={r.id} onClick={() => setView({ type: 'selection' })}>
              <span className="history-version">{r.ruleName}</span>
              <span className="history-count">{r.hits.length} 只</span>
              <span className="history-time">{new Date(r.scannedAt).toLocaleString('zh-CN')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
