import { describe, expect, it } from 'vitest'
import { Limiter, sleep } from './limiter'

describe('Limiter（串行节流队列）', () => {
  it('串行执行，相邻任务间隔不小于 minInterval', async () => {
    const limiter = new Limiter(60)
    const marks: number[] = []
    const tasks = Array.from({ length: 4 }, (_, i) =>
      limiter.run(async () => {
        marks.push(Date.now())
        return i
      })
    )
    await Promise.all(tasks)
    expect(marks.length).toBe(4)
    for (let i = 1; i < marks.length; i++) {
      // 允许 ~2ms setTimeout 计时抖动
      expect(marks[i] - marks[i - 1]).toBeGreaterThanOrEqual(58)
    }
  })

  it('队列超过 maxQueue 时丢弃最旧的排队任务，避免无限堆积', async () => {
    const limiter = new Limiter(30, 2) // maxQueue=2
    const executed: number[] = []
    // 第一个任务慢（占用 drain），期间快速推入 B/C/D
    const a = limiter.run(async () => {
      executed.push(0)
      await sleep(200)
    })
    const b = limiter.run(async () => executed.push(1)) // 应被丢弃
    const c = limiter.run(async () => executed.push(2))
    const d = limiter.run(async () => executed.push(3))
    await a
    await c
    await d
    expect(executed).toContain(0) // A 执行
    expect(executed).not.toContain(1) // B 被丢弃
    expect(executed).toContain(2)
    expect(executed).toContain(3)
  })

  it('任务抛出时 reject 给调用方', async () => {
    const limiter = new Limiter(0)
    await expect(
      limiter.run(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })
})
