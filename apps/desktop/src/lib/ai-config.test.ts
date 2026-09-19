import { describe, expect, it } from 'vitest'
import { AI_PRESETS, parseProviderKey } from './ai-config'

describe('AI 一键配置 parseProviderKey（provider:sk-xxx）', () => {
  it('opencode-go → openai provider + OpenCode Go 端点 + deepseek-v4-flash', () => {
    const c = parseProviderKey('opencode-go:sk-abcdef123456')
    expect(c).not.toBeNull()
    expect(c!.provider).toBe('openai')
    expect(c!.baseUrl).toContain('opencode.ai/zen/go/v1')
    expect(c!.model).toBe('deepseek-v4-flash')
    expect(c!.apiKey).toBe('sk-abcdef123456')
  })

  it('opencode 别名同样生效；deepseek → 官方端点', () => {
    const o = parseProviderKey('opencode:sk-x')
    expect(o!.baseUrl).toContain('opencode.ai')
    const d = parseProviderKey('deepseek:sk-x')
    expect(d!.baseUrl).toContain('api.deepseek.com')
    expect(d!.model).toBe('deepseek-v4-flash')
  })

  it('anthropic → anthropic provider；openai → 空 baseUrl', () => {
    const a = parseProviderKey('anthropic:sk-ant-abc')
    expect(a!.provider).toBe('anthropic')
    const o = parseProviderKey('openai:sk-abc')
    expect(o!.provider).toBe('openai')
    expect(o!.baseUrl).toBe('')
  })

  it('非法格式/未知 provider 返回 null', () => {
    expect(parseProviderKey('garbage')).toBeNull()
    expect(parseProviderKey('deepseek:no-sk-prefix')).toBeNull()
    expect(parseProviderKey('foo:sk-bar')).toBeNull()
    expect(parseProviderKey('')).toBeNull()
  })

  it('预设列表含 OpenCode Go / DeepSeek / Ollama', () => {
    expect(AI_PRESETS.map((p) => p.label)).toEqual(['OpenCode Go', 'DeepSeek 官方', 'Ollama 本地'])
    expect(AI_PRESETS[0].cfg.baseUrl).toContain('opencode.ai')
  })
})
