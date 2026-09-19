// 串行请求节流：东财接口短时高频请求会限流（实测 HTTP 000），
// 因此所有对外行情请求走同一个队列，按最小间隔串行发出。
export class Limiter {
  private queue: Array<() => Promise<void>> = []
  private running = false
  private lastRun = 0
  private readonly minInterval: number
  private readonly maxQueue: number

  constructor(minInterval = 250, maxQueue = 200) {
    this.minInterval = minInterval
    this.maxQueue = maxQueue
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.maxQueue) {
      // 队列过满时丢弃最老的排队任务，避免无限堆积
      this.queue.shift()
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn())
        } catch (err) {
          reject(err)
        }
      })
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.queue.length > 0) {
      const wait = this.minInterval - (Date.now() - this.lastRun)
      if (wait > 0) await sleep(wait)
      this.lastRun = Date.now()
      const task = this.queue.shift()
      if (task) {
        try {
          await task()
        } catch {
          // 错误已在 Promise 内 reject 到调用方，这里忽略
        }
      }
    }
    this.running = false
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 全局唯一节流器，供所有行情模块复用 */
export const globalLimiter = new Limiter()
