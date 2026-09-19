// M6 长稳冒烟：周期采样渲染进程 JS 堆内存 + 模拟交互 + 崩溃检测
// 用法: node scripts/perf-soak.js [minutes=30]
const { _electron } = require('playwright')
const path = require('path')
const fs = require('fs')

const minutes = Math.max(1, parseInt(process.argv[2] || '30', 10) || 30)
const runId = `soak-${Date.now()}`
const outDir = path.resolve(__dirname, '../runs', runId)
const INTERVAL_MS = 30_000

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe') })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 进入详情/日K，制造交互负载
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await win.getByText('日K', { exact: true }).click()
  await win.waitForTimeout(2000)

  const samples = []
  const total = minutes * 60_000
  const startedAt = Date.now()
  let crashed = false

  while (Date.now() - startedAt < total) {
    try {
      // 模拟交互：切换周期（制造重绘/内存压力）
      const label = ['周K', '月K', '季K', '日K'][Math.floor(Date.now() / 1000) % 4]
      await win.evaluate((lbl) => {
        const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim() === lbl)
        if (t) t.click()
      }, label)
      await win.waitForTimeout(800)
      const mem = await win.evaluate(() => {
        const m = performance.memory
        return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null
      })
      samples.push({
        t_sec: Math.round((Date.now() - startedAt) / 1000),
        usedJSHeapMB: mem ? Math.round(mem.used / 1048576) : null,
        totalJSHeapMB: mem ? Math.round(mem.total / 1048576) : null
      })
      console.log(`[soak] t=${samples[samples.length - 1].t_sec}s usedJS=${samples[samples.length - 1].usedJSHeapMB}MB`)
    } catch (e) {
      crashed = true
      console.log('[soak] CRASH/丢失渲染进程:', String(e).slice(0, 80))
      break
    }
    await win.waitForTimeout(INTERVAL_MS - 800)
  }

  // 内存增长分析：末段 vs 首段均值，判断是否单调失控
  const used = samples.map((s) => s.usedJSHeapMB ?? 0)
  const n = used.length
  const firstAvg = used.slice(0, Math.max(1, Math.floor(n / 3))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(n / 3))
  const lastAvg = used.slice(-Math.max(1, Math.floor(n / 3))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(n / 3))
  const growthMB = Math.round(lastAvg - firstAvg)

  const report = {
    run_id: runId,
    minutes,
    samples_count: samples.length,
    crashed,
    growth_first_vs_last_MB: growthMB,
    monotonic_runaway: growthMB > 100, // 100MB+ 增长视为失控（提示）
    samples
  }
  fs.writeFileSync(path.join(outDir, 'soak-memory.json'), JSON.stringify(report, null, 2))
  await app.close()
  console.log('=== 长稳冒烟 ===')
  console.log(`运行 ${minutes} 分钟，采样 ${samples.length} 次，崩溃=${crashed}，首末段内存增长=${growthMB}MB`)
  console.log(crashed ? 'SOAK CRASHED' : growthMB > 100 ? 'MEMORY GROWTH WARNING' : 'SOAK OK (无崩溃，内存稳定)')
  console.log('已写入', path.join(outDir, 'soak-memory.json'))
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
