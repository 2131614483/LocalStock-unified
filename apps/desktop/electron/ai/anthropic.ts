import type { AiProviderId } from '../../shared/types'
import type { LlmMessage, LlmProvider, LlmTool, LlmTurnResult } from './types'
import { sseData } from './sse'

const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

/** 把统一消息转成 Anthropic messages content 数组 */
function toAnthropicMessages(messages: LlmMessage[]): Array<{ role: string; content: AnthropicContentBlock[] }> {
  const out: Array<{ role: string; content: AnthropicContentBlock[] }> = []
  for (const m of messages) {
    if (m.role === 'system') continue // system 单独走 system 参数
    const blocks: AnthropicContentBlock[] = []
    if (m.content) blocks.push({ type: 'text', text: m.content })
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        let input: unknown = {}
        try {
          input = tc.args ? JSON.parse(tc.args) : {}
        } catch {
          input = {}
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
      }
    }
    if (m.role === 'user' && m.toolResults?.length) {
      for (const tr of m.toolResults) {
        blocks.push({
          type: 'tool_result',
          tool_use_id: tr.id,
          content: tr.content,
          is_error: !!tr.isError
        })
      }
    }
    if (blocks.length) out.push({ role: m.role, content: blocks })
  }
  return out
}

export class AnthropicProvider implements LlmProvider {
  readonly id: AiProviderId = 'anthropic'

  constructor(private cfg: { apiKey: string; model: string }) {}

  async chat(opts: {
    messages: LlmMessage[]
    tools: LlmTool[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
    onText?: (delta: string) => void
    onToolDelta?: (callId: string, name: string, delta: string) => void
  }): Promise<LlmTurnResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      max_tokens: opts.maxTokens ?? 4000,
      messages: toAnthropicMessages(opts.messages),
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema
      }))
    }
    if (opts.system) body.system = opts.system
    if (opts.onText || opts.onToolDelta) body.stream = true

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal: opts.signal
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`)
    }

    if (!body.stream) {
      const data = (await res.json()) as {
        content?: AnthropicContentBlock[]
        stop_reason?: string
      }
      return parseBlocks(data.content ?? [], data.stop_reason)
    }

    return streamAnthropic(res, opts)
  }
}

/** 非流式：解析 content blocks */
function parseBlocks(
  blocks: AnthropicContentBlock[],
  stopReason?: string
): LlmTurnResult {
  let text = ''
  const toolCalls: LlmTurnResult['toolCalls'] = []
  for (const b of blocks) {
    if (b.type === 'text') text += b.text ?? ''
    else if (b.type === 'tool_use') {
      toolCalls.push({ id: b.id ?? '', name: b.name ?? '', args: b.input ?? {} })
    }
  }
  return { text, toolCalls, stopReason: stopReason ?? 'end_turn' }
}

interface StreamBlockState {
  type: 'text' | 'tool_use'
  id?: string
  name?: string
  /** tool_use 的 input JSON 累积 */
  jsonBuf: string
}

function streamAnthropic(
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
      const blocks = new Map<number, StreamBlockState>()
      let stopReason = 'end_turn'
      try {
        for await (const data of sseData(res)) {
          let ev: { type: string; [k: string]: unknown }
          try {
            ev = JSON.parse(data)
          } catch {
            continue
          }
          if (ev.type === 'content_block_start') {
            const index = ev.index as number
            const cb = ev.content_block as AnthropicContentBlock
            if (cb.type === 'tool_use') {
              blocks.set(index, { type: 'tool_use', id: cb.id, name: cb.name, jsonBuf: '' })
            } else {
              blocks.set(index, { type: 'text', jsonBuf: '' })
            }
          } else if (ev.type === 'content_block_delta') {
            const index = ev.index as number
            const st = blocks.get(index)
            if (!st) continue
            const delta = ev.delta as { type: string; text?: string; partial_json?: string }
            if (delta.type === 'text_delta' && delta.text) {
              text += delta.text
              opts.onText?.(delta.text)
            } else if (delta.type === 'input_json_delta' && delta.partial_json) {
              st.jsonBuf += delta.partial_json
              if (st.id && st.name) opts.onToolDelta?.(st.id, st.name, delta.partial_json)
            }
          } else if (ev.type === 'content_block_stop') {
            const index = ev.index as number
            const st = blocks.get(index)
            if (st && st.type === 'tool_use' && st.id && st.name) {
              let args: unknown = {}
              try {
                args = st.jsonBuf ? JSON.parse(st.jsonBuf) : {}
              } catch {
                args = {}
              }
              toolCalls.push({ id: st.id, name: st.name, args })
            }
          } else if (ev.type === 'message_delta') {
            const d = ev.delta as { stop_reason?: string }
            if (d.stop_reason) stopReason = d.stop_reason
          } else if (ev.type === 'error') {
            throw new Error(`Anthropic stream error: ${JSON.stringify(ev.error)}`)
          }
        }
        resolve({ text, toolCalls, stopReason })
      } catch (err) {
        reject(err)
      }
    })()
  })
}
