import { useEffect, useState } from 'react'
import type {
  AiConfig,
  MarketDbInfo,
  MonitorConfig,
  QuantServiceConfig,
  QuantServiceStatus
} from '../../../shared/types'
import { useApp } from '../../store/app'
import { AI_PRESETS, parseProviderKey } from '../../lib/ai-config'
import {
  CHART_SHORTCUT_SETTING_KEY,
  CHART_SHORTCUT_LOCAL_KEY,
  DEFAULT_CHART_SHORTCUT_CONFIG,
  emitChartShortcutConfig,
  parseChartShortcutConfig,
  type ChartShortcutConfig
} from '../../lib/chart-shortcuts'

/** 行情库来源 → 界面文案（与主进程 MarketDbSource 对应） */
const DB_SOURCE_LABEL: Record<MarketDbInfo['source'], string> = {
  setting: '设置中指定',
  env: '环境变量 LOCALSTOCK_MARKET_DB',
  portable: '便携包同目录 data/',
  exe: '程序同目录 data/',
  userData: '用户数据目录（默认）'
}

/** 设置页：行情/图表/AI/监盘/回测/数据 集中配置（读 settings 表 + ai/monitor 配置 API） */
export default function SettingsPage() {
  const refreshInterval = useApp((s) => s.refreshInterval)
  const setRefreshInterval = useApp((s) => s.setRefreshInterval)
  const [ai, setAi] = useState<AiConfig | null>(null)
  const [mon, setMon] = useState<MonitorConfig | null>(null)
  const [pythonPath, setPythonPath] = useState('')
  const [strategyKnowledgePath, setStrategyKnowledgePath] = useState('D:\\来自：分享')
  const [chartHeight, setChartHeight] = useState(480)
  const [shortcuts, setShortcuts] = useState<ChartShortcutConfig>(DEFAULT_CHART_SHORTCUT_CONFIG)
  const [quant, setQuant] = useState<QuantServiceConfig | null>(null)
  const [quantStatus, setQuantStatus] = useState<QuantServiceStatus | null>(null)
  const [testingQuant, setTestingQuant] = useState(false)
  const [quick, setQuick] = useState('')
  const [quickHint, setQuickHint] = useState('')
  const [dbInfo, setDbInfo] = useState<MarketDbInfo | null>(null)
  const [dbBusy, setDbBusy] = useState(false)
  const [dbHint, setDbHint] = useState('')

  useEffect(() => {
    void window.api.ai.getConfig().then(setAi)
    void window.api.monitor.getState().then((s) => setMon(s.config))
    void window.api.settings.get('pythonPath').then((v) => setPythonPath(v ?? ''))
    void window.api.settings.get('ai.knowledge.strategyPath').then((v) => setStrategyKnowledgePath(v?.trim() || 'D:\\来自：分享'))
    void window.api.settings.get('chart.height').then((v) => setChartHeight(Number(v) || 480))
    void window.api.settings.get(CHART_SHORTCUT_SETTING_KEY).then((v) => {
      const config = parseChartShortcutConfig(v)
      setShortcuts(config)
      localStorage.setItem(CHART_SHORTCUT_LOCAL_KEY, JSON.stringify(config))
    })
    void window.api.quant.getConfig().then(setQuant)
    void window.api.marketDb.getInfo().then(setDbInfo)
  }, [])

  const saveAi = (patch: Partial<AiConfig>): void => {
    void window.api.ai.setConfig(patch).then(setAi)
  }
  const saveMon = (patch: Partial<MonitorConfig>): void => {
    void window.api.monitor.setConfig(patch).then((c) => setMon(c))
  }
  const setSetting = (key: string, value: string): void => {
    void window.api.settings.set(key, value)
  }
  const saveShortcuts = (patch: Partial<ChartShortcutConfig>): void => {
    setShortcuts((current) => {
      const next = { ...current, ...patch }
      void window.api.settings.set(CHART_SHORTCUT_SETTING_KEY, JSON.stringify(next))
      localStorage.setItem(CHART_SHORTCUT_LOCAL_KEY, JSON.stringify(next))
      emitChartShortcutConfig(next)
      return next
    })
  }
  const saveQuant = (patch: Partial<QuantServiceConfig>): void => {
    void window.api.quant.setConfig(patch).then((config) => {
      setQuant(config)
      setQuantStatus(null)
    }).catch((error) => {
      setQuantStatus({
        connected: false,
        baseUrl: quant?.baseUrl ?? '',
        checkedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      })
    })
  }
  const testQuant = (): void => {
    setTestingQuant(true)
    void window.api.quant.testConnection().then(setQuantStatus).finally(() => setTestingQuant(false))
  }

  /** 重新检测当前生效的行情库 */
  const refreshDb = (): void => {
    setDbBusy(true)
    void window.api.marketDb
      .getInfo()
      .then(setDbInfo)
      .finally(() => setDbBusy(false))
  }

  /** 选择行情库文件；校验通过才保存并切换 */
  const pickDb = (): void => {
    setDbBusy(true)
    setDbHint('')
    void window.api.marketDb
      .pick()
      .then(async (picked) => {
        if (!picked) return // 用户取消
        if (!picked.info.valid) {
          setDbInfo(picked.info)
          setDbHint(`该文件不可用：${picked.info.error ?? '无法读取'}`)
          return
        }
        const saved = await window.api.marketDb.setPath(picked.path)
        setDbInfo(saved)
        setDbHint('已切换，立即生效')
      })
      .catch((error: unknown) => {
        setDbHint(`切换失败：${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => setDbBusy(false))
  }

  /** 恢复默认解析顺序（环境变量 → 便携包同目录 → 用户数据目录） */
  const resetDb = (): void => {
    setDbBusy(true)
    setDbHint('')
    void window.api.marketDb
      .reset()
      .then((info) => {
        setDbInfo(info)
        setDbHint('已恢复默认位置')
      })
      .catch((error: unknown) => {
        setDbHint(`恢复失败：${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => setDbBusy(false))
  }

  const applyQuick = (v: string): void => {
    setQuick(v)
    const cfg = parseProviderKey(v)
    if (cfg) {
      saveAi(cfg)
      setQuickHint('✓ 已应用一键配置')
    } else {
      setQuickHint(v.trim() ? '格式：provider:sk-xxx（opencode-go / deepseek / anthropic / openai）' : '')
    }
  }

  return (
    <div className="settings-page">
      {/* 行情 */}
      <section className="settings-card">
        <div className="panel-title">行情</div>
        <label className="settings-row">
          刷新间隔
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
          >
            <option value={1000}>1 秒</option>
            <option value={3000}>3 秒</option>
            <option value={5000}>5 秒</option>
          </select>
        </label>
        <label className="settings-row">
          默认图表高度(px)
          <input
            type="number"
            min={200}
            max={900}
            value={chartHeight}
            onChange={(e) => {
              setChartHeight(Number(e.target.value))
              setSetting('chart.height', e.target.value)
            }}
          />
        </label>
      </section>

      {/* 图表快捷键 */}
      <section className="settings-card shortcuts-settings-card">
        <div className="settings-title-row">
          <div>
            <div className="panel-title">图表快捷键</div>
            <div className="settings-hint">仅在股票详情页生效；搜索框、代码编辑器和其他输入框内自动停用。</div>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={shortcuts.enabled}
              onChange={(e) => saveShortcuts({ enabled: e.target.checked })}
            />
            <span>{shortcuts.enabled ? '已启用' : '已停用'}</span>
          </label>
        </div>
        <label className="settings-row">
          快捷键模式
          <select
            value={shortcuts.mode}
            onChange={(e) => saveShortcuts({ mode: e.target.value as ChartShortcutConfig['mode'] })}
          >
            <option value="standard">标准模式（方向键为主）</option>
            <option value="professional">专业模式（增加 WASD / 数字键）</option>
          </select>
        </label>
        <label className="settings-row">
          每次平移
          <select value={shortcuts.panBars} onChange={(e) => saveShortcuts({ panBars: Number(e.target.value) })}>
            {[1, 5, 10, 20, 30].map((value) => <option key={value} value={value}>{value} 根 K 线</option>)}
          </select>
        </label>
        <label className="settings-row">
          每次缩放
          <select value={shortcuts.zoomPercent} onChange={(e) => saveShortcuts({ zoomPercent: Number(e.target.value) })}>
            {[5, 10, 15, 20, 25].map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
        <label className="settings-row">
          Shift 加速
          <select value={shortcuts.shiftMultiplier} onChange={(e) => saveShortcuts({ shiftMultiplier: Number(e.target.value) })}>
            {[2, 5, 10].map((value) => <option key={value} value={value}>{value} 倍平移</option>)}
          </select>
        </label>
        <div className="shortcut-reference">
          <div><kbd>←</kbd><kbd>→</kbd><span>左右平移</span></div>
          <div><kbd>↑</kbd><kbd>↓</kbd><span>放大 / 缩小</span></div>
          <div><kbd>Shift</kbd><kbd>←/→</kbd><span>快速平移</span></div>
          <div><kbd>Home</kbd><span>回到最新 K 线</span></div>
          <div><kbd>End</kbd><span>进入右侧半屏留白</span></div>
          <div><kbd>+</kbd><kbd>-</kbd><span>放大 / 缩小</span></div>
          <div><kbd>[</kbd><kbd>]</kbd><span>上一个 / 下一个周期</span></div>
          <div><kbd>Esc</kbd><span>取消画线或关闭画线面板</span></div>
          <div><kbd>Ctrl</kbd><kbd>Z</kbd><span>撤销当前周期最后画线</span></div>
          <div><kbd>Alt</kbd><kbd>T</kbd><span>趋势线</span></div>
          <div><kbd>Alt</kbd><kbd>H</kbd><span>水平线</span></div>
          <div><kbd>Alt</kbd><kbd>Y</kbd><span>射线</span></div>
          <div><kbd>Alt</kbd><kbd>R/F/C</kbd><span>矩形 / 斐波那契 / 通道</span></div>
          {shortcuts.mode === 'professional' && (
            <>
              <div><kbd>A/D</kbd><kbd>W/S</kbd><span>平移 / 缩放</span></div>
              <div><kbd>R</kbd><kbd>F</kbd><span>最新 / 右侧留白</span></div>
              <div><kbd>1—5</kbd><span>分时 / 日 / 周 / 月 / 季 K</span></div>
            </>
          )}
        </div>
        <button
          className="btn shortcut-reset"
          onClick={() => saveShortcuts(DEFAULT_CHART_SHORTCUT_CONFIG)}
        >
          恢复默认快捷键设置
        </button>
      </section>

      {/* AI 数据与量化服务 */}
      {quant && (
        <section className="settings-card quant-settings-card">
          <div className="settings-title-row">
            <div>
              <div className="panel-title">AI 数据与量化服务</div>
              <div className="settings-hint">连接聚宽-local，向 AI 提供因子、长历史行情、策略引擎说明和完整回测结果。</div>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={quant.enabled}
                onChange={(e) => saveQuant({ enabled: e.target.checked })}
              />
              <span>{quant.enabled ? '已启用' : '已停用'}</span>
            </label>
          </div>
          <label className="settings-row">
            服务地址
            <input
              className="settings-monospace"
              value={quant.baseUrl}
              disabled={!quant.enabled}
              onChange={(e) => setQuant({ ...quant, baseUrl: e.target.value })}
              onBlur={() => saveQuant({ baseUrl: quant.baseUrl })}
              placeholder="http://127.0.0.1:3000"
            />
          </label>
          <label className="settings-row">
            请求超时
            <select
              value={quant.timeoutSec}
              disabled={!quant.enabled}
              onChange={(e) => saveQuant({ timeoutSec: Number(e.target.value) })}
            >
              {[10, 30, 60, 120, 300, 600].map((value) => <option key={value} value={value}>{value} 秒</option>)}
            </select>
          </label>
          <label className="settings-row">
            单次最多返回
            <select
              value={quant.maxRows}
              disabled={!quant.enabled}
              onChange={(e) => saveQuant({ maxRows: Number(e.target.value) })}
            >
              {[100, 200, 500, 1000, 2000].map((value) => <option key={value} value={value}>{value} 行</option>)}
            </select>
          </label>
          <div className="quant-status-row">
            <button className="btn" disabled={!quant.enabled || testingQuant} onClick={testQuant}>
              {testingQuant ? '正在检测…' : '检测连接'}
            </button>
            {quantStatus && (
              <div className={`quant-status ${quantStatus.connected ? 'connected' : 'failed'}`}>
                <strong>{quantStatus.connected ? '连接正常' : '连接失败'}</strong>
                {quantStatus.connected ? (
                  <span>
                    {quantStatus.dateFrom} ～ {quantStatus.dateTo} · {quantStatus.factorsCount ?? 0} 因子 ·
                    {quantStatus.engineApiCount ?? 0} 策略 API · {quantStatus.latencyMs}ms
                  </span>
                ) : (
                  <span>{quantStatus.error}</span>
                )}
              </div>
            )}
          </div>
          <div className="settings-hint">仅允许连接本机 127.0.0.1/localhost。服务未启动时，在聚宽-local目录运行 npm start。</div>
        </section>
      )}

      {/* AI */}
      <section className="settings-card">
        <div className="panel-title">AI 后端</div>
        <div className="settings-presets">
          {AI_PRESETS.map((p) => (
            <button
              key={p.label}
              className="btn"
              onClick={() => {
                saveAi(p.cfg)
                setQuickHint(`已选择 ${p.label}，粘贴 key 即可`)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="settings-row">
          一键配置
          <input
            className="settings-monospace"
            value={quick}
            placeholder="粘贴 provider:sk-xxx"
            onChange={(e) => applyQuick(e.target.value)}
          />
        </label>
        {quickHint && <div className="settings-hint">{quickHint}</div>}
        {ai && (
          <>
            <label className="settings-row">
              后端
              <select value={ai.provider} onChange={(e) => saveAi({ provider: e.target.value as AiConfig['provider'] })}>
                <option value="anthropic">Anthropic Claude</option>
                <option value="openai">OpenAI 兼容（OpenCode Go/DeepSeek/Ollama）</option>
              </select>
            </label>
            <label className="settings-row">
              模型
              <input value={ai.model} onChange={(e) => saveAi({ model: e.target.value })} />
            </label>
            <label className="settings-row">
              API Key
              <input
                type="password"
                value={ai.apiKey}
                placeholder="本地 Ollama 可留空"
                onChange={(e) => saveAi({ apiKey: e.target.value })}
              />
            </label>
            <label className="settings-row">
              BaseURL
              <input value={ai.baseUrl} onChange={(e) => saveAi({ baseUrl: e.target.value })} />
            </label>
            <label className="settings-row">
              写操作
              <select value={ai.writeMode} onChange={(e) => saveAi({ writeMode: e.target.value as 'auto' | 'confirm' })}>
                <option value="auto">自动执行 + 审计</option>
                <option value="confirm">每次需确认</option>
              </select>
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={ai.allowWatchlistWrite}
                onChange={(e) => saveAi({ allowWatchlistWrite: e.target.checked })}
              />
              允许 AI 把选股结果写入自选股
            </label>
          </>
        )}
      </section>

      {/* 监盘 */}
      {mon && (
        <section className="settings-card">
          <div className="panel-title">实时监盘</div>
          <label className="settings-row">
            总开关
            <input type="checkbox" checked={mon.enabled} onChange={(e) => saveMon({ enabled: e.target.checked })} />
          </label>
          <label className="settings-row">
            范围
            <select value={mon.scope} onChange={(e) => saveMon({ scope: e.target.value as MonitorConfig['scope'] })}>
              <option value="monitor">监控列表</option>
              <option value="watchlist">自选</option>
              <option value="market">全市场</option>
            </select>
          </label>
          <label className="settings-row">
            间隔(秒)
            <select value={mon.interval} onChange={(e) => saveMon({ interval: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30, 60, 120, 180, 300].map((i) => (
                <option key={i} value={i}>
                  {i < 60 ? `${i}秒` : `${i / 60}分钟`}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            AI 预测
            <input type="checkbox" checked={mon.aiEnabled} onChange={(e) => saveMon({ aiEnabled: e.target.checked })} />
          </label>
          <label className="settings-row">
            AI 触发
            <select value={mon.aiTrigger} onChange={(e) => saveMon({ aiTrigger: e.target.value as MonitorConfig['aiTrigger'] })}>
              <option value="both">定时+异动</option>
              <option value="scheduled">定时</option>
              <option value="anomaly">异动</option>
            </select>
          </label>
          <label className="settings-row">
            AI 间隔(秒)
            <input type="number" value={mon.aiIntervalSec} onChange={(e) => saveMon({ aiIntervalSec: Number(e.target.value) })} />
          </label>
          <label className="settings-row">
            异动阈值%
            <input type="number" step={0.5} value={mon.anomalyPct} onChange={(e) => saveMon({ anomalyPct: Number(e.target.value) })} />
          </label>
          <label className="settings-row">
            预警阈值%
            <input type="number" step={0.5} value={mon.alertPct} onChange={(e) => saveMon({ alertPct: Number(e.target.value) })} />
          </label>
          <label className="settings-row">
            判定周期(分)
            <input type="number" value={mon.predictionHorizonMin} onChange={(e) => saveMon({ predictionHorizonMin: Number(e.target.value) })} />
          </label>
          <label className="settings-row">
            入库保留条数
            <input type="number" value={mon.retention} onChange={(e) => saveMon({ retention: Number(e.target.value) })} />
          </label>
        </section>
      )}

      {/* 回测 */}
      <section className="settings-card">
        <div className="panel-title">AI 策略知识库</div>
        <div className="settings-hint">AI 会先搜索再按需读取策略原文；知识库保持只读，不会修改源文件。</div>
        <label className="settings-row">
          默认地址
          <input
            value={strategyKnowledgePath}
            placeholder="D:\\来自：分享"
            onChange={(e) => {
              setStrategyKnowledgePath(e.target.value)
              setSetting('ai.knowledge.strategyPath', e.target.value)
            }}
          />
        </label>
      </section>

      {/* 回测 */}
      <section className="settings-card">
        <div className="panel-title">回测</div>
        <label className="settings-row">
          Python 路径
          <input
            value={pythonPath}
            placeholder="python（默认），或 /path/to/python"
            onChange={(e) => {
              setPythonPath(e.target.value)
              setSetting('pythonPath', e.target.value)
            }}
          />
        </label>
      </section>

      {/* 数据 */}
      <section className="settings-card market-db-card">
        <div className="panel-title">行情库位置</div>

        <div className="market-db-path" title={dbInfo?.path ?? ''}>
          {dbInfo?.path ?? '检测中…'}
        </div>

        <div className="market-db-meta">
          <span>来源：{dbInfo ? DB_SOURCE_LABEL[dbInfo.source] : '—'}</span>
          {dbInfo?.exists && dbInfo.valid && (
            <>
              <span>股票 {dbInfo.stocksCount ?? 0} 只</span>
              <span>
                交易日 {dbInfo.dateFrom ?? '—'} ~ {dbInfo.dateTo ?? '—'}
              </span>
              {dbInfo.sizeMb != null && <span>{dbInfo.sizeMb} MB</span>}
            </>
          )}
        </div>

        {dbInfo && !dbInfo.valid && (
          <div className="market-db-error">{dbInfo.error ?? '行情库不可用'}</div>
        )}
        {dbInfo && dbInfo.source === 'userData' && (
          <div className="market-db-warn">
            当前用的是用户数据目录下的库（通常是本程序自建的空库）。
            软件与数据分开存放时，请用下面的按钮指定你的行情库文件。
          </div>
        )}
        {dbInfo && dbInfo.source === 'env' && !dbInfo.valid && (
          <div className="market-db-warn">
            工作区指定的行情库文件不可用。请检查 LOCALSTOCK_MARKET_DB，或用下面的按钮重新选择库文件。
          </div>
        )}
        {dbHint && <div className="settings-hint">{dbHint}</div>}

        <div className="market-db-actions">
          <button className="btn" disabled={dbBusy} onClick={pickDb}>
            {dbBusy ? '处理中…' : '选择库文件…'}
          </button>
          <button className="btn" disabled={dbBusy} onClick={refreshDb}>
            重新检测
          </button>
          <button className="btn" disabled={dbBusy || !dbInfo?.configured} onClick={resetDb}>
            恢复默认
          </button>
        </div>

        <div className="settings-hint">
          指定后立即生效（本地 K 线 / 选股 / 回测 / 价格行为 AI 一并切换）。
          数据量较大时只读库结构、股票数与交易日范围，不会对全表做统计。
        </div>
      </section>
    </div>
  )
}
