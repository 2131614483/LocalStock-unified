import { ipcMain, type WebContents } from 'electron'
import { clipboard, dialog } from 'electron'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { PaAnalyzeRequest, PaKnowledgeLibrary, PaServerStatus } from '../../shared/types'
import { loadAiConfig } from '../ai/provider'
import {
  getPaKline,
  exportPaOffline,
  searchPaSymbols,
  streamPaAnalysis,
  testPaConnection
} from './client'
import { loadPaConfig, savePaConfig } from './config'
import {
  getPaServerStatus,
  installPaDeps,
  restartPaServer,
  startPaServerSafe,
  stopPaServer
} from './server'
import { paRuntimeDir, paServiceDir } from './server'

/**
 * 价格行为 AI 域 IPC。
 *
 * 服务由主进程托管（electron/pa/server.ts）：应用启动即拉起，退出即关闭。
 * 渲染层提交分析 → 主进程转发给 pa-agent → SSE 事件流式推回渲染层。
 * 单任务：同一时刻只允许一次分析。
 */

let currentAbort: AbortController | null = null

function listPromptFiles(root: string): { path: string; size: number }[] {
  const files: { path: string; size: number }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.(txt|md)$/i.test(entry.name)) {
        files.push({ path: relative(root, full).replace(/\\/g, '/'), size: statSync(full).size })
      }
    }
  }
  try { walk(root) } catch { /* 资源缺失时返回空清单，让界面如实展示 */ }
  return files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
}

function knowledgeLibraries(): PaKnowledgeLibrary[] {
  const active = paServiceDir()
  // 不依赖当前启动的服务：即使尚未运行，也可查看两套只读策略库。
  const stableRoot = active.endsWith('pa-agent-aggressive')
    ? join(active, '..', 'pa-agent', 'prompt_engineering')
    : join(active, 'prompt_engineering')
  const aggressiveRoot = active.endsWith('pa-agent-aggressive')
    ? join(active, 'prompt_engineering')
    : join(active, '..', 'pa-agent-aggressive', 'prompt_engineering')
  return [
    { profile: 'stable', label: '稳定版策略库', root: stableRoot, files: listPromptFiles(stableRoot) },
    { profile: 'aggressive', label: '激进版策略库', root: aggressiveRoot, files: listPromptFiles(aggressiveRoot) }
  ]
}

function readText(path: string): { path: string; text: string } {
  return { path, text: readFileSync(path, 'utf8') }
}

