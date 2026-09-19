import { describe, expect, it } from 'vitest'
import { namedSseEvents } from './sse'

/** 用 ReadableStream 构造一个 SSE 响应体 */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    }
  })
  return new Response(stream, { status: 200 })
}

async function collect(res: Response): Promise<{ event: string; data: string }[]> {
  const out: { event: string; data: string }[] = []
  for await (const e of namedSseEvents(res)) out.push(e)
  return out
}

describe('具名 SSE 解析', () => {
  it('解析 event + data 成对事件', async () => {
    const events = await collect(
      sseResponse(['event: started\ndata: {"jobId":"abc"}\n\n', 'event: closed\ndata: {}\n\n'])
    )
    expect(events).toEqual([
      { event: 'started', data: '{"jobId":"abc"}' },
      { event: 'closed', data: '{}' }
    ])
  })

  it('跨 chunk 的半个事件能正确拼接', async () => {
    const events = await collect(
      sseResponse(['event: stage1_con', 'tent\ndata: {"text":"你', '好"}\n\n'])
    )
    expect(events).toEqual([{ event: 'stage1_content', data: '{"text":"你好"}' }])
  })

  it('忽略心跳注释行', async () => {
    const events = await collect(
      sseResponse([': keep-alive\n\n', 'event: done\ndata: {"record":{}}\n\n'])
    )
    expect(events).toEqual([{ event: 'done', data: '{"record":{}}' }])
  })

  it('缺 event 名时回退为 message', async () => {
    const events = await collect(sseResponse(['data: {"x":1}\n\n']))
    expect(events).toEqual([{ event: 'message', data: '{"x":1}' }])
  })

  it('多行 data 用换行拼接', async () => {
    const events = await collect(sseResponse(['event: e\ndata: line1\ndata: line2\n\n']))
    expect(events).toEqual([{ event: 'e', data: 'line1\nline2' }])
  })

  it('兼容 CRLF 行尾', async () => {
    const events = await collect(sseResponse(['event: a\r\ndata: {}\r\n\r\n']))
    expect(events).toEqual([{ event: 'a', data: '{}' }])
  })

  it('流末尾未以空行收尾的事件也会被取出', async () => {
    const events = await collect(sseResponse(['event: tail\ndata: {"n":1}']))
    expect(events).toEqual([{ event: 'tail', data: '{"n":1}' }])
  })

  it('无响应体时返回空', async () => {
    const events = await collect(new Response(null, { status: 204 }))
    expect(events).toEqual([])
  })
})
