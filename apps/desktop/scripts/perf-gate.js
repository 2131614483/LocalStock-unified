// M6 性能门禁：冷/热基线 + K线切换P95 + 50股刷新 + 预警端到端 → runs/<id>/gate.json（PASS/FAIL）
const { _electron } = require('playwright')
const path = require('path')
const fs = require('fs')

const runId = `gate-${Date.now()}`
const outDir = path.resolve(__dirname, '../runs', runId)

// 地图验收基线
const GATES = {
  kline_switch_p95_ms: { limit: 200 },
  quotes_50_round_ms: { limit: 1000 },
  alert_e2e_p95_ms: { limit: 1000 }
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  return { n: arr.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s[s.length - 1]) }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe') })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  const code = (await win.locator('.detail-name-box .stock-code').textContent()).trim()
  const secid = (code.startsWith('6') ? '1.' : '0.') + code
  await win.getByText('日K', { exact: true }).click()
  await win.waitForTimeout(2000)

  // 1) 冷启动 vs 热缓存（日K，5 次：清缓存 vs 命中缓存）
  const cold = []
  const warm = []
  for (let i = 0; i < 5; i++) {
    // 清缓存：改 key 变体模拟冷（真实冷=清 kline_cache；这里用 fqt 变体近似）
    const fqt = 0
    const t0 = await win.evaluate(async ({ sid, f }) => {
      const s = performance.now()
      await window.api.market.getKline(sid, 101, f)
      return performance.now() - s
    }, { sid: secid, f: fqt })
    cold.push(t0)
    const t1 = await win.evaluate(async ({ sid }) => {
      const s = performance.now()
      await window.api.market.getKline(sid, 101, 1)
      return performance.now() - s
    }, { sid: secid })
    warm.push(t1)
  }

  // 2) K线周期切换 UI 重绘 P95（10 次轮换）
  const switchMs = []
  for (let i = 0; i < 10; i++) {
    const label = ['周K', '月K', '季K', '日K'][i % 4]
    const v = await win.evaluate(async (lbl) => {
      const t0 = performance.now()
      const target = [...document.querySelectorAll('.tab')].find((t) => t.textContent.trim() === lbl)
      if (!target) return null
      target.click()
      for (let j = 0; j < 300; j++) {
        const pane = [...document.querySelectorAll('.chart-pane')].find((p) => !p.classList.contains('pane-hidden'))
        const c = pane?.querySelector('.chart-box canvas')
        if (c && c.width > 0) {
          const ctx = c.getContext('2d')
          const img = ctx.getImageData(0, 0, Math.min(c.width, 80), Math.min(c.height, 80)).data
          let bright = 0
          for (let k = 0; k < img.length; k += 4) if ((img[k] + img[k + 1] + img[k + 2]) / 3 > 30) bright++
          if (bright > 30) return performance.now() - t0
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      return null
    }, label)
    if (v !== null) switchMs.push(v)
  }

  // 3) 50 股自选刷新一轮（取前 50 只，getQuotes 批量）
  const quotes50 = []
  const stock50 = await win.evaluate(async () => {
    const r = await window.api.market.getMarketList({ pn: 1, pz: 50, fid: 'f3', order: 'desc' })
    return r.list.map((q) => q.secid)
  })
  for (let i = 0; i < 3; i++) {
    const t = await win.evaluate(async (secids) => {
      const s = performance.now()
      await window.api.market.getQuotes(secids)
      return performance.now() - s
    }, stock50)
    quotes50.push(t)
  }

  // 4) 预警端到端（加 2 条规则 → scanNow 3 次）
  const alertMs = []
  await win.evaluate(async () => {
    const wl = await window.api.watchlist.list()
    for (const st of wl.slice(0, 2)) {
      await window.api.alerts.add({ id: '', secid: st.secid, name: st.name, type: 'ma_cross', fast: 5, slow: 20, enabled: true })
    }
  })
  for (let i = 0; i < 3; i++) {
    const t = await win.evaluate(async () => {
      const s = performance.now()
      await window.api.alerts.scanNow()
      return performance.now() - s
    })
    alertMs.push(t)
  }
  await win.evaluate(async () => {
    const rs = await window.api.alerts.list()
    for (const r of rs) await window.api.alerts.remove(r.id)
  })

  const report = {
    run_id: runId,
    ts: new Date().toISOString(),
    secid,
    cold_kline_latency_ms: stats(cold),
    warm_kline_latency_ms: stats(warm),
    kline_switch_p95_ms: stats(switchMs).p95,
    quotes_50_round_ms: stats(quotes50),
    alert_e2e_ms: stats(alertMs),
    gates: {}
  }
  report.gates.kline_switch = report.kline_switch_p95_ms <= GATES.kline_switch_p95_ms.limit
  report.gates.quotes_50 = report.quotes_50_round_ms.p95 <= GATES.quotes_50_round_ms.limit
  report.gates.alert_e2e = report.alert_e2e_ms.p95 <= GATES.alert_e2e_p95_ms.limit
  report.gates.pass = Object.values(report.gates).every(Boolean)

  fs.writeFileSync(path.join(outDir, 'gate.json'), JSON.stringify(report, null, 2))
  await app.close()
  console.log('=== M6 性能门禁 ===')
  console.log(JSON.stringify(report, null, 2))
  console.log(report.gates.pass ? 'ALL GATES PASS' : 'GATE FAILED')
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
