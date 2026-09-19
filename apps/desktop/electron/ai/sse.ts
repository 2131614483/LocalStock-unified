/**
 * 极简 SSE（Server-Sent Events）解析：把 fetch 响应体逐行解出 data: 负载。
 * 兼容 Anthropic / OpenAI 两类流式协议（都走 `data: {json}` 行）。
 */
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
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
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (data) yield data
        }
      }
    }
    // 尾部残留
    const tail = buf.trim()
    if (tail.startsWith('data:')) {
      const data = tail.slice(5).trim()
      if (data) yield data
    }
  } finally {
    reader.releaseLock()
  }
}
