import { Settings, History, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiChatMessage, AiConfig, AiContext, AiProviderId } from '../../../shared/types'
import { useAi } from '../../store/ai'
import { useApp } from '../../store/app'
import { AI_PRESETS, parseProviderKey } from '../../lib/ai-config'
import MarkdownView from './MarkdownView'

/** 从当前视图构建 AI 上下文（详情页带个股，其他页带视图类型） */
export function buildContext(): AiContext {
  const app = useApp.getState()
  const ctx: AiContext = {}
  if (app.view.type === 'detail') {
    ctx.viewType = 'detail'
    ctx.secid = app.view.secid
    ctx.name = app.view.name
  } else {
    ctx.viewType = app.view.type
  }
  return ctx
}

/** 预设后端（一键填充 baseUrl+model） */
const PRESETS = AI_PRESETS

function QuantStatusBadge() {
  const [state, setState] = useState<{ status: 'checking' | 'connected' | 'offline' | 'disabled'; text: string }>({
    status: 'checking',
    text: '量化数据检测中'
  })
  useEffect(() => {
    let cancelled = false
    void window.api.quant.getConfig().then((config) => {
      if (cancelled) return
      if (!config.enabled) {
        setState({ status: 'disabled', text: '量化数据未启用' })
        return
      }
      void window.api.quant.testConnection(false).then((result) => {
        if (cancelled) return
        setState(result.connected
          ? { status: 'connected', text: `历史库 ${result.dateTo ?? '已连接'} · ${result.factorsCount ?? 0} 因子` }
          : { status: 'offline', text: '量化服务离线' })
      })
    })
    return () => { cancelled = true }
  }, [])
  return <span className={`ai-data-status ${state.status}`} title={state.text}>{state.text}</span>
}

function ToolCallRow({ call }: { call: NonNullable<AiChatMessage['toolCalls']>[number] }) {
  const icon = call.status === 'running' ? '…' : call.status === 'done' ? '✓' : '✗'
  return (
    <div
      className={`ai-tool ai-tool-${call.status}`}
      title={call.isError ? '工具执行失败（已反馈给 AI）' : undefined}
    >
      <span className="ai-tool-status">{icon}</span>
      <span className="ai-tool-name">{call.name}</span>
      {call.isError && <span className="ai-tool-error">失败</span>}
    </div>
  )
}

function MessageRow({ msg }: { msg: AiChatMessage }) {
  if (msg.role === 'user') {
    return <div className="ai-msg ai-msg-user">{msg.content}</div>
  }
  return (
    <div className="ai-msg ai-msg-assistant">
      <div className="ai-msg-text">
        {msg.content ? (
          <MarkdownView content={msg.content} />
        ) : msg.finished ? (
          ''
        ) : (
          '思考中…'
        )}
      </div>
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="ai-tools">
          {msg.toolCalls.map((c) => (
            <ToolCallRow key={c.id} call={c} />
          ))}
        </div>
      )}
      {msg.error && <div className="ai-msg-error">⚠ {msg.error}</div>}
    </div>
  )
}

function ConfigForm() {
  const config = useAi((s) => s.config)
  const saveConfig = useAi((s) => s.saveConfig)
  const [open, setOpen] = useState(false)
  const [quick, setQuick] = useState('')
  const [quickHint, setQuickHint] = useState('')
  if (!config) return null

  const applyQuick = (v: string): void => {
    setQuick(v)
    const cfg = parseProviderKey(v)
    if (cfg) {
      saveConfig(cfg)
      setQuickHint(`✓ 已识别 ${cfg.provider === 'openai' && cfg.baseUrl?.includes('opencode') ? 'OpenCode Go' : cfg.baseUrl ? 'DeepSeek' : cfg.provider}`)
    } else {
      setQuickHint(v.trim() ? '格式：provider:sk-xxx（opencode-go / deepseek / anthropic / openai）' : '')
    }
  }

  return (
    <>
      <button className="ai-gear" title="AI 设置" onClick={() => setOpen((v) => !v)}>
        <Settings size={13} />
      </button>
      {open && (
        <div className="ai-config">
          <div className="ai-config-presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className="btn"
                onClick={() => {
                  saveConfig(p.cfg)
                  setQuickHint(`已选择 ${p.label}，粘贴 key 即可`)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="ai-config-row ai-config-quick">
            <span>一键配置</span>
            <input
              value={quick}
              placeholder="粘贴 provider:sk-xxx"
              onChange={(e) => applyQuick(e.target.value)}
            />
          </label>
          {quickHint && <div className="ai-config-hint">{quickHint}</div>}
          <label className="ai-config-row">
            后端
            <select
              value={config.provider}
              onChange={(e) => saveConfig({ provider: e.target.value as AiProviderId })}
            >
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI 兼容（OpenCode Go/DeepSeek/Ollama）</option>
            </select>
          </label>
          <label className="ai-config-row">
            模型
            <input
              value={config.model}
              placeholder="deepseek-v4-flash / claude-sonnet-5 / llama3.1"
              onChange={(e) => saveConfig({ model: e.target.value })}
            />
          </label>
          <label className="ai-config-row">
            API Key
            <input
              type="password"
              value={config.apiKey}
              placeholder={config.provider === 'openai' ? '本地 Ollama 可留空' : '必填'}
              onChange={(e) => saveConfig({ apiKey: e.target.value })}
            />
          </label>
          <label className="ai-config-row">
            BaseURL
            <input
              value={config.baseUrl}
              placeholder="OpenCode Go: https://opencode.ai/zen/go/v1"
              onChange={(e) => saveConfig({ baseUrl: e.target.value })}
            />
          </label>
          <label className="ai-config-row">
            写操作
            <select value={config.writeMode} onChange={(e) => saveConfig({ writeMode: e.target.value as 'auto' | 'confirm' })}>
              <option value="auto">自动执行 + 审计</option>
              <option value="confirm">每次需确认</option>
            </select>
          </label>
          <label className="ai-config-check">
            <input
              type="checkbox"
              checked={config.allowWatchlistWrite}
              onChange={(e) => saveConfig({ allowWatchlistWrite: e.target.checked })}
            />
            允许 AI 把选股结果写入自选股
          </label>
        </div>
      )}
    </>
  )
}

function AuditList() {
  const audit = useAi((s) => s.audit)
  const rollback = useAi((s) => s.rollback)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="ai-gear" title="最近 AI 写操作" onClick={() => setOpen((v) => !v)}>
        <History size={13} />
      </button>
      {open && (
        <div className="ai-audit">
          <div className="ai-audit-title">最近 AI 写操作（可回滚）</div>
          {audit.length === 0 && <div className="ai-audit-empty">暂无写操作记录</div>}
          {audit.map((a) => (
            <div key={a.id} className="ai-audit-item">
              <span className={`ai-audit-status ai-audit-${a.status}`}>
                {a.status === 'applied' ? '已执行' : a.status === 'rolled_back' ? '已回滚' : '已拒绝'}
              </span>
              <span className="ai-audit-tool">{a.tool}</span>
              <span className="ai-audit-summary">{a.summary}</span>
              {a.status === 'applied' && (
                <button className="btn" onClick={() => void rollback(a.id)}>
                  回滚
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** 可复用的 AI 聊天视图（AIPanel 抽屉 / AiPage 独立页共用） */
export default function AiChatView({ rootClass }: { rootClass: string }) {
  const messages = useAi((s) => s.messages)
  const running = useAi((s) => s.running)
  const send = useAi((s) => s.send)
  const cancel = useAi((s) => s.cancel)
  const reset = useAi((s) => s.reset)
  const [text, setText] = useState('')
  // 抽屉面板宽度可拖拽（左侧把手 ↔）
  const isPanel = rootClass === 'ai-panel'
  const [pwidth, setPwidth] = useState(400)

  const onPanelDrag = (e: React.MouseEvent): void => {
    if (!isPanel) return
    e.preventDefault()
    const startX = e.clientX
    const startW = pwidth
    const move = (ev: MouseEvent): void => {
      setPwidth(Math.max(280, Math.min(680, startW - (ev.clientX - startX))))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-col')
    }
    document.body.classList.add('resizing-col')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const handleSend = (): void => {
    const t = text.trim()
    if (!t || running) return
    setText('')
    void send(t, buildContext())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`${rootClass} ai-chat-view`} style={isPanel ? { width: pwidth } : undefined}>
      {isPanel && (
        <div className="panel-resize-handle" onMouseDown={onPanelDrag} title="拖拽调整宽度（↔）" />
      )}
      <div className="ai-head">
        <span className="ai-title">AI 助手</span>
        <QuantStatusBadge />
        <div className="ai-head-right">
          <AuditList />
          <ConfigForm />
          <button className="ai-gear" title="清空会话" onClick={() => reset()}>
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="ai-body">
        {messages.length === 0 && (
          <div className="ai-empty">
            我是 LocalStock 内置 AI，可读取实时行情、长历史、因子和完整回测结果，并能帮你写量化策略、画线、自动选股。试试：
            <div className="ai-suggest">
              「贵州茅台现在多少，近一年走势如何？」<br />
              「帮我写一个双均线策略并回测」<br />
              「选出近 20 日放量突破年线、PE&lt;40 的股票」
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow key={i} msg={m} />
        ))}
      </div>
      <div className="ai-input-bar">
        <textarea
          className="ai-input"
          rows={2}
          value={text}
          placeholder="问我任何行情/选股/策略问题…（Enter 发送）"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {running ? (
          <button className="btn ai-send" onClick={() => cancel()}>
            停止
          </button>
        ) : (
          <button className="btn primary ai-send" onClick={handleSend} disabled={!text.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}
