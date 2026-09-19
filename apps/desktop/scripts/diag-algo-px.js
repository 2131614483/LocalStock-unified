// 像素探针：扫描 canvas 找算法画线的红/绿/蓝水平线像素行分布
const { _electron } = require('playwright')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

async function main() {
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await win.waitForTimeout(6000)
  await win.locator('.stock-table tbody tr').first().waitFor({ timeout: 30_000 })
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(5000)
  const secid = await win.evaluate(() => {
    const code = document.querySelector('.detail-name-box .stock-code')?.textContent?.trim()
    return (code?.startsWith('6') ? '1.' : '0.') + code
  })
  // 上次已生成算法画线（红/绿 hline + 蓝 segment），直接进日K看 canvas
  await win.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent?.trim() === '日K')
    t?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(5000)

  const px = await win.evaluate(() => {
    const c = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
    if (!c) return { err: 'no canvas' }
    const ctx = c.getContext('2d')
    const img = ctx.getImageData(0, 0, c.width, c.height).data
    // 目标色：红压力 #f5222d(245,34,45) 绿支撑 #14b143(20,177,67) 蓝趋势 #2f81f7(47,129,247) 白手动 #fff
    const targets = {
      red: { r: 245, g: 34, b: 45, tol: 14, rows: [] },
      green: { r: 20, g: 177, b: 67, tol: 14, rows: [] },
      blue: { r: 47, g: 129, b: 247, tol: 20, rows: [] },
      white: { r: 255, g: 255, b: 255, tol: 6, rows: [] }
    }
    const w = c.width
    for (let y = 0; y < c.height; y++) {
      let rc = 0, gc = 0, bc = 0, wc = 0
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4
        const [r, g, b, a] = [img[i], img[i + 1], img[i + 2], img[i + 3]]
        if (a < 200) continue
        for (const [k, t] of Object.entries(targets)) {
          if (Math.abs(r - t.r) <= t.tol && Math.abs(g - t.g) <= t.tol && Math.abs(b - t.b) <= t.tol) {
            if (k === 'red') rc++
            if (k === 'green') gc++
            if (k === 'blue') bc++
            if (k === 'white') wc++
          }
        }
      }
      if (rc > 20) targets.red.rows.push({ y, c: rc })
      if (gc > 20) targets.green.rows.push({ y, c: gc })
      if (bc > 20) targets.blue.rows.push({ y, c: bc })
      if (wc > 20) targets.white.rows.push({ y, c: wc })
    }
    const summarize = (t) => t.rows.length ? { rows: t.rows.length, maxCount: Math.max(...t.rows.map((r) => r.c)), sampleYs: t.rows.slice(0, 3).map((r) => r.y) } : { rows: 0 }
    return { w, h: c.height, red: summarize(targets.red), green: summarize(targets.green), blue: summarize(targets.blue), white: summarize(targets.white) }
  })
  console.log('canvas 像素:', JSON.stringify(px, null, 2))
  await app.close()
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })