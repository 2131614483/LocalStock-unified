import { useState } from 'react'
import { usePa } from '../../store/pa'

/**
 * 托管服务状态提示条。
 * 就绪时不渲染；启动中/依赖缺失/错误时给出可操作入口。
 */
export default function PaServerBanner() {
  const server = usePa((s) => s.server)
  const installing = usePa((s) => s.installing)
  const installMsg = usePa((s) => s.installMsg)
  const installError = usePa((s) => s.installError)
  const restartServer = usePa((s) => s.restartServer)
  const installDeps = usePa((s) => s.installDeps)
  const [showLog, setShowLog] = useState(false)

  if (!server || server.state === 'ready') return null

  const starting = server.state === 'starting'
  const noDeps = server.state === 'no-deps'
  // 用 || 而不是 ??：installMsg 的初始值是空字符串，用 ?? 会把真正的错误吞掉
  const desc = installError || installMsg || server.error || ''

  return (
    <div className={`pa-banner ${noDeps || server.state === 'error' ? 'pa-banner-bad' : ''}`}>
      <div className="pa-banner-main">
        <span className="pa-banner-title">
          {starting
            ? installing
              ? '首次运行，正在准备运行环境…'
              : '价格行为服务正在启动…'
            : noDeps
              ? '运行环境未就绪'
              : '价格行为服务未运行'}
        </span>
        {desc && <span className="pa-banner-desc">{desc}</span>}
      </div>

      <div className="pa-banner-actions">
        {noDeps && (
          <button
            type="button"
            className="pa-btn pa-btn-primary"
            disabled={installing}
            onClick={() => void installDeps()}
          >
            {installing ? '安装中…' : '安装运行环境'}
          </button>
        )}
        <button
          type="button"
          className="pa-btn"
          disabled={installing || starting}
          onClick={() => void restartServer()}
        >
          重启服务
        </button>
        <button type="button" className="pa-btn" onClick={() => setShowLog((v) => !v)}>
          {showLog ? '隐藏日志' : '查看日志'}
        </button>
      </div>

      {showLog && (
        <div className="pa-banner-log">
          <div className="pa-banner-log-meta">
            解释器：{server.python ?? '—'} · 服务目录：{server.serviceDir}
            <br />
            环境目录：{server.venvDir}
            <br />
            完整日志：{server.logFile}（此处仅显示最近 {server.log.length} 行）
          </div>
          <pre className="pa-raw">{server.log.join('\n') || '(暂无输出)'}</pre>
        </div>
      )}
    </div>
  )
}
