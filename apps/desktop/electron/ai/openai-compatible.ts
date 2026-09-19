import type { AiProviderId } from '../../shared/types'
import type { LlmMessage, LlmProvider, LlmTool, LlmTurnResult } from './types'
import { sseData } from './sse'

/** OpenAI Chat Completions 兼容（含本地 Ollama /v1）。函数工具走 function calling。 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: AiProviderId = 'openai'

  constructor(private cfg: { apiKey: string; model: string; baseUrl: string }) {}

  private url(): string {
    const base = this.cfg.baseUrl || 'https://api.openai.com/v1'
    return base.replace(/\/$/, '') + '/chat/completions'
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`
    return h
  }

  async chat(opts: {
    messages: LlmMessage[]
    tools: LlmTool[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
    onText?: (delta: string) => void
    onToolDelta?: (callId: string, name: string, delta: string) => void
  }): Promise<LlmTurnResult> {
    const messages = toOpenAIMessages(opts.messages)
    if (opts.system) messages.unshift({ role: 'system', content: opts.system })
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      tools: opts.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema }
      }))
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens
    if (opts.onText || opts.onToolDelta) body.stream = true

    const res = await fetch(this.url(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: opts.signal
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`OpenAI 兼容 API ${res.status}: ${detail.slice(0, 300)}`)
    }

    if (!body.stream) {
      const data = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
          finish_reason?: string | null
        }>
      }
      const choice = data.choices?.[0]
      const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => {
        let args: unknown = {}
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
        } catch {
          args = {}
        }
        return { id: tc.id, name: tc.function.name, args }
      })
      return {
        text: choice?.message?.content ?? '',
        toolCalls,
        stopReason: choice?.finish_reason ?? 'end_turn'
      }
    }

    return streamOpenAI(res, opts)
  }
}

function toOpenAIMessages(messages: LlmMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args }
        }))
      }
      out.push(msg)
      continue
    }
    // user
    if (m.content) out.push({ role: 'user', content: m.content })
    for (const tr of m.toolResults ?? []) {
      out.push({ role: 'tool', tool_call_id: tr.id, content: tr.content })
    }
  }
  return out
}

function streamOpenAI(
  res: Response,
  opts: {
    onText?: (delta: string) => void
    onToolDelta?: (callId: string, name: string, delta: string) => void
  }
): Promise<LlmTurnResult> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let text = ''
      const toolCalls: LlmTurnResult['toolCalls'] = []
      const toolState = new Map<
        number,
        { id?: string; name: string; argsBuf: string }
      >()
      let stopReason = ''
      try {
        for await (const data of sseData(res)) {
          if (data === '[DONE]') break
          let ev: { choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }> }
          try {
            ev = JSON.parse(data)
          } catch {
            continue
          }
          const choice = ev.choices?.[0]
          if (!choice) continue
          const delta = choice.delta ?? {}
          const content = delta.content as string | undefined
          if (content) {
            text += content
            opts.onText?.(content)
          }
          const tc = delta.tool_calls as Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }> | undefined
          if (tc) {
            for (const t of tc) {
              const idx = t.index ?? 0
              let st = toolState.get(idx)
              if (!st) {
                st = { name: '', argsBuf: '' }
                toolState.set(idx, st)
              }
              if (t.id) st.id = t.id
              if (t.function?.name) st.name = t.function.name
              if (t.function?.arguments) {
                st.argsBuf += t.function.arguments
                if (st.id && st.name) opts.onToolDelta?.(st.id, st.name, t.function.arguments)
              }
            }
          }
          if (choice.finish_reason) stopReason = choice.finish_reason
        }
        for (const st of toolState.values()) {
          if (!st.id || !st.name) continue
          let args: unknown = {}
          try {
            args = st.argsBuf ? JSON.parse(st.argsBuf) : {}
          } catch {
            args = {}
          }
          toolCalls.push({ id: st.id, name: st.name, args })
        }
        resolve({ text, toolCalls, stopReason: stopReason || 'end_turn' })
      } catch (err) {
        reject(err)
      }
    })()
  })
}
