/**
 * 具名 SSE 解析：pa-agent 使用 `event: <name>` + `data: <json>` 两行一组。
 * 现有 ai/sse.ts 只保留 data 行、丢弃事件名，故此处单独实现。
 */
export interface NamedSseEvent {
  event: string
  data: string
}

export async function* namedSseEvents(res: Response): AsyncGenerator<NamedSseEvent> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let currentEvent = 'message'
  let currentData: string[] = []

  const flush = (): NamedSseEvent | null => {
    if (currentData.length === 0) {
      currentEvent = 'message'
      return null
    }
    const evt = { event: currentEvent, data: currentData.join('\n') }
    currentEvent = 'message'
    currentData = []
    return evt
  }

  /** 解析一行；返回非 null 表示一个事件块结束 */
  const handleLine = (line: string): NamedSseEvent | null => {
    if (line === '') return flush()
    if (line.startsWith(':')) return null // SSE 注释/心跳
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim() || 'message'
    } else if (line.startsWith('data:')) {
      currentData.push(line.slice(5).replace(/^ /, ''))
    }
    return null
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        const evt = handleLine(line)
        if (evt) yield evt
      }
    }
    // 流结束时缓冲区可能还剩最后一行（服务端未以换行收尾），也要解析。
    if (buf) {
      const evt = handleLine(buf.endsWith('\r') ? buf.slice(0, -1) : buf)
      if (evt) yield evt
    }
    const evt = flush()
    if (evt) yield evt
  } finally {
    reader.releaseLock()
  }
}
