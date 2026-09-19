import { app, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Drawing, KlineResult } from '../shared/types'
import { getDrawings, saveDrawings, restoreDrawings, clearDrawings, getSetting } from './db'

/** python 脚本目录：打包后在 resources/python，开发时在项目根 python/ */
function pythonDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'python')
  return join(app.getAppPath(), 'python')
}

function pythonExe(): string {
  return getSetting('pythonPath') || 'python'
}

export function registerDrawingIpc(): void {
  ipcMain.handle('drawings:get', (_e, secid: string) => getDrawings(secid))
  ipcMain.handle('drawings:save', (_e, secid: string, drawings: Drawing[]) => {
    saveDrawings(secid, drawings)
  })
  ipcMain.handle('drawings:restore', (_e, secid: string, version: number) =>
    restoreDrawings(secid, version)
  )
  ipcMain.handle('drawings:clear', (_e, secid: string) => {
    clearDrawings(secid)
  })
  ipcMain.handle('drawings:runAlgo', (_e, secid: string, code: string, kline: KlineResult) =>
    runDrawAlgo(secid, code, kline)
  )
}

/** 调用 Python 画线算法引擎：写 K线 JSON 临时文件 → spawn → 解析画线 */
export function runDrawAlgo(
  secid: string,
  code: string,
  kline: KlineResult
): Promise<{ ok: boolean; drawings?: Drawing[]; error?: string }> {
  const engine = join(pythonDir(), 'engine', 'draw_engine.py')
  if (!existsSync(engine)) {
    return Promise.resolve({ ok: false, error: `画线引擎不存在: ${engine}` })
  }
  const tmpFile = join(app.getPath('temp'), `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`)
  try {
    writeFileSync(tmpFile, JSON.stringify(kline), 'utf-8')
  } catch (err) {
    return Promise.resolve({ ok: false, error: `写入K线数据失败：${(err as Error).message}` })
  }
  return new Promise((resolve) => {
    execFile(
      pythonExe(),
      [engine, '--code', code, '--data', tmpFile],
      { maxBuffer: 10 * 1024 * 1024, timeout: 30_000, windowsHide: true },
      (err, stdout, stderr) => {
        try {
          unlinkSync(tmpFile)
        } catch {
          // 忽略清理失败
        }
        if (err) {
          resolve({
            ok: false,
            error: `画线算法执行失败：${(err as Error).message}${stderr ? '\n' + stderr.slice(0, 500) : ''}`
          })
          return
        }
        try {
          const res = JSON.parse(stdout)
          if (res.code !== 0) {
            resolve({ ok: false, error: String(res.error || res.message || '画线失败') })
            return
          }
          const now = Date.now()
          const drawings: Drawing[] = (res.drawings || []).map((d: Drawing) => ({
            id: `algo_${now}_${Math.random().toString(36).slice(2, 8)}`,
            type: d.type,
            points: d.points || [],
            color: d.color || '#2f81f7',
            label: d.label,
            source: 'algo' as const,
            createdAt: now,
            updatedAt: now
          }))
          resolve({ ok: true, drawings })
        } catch {
          resolve({
            ok: false,
            error: `画线算法输出解析失败${stderr ? '\n' + stderr.slice(0, 500) : ''}`
          })
        }
      }
    )
  })
}
