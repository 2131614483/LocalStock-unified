import type { PaServiceConfig } from '../../shared/types'
import { getSetting, setSetting } from '../db'

const PREFIX = 'pa.'

export const DEFAULT_PA_CONFIG: PaServiceConfig = {
  enabled: true,
  profile: 'stable',
  // 留空 = 用桌面端托管的 pa-agent 进程（端口由系统分配，见 electron/pa/server.ts）
  baseUrl: '',
  // 仅用于健康检查/搜索/K线等短请求；分析流式接口不设总超时
  timeoutSec: 30
}

/** 手工覆盖地址时仍只允许本机，避免把行情/提示词发到外部主机 */
export function normalizePaBaseUrl(raw: string): string {
  const text = (raw ?? '').trim()
  if (!text) return ''
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('价格行为服务地址格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('价格行为服务地址仅支持 http/https')
  }
  const host = url.hostname.toLowerCase()
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('价格行为服务仅允许连接本机（127.0.0.1/localhost）')
  }
  if (url.username || url.password) throw new Error('服务地址中不能包含用户名或密码')
  return url.toString().replace(/\/$/, '')
}

export function loadPaConfig(): PaServiceConfig {
  const enabled = getSetting(`${PREFIX}enabled`)
  const baseUrl = getSetting(`${PREFIX}baseUrl`)
  const profile = getSetting(`${PREFIX}profile`)
  const timeoutSec = Number(getSetting(`${PREFIX}timeoutSec`))
  return {
    enabled: enabled === null ? DEFAULT_PA_CONFIG.enabled : enabled === '1',
    profile: profile === 'aggressive' ? 'aggressive' : 'stable',
    baseUrl: baseUrl ? normalizePaBaseUrl(baseUrl) : DEFAULT_PA_CONFIG.baseUrl,
    timeoutSec:
      Number.isFinite(timeoutSec) && timeoutSec >= 2 && timeoutSec <= 600
        ? timeoutSec
        : DEFAULT_PA_CONFIG.timeoutSec
  }
}

export function savePaConfig(patch: Partial<PaServiceConfig>): PaServiceConfig {
  const next = { ...loadPaConfig(), ...patch }
  next.baseUrl = normalizePaBaseUrl(next.baseUrl ?? '')
  next.profile = next.profile === 'aggressive' ? 'aggressive' : 'stable'
  next.timeoutSec = Math.max(2, Math.min(600, Math.round(Number(next.timeoutSec) || 30)))
  setSetting(`${PREFIX}enabled`, next.enabled ? '1' : '0')
  setSetting(`${PREFIX}profile`, next.profile)
  setSetting(`${PREFIX}baseUrl`, next.baseUrl)
  setSetting(`${PREFIX}timeoutSec`, String(next.timeoutSec))
  return next
}
