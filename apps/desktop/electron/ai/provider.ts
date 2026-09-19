import type { AiConfig } from '../../shared/types'
import { getSetting, setSetting } from '../db'
import { AnthropicProvider } from './anthropic'
import { OpenAICompatibleProvider } from './openai-compatible'
import type { LlmProvider } from './types'

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-sonnet-5',
  baseUrl: '',
  writeMode: 'auto',
  allowWatchlistWrite: false
}

const KEY = (k: keyof AiConfig): string => `ai.${k}`

export function loadAiConfig(): AiConfig {
  const cfg = { ...DEFAULT_AI_CONFIG }
  const p = getSetting(KEY('provider'))
  if (p === 'anthropic' || p === 'openai') cfg.provider = p
  cfg.apiKey = getSetting(KEY('apiKey')) ?? ''
  cfg.model = getSetting(KEY('model')) || cfg.model
  cfg.baseUrl = getSetting(KEY('baseUrl')) ?? ''
  const wm = getSetting(KEY('writeMode'))
  if (wm === 'auto' || wm === 'confirm') cfg.writeMode = wm
  cfg.allowWatchlistWrite = getSetting(KEY('allowWatchlistWrite')) === '1'
  return cfg
}

export function saveAiConfig(patch: Partial<AiConfig>): AiConfig {
  const next = { ...loadAiConfig(), ...patch }
  if (next.provider !== 'anthropic' && next.provider !== 'openai') next.provider = 'anthropic'
  if (next.writeMode !== 'auto' && next.writeMode !== 'confirm') next.writeMode = 'auto'
  setSetting(KEY('provider'), next.provider)
  setSetting(KEY('apiKey'), next.apiKey)
  setSetting(KEY('model'), next.model)
  setSetting(KEY('baseUrl'), next.baseUrl)
  setSetting(KEY('writeMode'), next.writeMode)
  setSetting(KEY('allowWatchlistWrite'), next.allowWatchlistWrite ? '1' : '0')
  return next
}

/** 依配置构建 provider；缺少 apiKey 时抛错（openai 兼容可无 key，走本地 Ollama） */
export function getProvider(cfg: AiConfig): LlmProvider {
  if (cfg.provider === 'openai') {
    return new OpenAICompatibleProvider({
      apiKey: cfg.apiKey,
      model: cfg.model,
      baseUrl: cfg.baseUrl
    })
  }
  if (!cfg.apiKey) throw new Error('尚未配置 AI 的 API Key（设置 → AI 后端）')
  return new AnthropicProvider({ apiKey: cfg.apiKey, model: cfg.model })
}
