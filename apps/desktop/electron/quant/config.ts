import type { QuantServiceConfig } from '../../shared/types'
import { getSetting, setSetting } from '../db'

const PREFIX = 'quant.'

export const DEFAULT_QUANT_CONFIG: QuantServiceConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:3000',
  timeoutSec: 30,
  maxRows: 500
}

export function normalizeQuantBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('量化服务地址格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('量化服务地址仅支持 http/https')
  }
  const host = url.hostname.toLowerCase()
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('P0 阶段仅允许连接本机量化服务（127.0.0.1/localhost）')
  }
  if (url.username || url.password) throw new Error('服务地址中不能包含用户名或密码')
  return url.toString().replace(/\/$/, '')
}

export function loadQuantConfig(): QuantServiceConfig {
  const enabled = getSetting(`${PREFIX}enabled`)
  const baseUrl = getSetting(`${PREFIX}baseUrl`)
  const timeoutSec = Number(getSetting(`${PREFIX}timeoutSec`))
  const maxRows = Number(getSetting(`${PREFIX}maxRows`))
  return {
    enabled: enabled === null ? DEFAULT_QUANT_CONFIG.enabled : enabled === '1',
    baseUrl: baseUrl ? normalizeQuantBaseUrl(baseUrl) : DEFAULT_QUANT_CONFIG.baseUrl,
    timeoutSec: Number.isFinite(timeoutSec) && timeoutSec >= 2 && timeoutSec <= 600 ? timeoutSec : DEFAULT_QUANT_CONFIG.timeoutSec,
    maxRows: Number.isFinite(maxRows) && maxRows >= 50 && maxRows <= 2000 ? maxRows : DEFAULT_QUANT_CONFIG.maxRows
  }
}

export function saveQuantConfig(patch: Partial<QuantServiceConfig>): QuantServiceConfig {
  const next = { ...loadQuantConfig(), ...patch }
  next.baseUrl = normalizeQuantBaseUrl(next.baseUrl)
  next.timeoutSec = Math.max(2, Math.min(600, Math.round(Number(next.timeoutSec) || 30)))
  next.maxRows = Math.max(50, Math.min(2000, Math.round(Number(next.maxRows) || 500)))
  setSetting(`${PREFIX}enabled`, next.enabled ? '1' : '0')
  setSetting(`${PREFIX}baseUrl`, next.baseUrl)
  setSetting(`${PREFIX}timeoutSec`, String(next.timeoutSec))
  setSetting(`${PREFIX}maxRows`, String(next.maxRows))
  return next
}
