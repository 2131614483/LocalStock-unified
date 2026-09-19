import { ipcMain } from 'electron'
import type { AiConfig, AiContext, AiToolCall } from '../../shared/types'
import { listAudit } from './audit'
import { rollbackAudit } from './rollback'
import { loadAiConfig, saveAiConfig } from './provider'
import { AiSession, runAgent } from './agent'
import { registerRollbackHandlers } from './rollback-handlers'
import { getMinuteAnnotations } from '../minute-ai'

/**
 * AI 域 IPC：渲染层对话 → 主进程 agent 循环 → 流式推送。
 * 单会话：重复 ai:send 在同一会话续聊（工具结果留在主进程，重发历史不会重复执行写操作）。
 */

let session: AiSession | null = null
let handlersRegistered = false

function getSession(): AiSession {
  if (!session) session = new AiSession({})
  return session
}

export function registerAiIpc(getWindow: () => Electron.BrowserWindow | null): void {
  if (!handlersRegistered) {
    registerRollbackHandlers()
    handlersRegistered = true
  }
  ipcMain.handle(
    'ai:send',
    async (e, text: string, ctx?: AiContext) => {
      const cfg = loadAiConfig()
      const s = getSession()
      if (s.running) return { ok: false, error: 'AI 正在运行中，请等待完成' }
      if (!text?.trim()) return { ok: false, error: '请输入内容' }
      if (cfg.provider === 'anthropic' && !cfg.apiKey) {
        return { ok: false, error: '尚未配置 AI 的 API Key（右上角 AI 面板 → 设置）' }
      }
      const sender = e.sender
      if (sender.isDestroyed()) return { ok: false, error: '窗口已关闭' }
      s.ctx = ctx ?? {}
      void runAgent({
        session: s,
        cfg,
        userText: text,
        ctx: ctx ?? {},
        emitter: {
          onChunk: (chunk) => {
            if (!sender.isDestroyed()) sender.send('ai:chunk', chunk)
          },
          onTool: (call: AiToolCall) => {
            if (!sender.isDestroyed()) sender.send('ai:tool', call)
          },
          onRefresh: () => {
            if (!sender.isDestroyed()) sender.send('ai:refresh')
          },
          onPushMinute: (secid: string) => {
            if (sender.isDestroyed()) return
            const ms = getMinuteAnnotations(secid)
            sender.send('minute:annotations', {
              secid,
              annotations: ms?.annotations ?? [],
              opinion: ms?.opinion ?? ''
            })
          },
          onError: (err) => {
            if (!sender.isDestroyed()) sender.send('ai:error', err)
          },
          onDone: () => {
            if (!sender.isDestroyed()) sender.send('ai:done')
          }
        }
      })
      return { ok: true }
    }
  )

  ipcMain.handle('ai:reset', () => {
    getSession().abort.abort()
    session = new AiSession({})
    return { ok: true }
  })

  ipcMain.handle('ai:cancel', () => {
    getSession().abort.abort()
    return { ok: true }
  })

  ipcMain.handle('ai:getConfig', () => loadAiConfig())

  ipcMain.handle('ai:setConfig', (_e, cfg: Partial<AiConfig>) => saveAiConfig(cfg))

  ipcMain.handle('ai:getAudit', () => listAudit())

  ipcMain.handle('ai:rollback', (_e, auditId: string) => rollbackAudit(auditId))
}
