import { ipcMain } from 'electron'
import type { FloatViewId, FloatViewParams } from '../shared/types'
import {
  openFloat,
  toggleFloat,
  closeFloat,
  getAllFloatStates,
  setFloatChangeNotifier
} from './windows'

/** 视图浮窗 IPC：主窗口「窗口」菜单控制各浮窗 */
export function registerFloatIpc(getWindow: () => Electron.BrowserWindow | null): void {
  setFloatChangeNotifier(() => {
    // 关键：窗口可能已销毁（关闭后回调仍触发），必须先判 isDestroyed
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('float:changed')
  })

  ipcMain.handle('float:open', (_e, view: FloatViewId, params?: FloatViewParams) => {
    openFloat(view, params)
    return { ok: true }
  })
  ipcMain.handle('float:toggle', (_e, view: FloatViewId) => {
    toggleFloat(view)
    return { ok: true }
  })
  ipcMain.handle('float:close', (_e, view: FloatViewId) => {
    closeFloat(view)
    return { ok: true }
  })
  ipcMain.handle('float:getAll', () => getAllFloatStates())
}