async function pickTextFile(kind: 'reply' | 'pack'): Promise<{ path: string; text: string } | null> {
  const result = await dialog.showOpenDialog({
    title: kind === 'pack' ? '选择离线包（01_阶段一_*.txt）' : '读取模型回复文件',
    properties: ['openFile'],
    filters: kind === 'pack'
      ? [{ name: '离线包', extensions: ['txt'] }, { name: '所有文件', extensions: ['*'] }]
      : [{ name: '文本与 JSON', extensions: ['txt', 'json', 'md'] }, { name: '所有文件', extensions: ['*'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  return readText(result.filePaths[0])
}

function latestOfflinePack(): { path: string; text: string } | null {
  const root = join(paRuntimeDir(), 'offline_packs')
  try {
    const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))
    for (const folder of folders) {
      const candidate = readdirSync(join(root, folder.name)).filter((name) => /^01_.*\.txt$/i.test(name)).sort().at(0)
      if (candidate) return readText(join(root, folder.name, candidate))
    }
  } catch { /* 当前版本尚未导出离线包 */ }
  return null
}

/** 订阅服务状态推送的渲染层集合（广播给所有窗口） */
const statusSubscribers = new Set<WebContents>()

export function broadcastPaServerStatus(): void {
  const status = getPaServerStatus()
  for (const wc of statusSubscribers) {
    if (!wc.isDestroyed()) wc.send('pa:serverStatus', status)
  }
}

/** 环境准备进度 → 广播给订阅者（界面据此显示"首次运行，正在准备运行环境…"） */
function broadcastDepsProgress(evt: Record<string, unknown>): void {
  for (const wc of statusSubscribers) {
    if (!wc.isDestroyed()) wc.send('pa:depsProgress', evt)
  }
}

/**
 * 应用启动时调用：拉起托管服务并广播状态。
 *
 * 运行环境是**自动准备**的：本机有 Python 就用它建独立 venv，
 * 一个都没有就从 GitHub 下载独立 CPython —— 所以拷到别的电脑也能直接跑，
 * 不需要用户点任何按钮。
 */
export async function bootstrapPaServer(): Promise<PaServerStatus> {
  // 用户在设置里关掉了该功能就不启动子进程
  if (!loadPaConfig().enabled) {
    broadcastPaServerStatus()
    return getPaServerStatus()
  }

  const status = await startPaServerSafe(broadcastDepsProgress)
  broadcastPaServerStatus()
  return status
}

/** 应用退出时调用 */
export function shutdownPaServer(): void {
  stopPaServer()
}

export function registerPaIpc(): void {
  ipcMain.handle('pa:getConfig', () => loadPaConfig())

  ipcMain.handle('pa:setConfig', async (_e, patch) => {
    const before = loadPaConfig()
    const next = savePaConfig(patch ?? {})
    // 切换版本必须换掉同名 Python 包所在的服务进程；其他配置无需中断分析服务。
    if (before.profile !== next.profile) {
      await restartPaServer()
      broadcastPaServerStatus()
    }
    return next
  })

  ipcMain.handle('pa:getServerStatus', () => getPaServerStatus())

  ipcMain.handle('pa:restartServer', async () => {
    const status = await restartPaServer()
    broadcastPaServerStatus()
    return status
  })

  ipcMain.handle('pa:installDeps', async () => {
    const result = await installPaDeps((evt) => {
      // 安装进度同样广播给订阅者
      for (const wc of statusSubscribers) {
        if (!wc.isDestroyed()) wc.send('pa:depsProgress', evt)
      }
    })
    broadcastPaServerStatus()
    return result
  })

  ipcMain.handle('pa:subscribeServerStatus', (e, subscribe: boolean) => {
    if (subscribe) statusSubscribers.add(e.sender)
    else statusSubscribers.delete(e.sender)
    return getPaServerStatus()
  })

  ipcMain.handle('pa:testConnection', async () => {
    const status = await testPaConnection()
    broadcastPaServerStatus()
    return status
  })

  ipcMain.handle('pa:searchSymbols', (_e, keyword: string, limit?: number) =>
    searchPaSymbols(keyword ?? '', limit ?? 50)
  )

  ipcMain.handle('pa:getKline', (_e, symbol: string, timeframe, bars: number) =>
    getPaKline(symbol, timeframe, bars)
  )

  ipcMain.handle('pa:exportOffline', (_e, req) => exportPaOffline(req ?? {}))
  ipcMain.handle('pa:listKnowledgeLibraries', () => knowledgeLibraries())
  ipcMain.handle('pa:readClipboardText', () => clipboard.readText())
  ipcMain.handle('pa:pickImportText', () => pickTextFile('reply'))
  ipcMain.handle('pa:pickOfflinePack', () => pickTextFile('pack'))
  ipcMain.handle('pa:latestOfflinePack', () => latestOfflinePack())
  ipcMain.handle('pa:archiveImportedRecord', (_e, record) => {
    const dir = join(paRuntimeDir(), 'records', 'imported')
    mkdirSync(dir, { recursive: true })
    const safeSymbol = String(record?.meta?.symbol ?? 'unknown').replace(/[^\w.-]+/g, '_')
    const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeSymbol}.json`)
    writeFileSync(path, JSON.stringify(record, null, 2), 'utf8')
    return path
  })

  ipcMain.handle('pa:analyze', async (e, req: PaAnalyzeRequest) => {
    const sender = e.sender
    if (sender.isDestroyed()) return { ok: false, error: '窗口已关闭' }
    if (currentAbort) return { ok: false, error: '已有分析正在运行，请先取消' }

    const aiConfig = loadAiConfig()
    if (aiConfig.provider === 'anthropic' && !aiConfig.apiKey) {
      return { ok: false, error: '尚未配置 AI 的 API Key（设置 → AI 后端）' }
    }

    const abort = new AbortController()
    currentAbort = abort
    // 不 await：立即返回，事件通过 pa:event 推送
    void streamPaAnalysis(
      req,
      aiConfig,
      (evt) => {
        if (!sender.isDestroyed()) sender.send('pa:event', evt)
      },
      abort.signal
    )
      .catch((error: unknown) => {
        if (abort.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        if (!sender.isDestroyed()) {
          sender.send('pa:event', { type: 'error', message })
        }
      })
      .finally(() => {
        if (currentAbort === abort) currentAbort = null
      })

    return { ok: true }
  })

  ipcMain.handle('pa:cancel', () => {
    currentAbort?.abort()
    currentAbort = null
    return { ok: true }
  })
}
