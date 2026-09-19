import type { AiConfig } from '../../shared/types'

/** AI 后端预设（一键填充 baseUrl+model） */
export const AI_PRESETS: Array<{ label: string; cfg: Partial<AiConfig> }> = [
  { label: 'OpenCode Go', cfg: { provider: 'openai', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash' } },
  { label: 'DeepSeek 官方', cfg: { provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' } },
  { label: 'Ollama 本地', cfg: { provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' } }
]

/**
 * 解析 "provider:sk-xxx" 一键配置（兼容 opencode-go / deepseek / anthropic / openai）。
 * 返回要合并进 AiConfig 的片段；无法识别返回 null。
 */
export function parseProviderKey(raw: string): Partial<AiConfig> | null {
  const m = /^([a-zA-Z0-9_-]+):(sk-[\w-]+)$/.exec(raw.trim())
  if (!m) return null
  const name = m[1].toLowerCase()
  const apiKey = m[2]
  if (name === 'anthropic') {
    return { provider: 'anthropic', apiKey, model: 'claude-sonnet-5' }
  }
  if (name === 'deepseek') {
    return { provider: 'openai', apiKey, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' }
  }
  if (name === 'opencode-go' || name === 'opencode') {
    return { provider: 'openai', apiKey, baseUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash' }
  }
  if (name === 'openai') {
    return { provider: 'openai', apiKey, baseUrl: '', model: 'gpt-4o-mini' }
  }
  return null
}
