import { useEffect, useState } from 'react'
import type { AlertRule, AlertRuleType, WatchItem } from '../../shared/types'

const TYPES: Array<{ key: AlertRuleType; label: string }> = [
  { key: 'ma_cross', label: '均线金叉/死叉' },
  { key: 'price_above', label: '价格上破' },
  { key: 'price_below', label: '价格下破' },
  { key: 'volume_spike', label: '量能放大' }
]

const TYPE_LABEL: Record<AlertRuleType, string> = {
  ma_cross: '均线金叉/死叉',
  price_above: '价格上破',
  price_below: '价格下破',
  volume_spike: '量能放大'
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])
  const [secid, setSecid] = useState('')
  const [type, setType] = useState<AlertRuleType>('ma_cross')
  const [fast, setFast] = useState('5')
  const [slow, setSlow] = useState('20')
  const [threshold, setThreshold] = useState('')
  const [scanMsg, setScanMsg] = useState('')

  const load = async (): Promise<void> => {
    const [rs, wl] = await Promise.all([window.api.alerts.list(), window.api.watchlist.list()])
    setRules(rs)
    setWatchlist(wl)
    if (!secid && wl.length) setSecid(wl[0].secid)
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addRule = async (): Promise<void> => {
    if (!secid) return
    const item = watchlist.find((w) => w.secid === secid)
    const rule: AlertRule = {
      id: '',
      secid,
      name: item?.name ?? secid,
      type,
      fast: type === 'ma_cross' || type === 'volume_spike' ? Number(fast) || undefined : undefined,
      slow: type === 'ma_cross' ? Number(slow) || undefined : undefined,
      threshold:
        type === 'price_above' || type === 'price_below' || type === 'volume_spike'
          ? Number(threshold) || undefined
          : undefined,
      enabled: true
    }
    setRules(await window.api.alerts.add(rule))
  }

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    setRules(await window.api.alerts.toggle(id, enabled))
  }
  const remove = async (id: string): Promise<void> => {
    setRules(await window.api.alerts.remove(id))
  }
  const scanNow = async (): Promise<void> => {
    const r = await window.api.alerts.scanNow()
    setScanMsg(`扫描 ${r.scanned} 条规则，触发 ${r.fired} 条预警`)
  }

  return (
    <div className="backtest-page">
      <div className="table-card" style={{ padding: '12px 16px' }}>
        <div className="table-title">预警规则</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <select
            className="input"
            value={secid}
            onChange={(e) => setSecid(e.target.value)}
            title="监控股票"
          >
            {watchlist.map((w) => (
              <option key={w.secid} value={w.secid}>
                {w.name}
              </option>
            ))}
          </select>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as AlertRuleType)}>
            {TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {(type === 'ma_cross' || type === 'volume_spike') && (
            <input
              className="input"
              style={{ width: 56 }}
              placeholder="快线"
              value={fast}
              onChange={(e) => setFast(e.target.value)}
            />
          )}
          {type === 'ma_cross' && (
            <input
              className="input"
              style={{ width: 56 }}
              placeholder="慢线"
              value={slow}
              onChange={(e) => setSlow(e.target.value)}
            />
          )}
          {(type === 'price_above' || type === 'price_below' || type === 'volume_spike') && (
            <input
              className="input"
              style={{ width: 80 }}
              placeholder={type === 'volume_spike' ? '量比' : '阈值'}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          )}
          <button className="btn primary" onClick={() => void addRule()}>
            添加规则
          </button>
          <button className="btn" onClick={() => void scanNow()}>
            立即扫描
          </button>
          {scanMsg && <span className="backtest-target-bar">{scanMsg}</span>}
        </div>
      </div>

      <div className="table-card" style={{ marginTop: 12 }}>
        {rules.length === 0 ? (
          <div className="empty">暂无预警规则，上方添加（支持均线金叉/死叉、价格突破、量能放大）</div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th>股票</th>
                <th>规则</th>
                <th>参数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{TYPE_LABEL[r.type]}</td>
                  <td>
                    {r.type === 'ma_cross' ? `MA${r.fast ?? 5}/${r.slow ?? 20}` : ''}
                    {r.type === 'volume_spike' ? `窗口${r.fast ?? 20} 量比${r.threshold ?? 2}` : ''}
                    {r.type === 'price_above' || r.type === 'price_below' ? `阈值 ${r.threshold ?? 0}` : ''}
                  </td>
                  <td>
                    <label title="启用/停用">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={() => void toggle(r.id, !r.enabled)}
                      />
                    </label>
                  </td>
                  <td>
                    <button className="btn" onClick={() => void remove(r.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
