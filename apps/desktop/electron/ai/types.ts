import type { AiProviderId } from '../../shared/types'

/** 传给 LLM 的工具定义（provider 内部转换成各自协议格式） */
export interface LlmTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** 统一消息格式（provider 转换，agent 内部流转） */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  /** 纯文本内容（assistant 带工具调用时也可能有文本说明） */
  content: string
  /** assistant 发起的工具调用（role=assistant 时） */
  toolCalls?: Array<{ id: string; name: string; args: string }>
  /** 工具执行结果回填（role=user 时） */
  toolResults?: Array<{ id: string; name: string; content: string; isError?: boolean }>
}

export interface LlmTurnResult {
  text: string
  toolCalls: Array<{ id: string; name: string; args: unknown }>
  /** end_turn / tool_use / max_tokens / stop 等 */
  stopReason: string
}

export interface LlmProvider {
  id: AiProviderId
  /**
   * 发起一轮对话（会携带全部 tools）。
   * onText/onToolDelta 为流式回调（可选，不实现则按非流式返回）。
   */
  chat(opts: {
    messages: LlmMessage[]
    tools: LlmTool[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
    onText?: (delta: string) => void
    onToolDelta?: (callId: string, name: string, delta: string) => void
  }): Promise<LlmTurnResult>
}
