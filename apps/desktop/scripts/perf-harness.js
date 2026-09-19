// 性能 harness 冒烟：测量 K线周期切换 UI 延迟、数据 IPC 延迟、quotes 推送间隔
// 输出 runs/<run_id>/timings/ui_latency.json（P50/P95/max/mean）
const { _electron } = require('playwright')
const path = require('path')
const fs = require('fs')

const runId = `perf-${Date.now()}`
const outDir = path.resolve(__dirname, '../runs', runId, 'timings')
const SHOTS = path.resolve(__dirname, '../test-results')

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  return {
    samples: arr.length,
    p50: Math.round(q(0.5)),
    p95: Math.round(q(0.95)),
    max: Math.round(s[s.length - 1]),
    mean: Math.round(mean)
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe') })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 进详情
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  const code = (await win.locator('.detail-name-box .stock-code').textContent()).trim()
  const secid = (code.startsWith('6') ? '1.' : '0.') + code
  await win.getByText('日K', { exact: true }).click()
  await win.waitForTimeout(3000)

  // 1) 数据 IPC 延迟（getKline 各周期）
  const dataLat = {}
  for (const klt of [101, 102, 103, 104, 60]) {
    const samples = []
    for (let i = 0; i < 3; i++) {
      samples.push(
        await win.evaluate(async ({ sid, k }) => {
          const t0 = performance.now()
          await window.api.market.getKline(sid, k, 1)
          return performance.now() - t0
        }, { sid: secid, k: klt })
      )
    }
    dataLat[`klt${klt}`] = stats(samples)
  }

  // 2) K线周期切换 UI 延迟（点击 tab → canvas 有内容）
  const uiLat = {}
  for (const label of ['周K', '月K', '季K', '日K']) {
    const samples = []
    for (let i = 0; i < 3; i++) {
      const v = await win.evaluate(
        async (lbl) => {
          const t0 = performance.now()
          const tabs = [...document.querySelectorAll('.tab')]
          const target = tabs.find((t) => t.textContent.trim() === lbl)
          if (!target) return null
          target.click()
          // 轮询可见 chart-pane 的 canvas 出现内容
          for (let j = 0; j < 300; j++) {
            const pane = [...document.querySelectorAll('.chart-pane')].find((p) => !p.classList.contains('pane-hidden'))
            const c = pane?.querySelector('.chart-box canvas')
            if (c && c.width > 0) {
              const ctx = c.getContext('2d')
              const img = ctx.getImageData(0, 0, Math.min(c.width, 120), Math.min(c.height, 120)).data
              let bright = 0
              for (let k = 0; k < img.length; k += 4) if ((img[k] + img[k + 1] + img[k + 2]) / 3 > 30) bright++
              if (bright > 40) return performance.now() - t0
            }
            await new Promise((r) => setTimeout(r, 10))
          }
          return null
        },
        label
      )
      samples.push(v === null ? Infinity : v)
    }
    uiLat[label] = stats(samples.filter((v) => Number.isFinite(v)))
  }

  // 3) quotes 推送间隔（订阅 6 次）
  const pushDiffs = await win.evaluate(async () => {
    const ts = []
    await new Promise((resolve) => {
      const off = window.api.market.onQuotes(() => {
        ts.push(performance.now())
        if (ts.length >= 6) {
          off()
          resolve()
        }
      })
    })
    return ts.slice(1).map((t, i) => t - ts[i])
  })
  const quotesPush = stats(pushDiffs)

  const report = {
    run_id: runId,
    ts: new Date().toISOString(),
    app: 'LocalStock desktop',
    secid,
    data_latency_ms: dataLat,
    ui_switch_latency_ms: uiLat,
    quotes_push_interval_ms: quotesPush
  }
  fs.writeFileSync(path.join(outDir, 'ui_latency.json'), JSON.stringify(report, null, 2))
  await win.screenshot({ path: path.join(SHOTS, 'perf-harness.png') })
  await app.close()
  console.log('=== 性能报告 ===')
  console.log(JSON.stringify(report, null, 2))
  console.log('已写入', path.join(outDir, 'ui_latency.json'))
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
