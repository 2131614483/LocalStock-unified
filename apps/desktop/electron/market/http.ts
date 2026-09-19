import https from 'node:https'
import { globalLimiter } from './limiter'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/**
 * 用 node:https 强制 IPv4 请求。
 * 背景：本机 IPv6 到行情接口不可达，全局 fetch(undici) 默认按 DNS 顺序可能走 IPv6
 * 导致连接被服务端关闭（UND_ERR_SOCKET）。family: 4 保证走 IPv4，与 curl 实测一致。
 */
function request(url: string, headers: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { family: 4, headers: { 'User-Agent': UA, Accept: '*/*', ...headers } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          if (status >= 400) {
            reject(new Error(`HTTP ${status} for ${url}`))
            return
          }
          resolve(Buffer.concat(chunks))
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
  })
}

/** 通过节流器发起一次 GET，返回 JSON */
export async function fetchJson<T>(url: string): Promise<T> {
  return globalLimiter.run(async () => {
    const buf = await request(url, { Referer: 'https://quote.eastmoney.com/' })
    return JSON.parse(buf.toString('utf-8')) as T
  })
}

/** 通过节流器发起一次 GET，返回原始字节（供 GBK 解码） */
export async function fetchText(url: string): Promise<Buffer> {
  return globalLimiter.run(() => request(url, { Referer: 'https://finance.qq.com/' }))
}
