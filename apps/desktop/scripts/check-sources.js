// 数据源可用性检查：新浪 / 腾讯 / baostock 的分钟K线(1/5/15/30/60/120) + 季K + 5日分时
// 用 node:https 强制 IPv4（与应用 http.ts 一致）
const https = require('https')

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { family: 4, timeout: 15000 }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      .on('error', reject)
      .on('timeout', () => reject(new Error('timeout')))
  })
}

async function main() {
  const code = 'sh600519'

  // 1) 新浪分钟K线 scale=5/15/30/60
  console.log('=== 新浪 getKLineData scale=N ===')
  for (const scale of [1, 5, 15, 30, 60]) {
    const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${code}&scale=${scale}&ma=no&datalen=100`
    try {
      const buf = await get(url)
      const text = buf.toString('utf-8')
      const m = text.match(/var _data=\((.*)\)\s*;?/s)
      const arr = m ? JSON.parse(m[1]) : []
      const last = arr[arr.length - 1]
      console.log(`  scale=${scale}: n=${arr.length} first=${arr[0]?.day} last=${last?.day} close=${last?.close}`)
    } catch (e) {
      console.log(`  scale=${scale}: ERR ${String(e).slice(0, 60)}`)
    }
  }

  // 2) 腾讯分钟K线 mkline m5/m15/m30/m60
  console.log('=== 腾讯 mkline ===')
  for (const period of ['m1', 'm5', 'm15', 'm30', 'm60']) {
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},${period},,100`
    try {
      const buf = await get(url)
      const j = JSON.parse(buf.toString('utf-8'))
      const d = j?.data?.[code]?.[period]
      const arr = Array.isArray(d) ? d : []
      const last = arr[arr.length - 1]
      console.log(`  ${period}: n=${arr.length} first=${arr[0]?.[0]} last=${last?.[0]} close=${last?.[2]}`)
    } catch (e) {
      console.log(`  ${period}: ERR ${String(e).slice(0, 60)}`)
    }
  }

  // 3) 新浪 5 日分时（scale=1 datalen 较大）
  console.log('=== 新浪 scale=1 5日分时（datalen=1023）===')
  const url5 = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${code}&scale=1&ma=no&datalen=1023`
  try {
    const buf = await get(url5)
    const text = buf.toString('utf-8')
    const m = text.match(/var _data=\((.*)\)\s*;?/s)
    const arr = m ? JSON.parse(m[1]) : []
    const days = [...new Set(arr.map((x) => x.day.slice(0, 10)))]
    console.log(`  n=${arr.length} 交易日数=${days.length} 日期=${days.join(',')}`)
  } catch (e) {
    console.log(`  ERR ${String(e).slice(0, 60)}`)
  }
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
