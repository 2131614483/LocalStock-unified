import { ipcMain } from 'electron'
import { clearQuantCapabilityCache, testQuantConnection } from './client'
import { loadQuantConfig, saveQuantConfig } from './config'

export function registerQuantIpc(): void {
  ipcMain.handle('quant:getConfig', () => loadQuantConfig())
  ipcMain.handle('quant:setConfig', (_event, patch) => {
    const config = saveQuantConfig(patch ?? {})
    clearQuantCapabilityCache()
    return config
  })
  ipcMain.handle('quant:testConnection', (_event, refresh = true) => testQuantConnection(refresh))
}
