// 视觉测试：分时多周期（1/5/15/30/60/120分钟K线）+ 5日分时 + 季K 数据显示
// 运行: cd desktop && npx playwright test scripts/visual-test-periods.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test('分时多周期 + 5日 + 季K 数据显示', async () => {
  test.setTimeout(180_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  const code = (await win.locator('.detail-name-box .stock-code').textContent()).trim()
  const secid = (code.startsWith('6') ? '1.' : '0.') + code

  const chartOk = () =>
    win.evaluate(() => {
      const panes = document.querySelectorAll('.chart-pane')
      let canvas = 0
      let empty = 0
      for (const p of panes) {
        if (p.classList.contains('pane-hidden')) continue
        if (p.querySelector('.chart-box canvas')) canvas++
        if (p.querySelector('.empty')) empty++
      }
      return { canvas, empty }
    })

  // 1) 分钟K线（1/5/15/30/60/120）
  const counts = {}
  for (const klt of [1, 5, 15, 30, 60, 120]) {
    await win.getByText(`${klt}分`, { exact: true }).click()
    await win.waitForTimeout(2500)
    const s = await chartOk()
    expect(s.canvas).toBeGreaterThanOrEqual(1)
    expect(s.empty).toBe(0)
    const data = await win.evaluate(
      async ({ sid, k }) => {
        const r = await window.api.market.getKline(sid, k, 1)
        return { n: r?.points?.length ?? 0, first: r?.points?.[0]?.time, last: r?.points?.[r.points.length - 1]?.time }
      },
      { sid: secid, k: klt }
    )
    expect(data.n).toBeGreaterThan(0)
    counts[klt] = data.n
    console.log(`✓ ${klt}分K线: ${data.n} 根（${data.first} → ${data.last}）`)
  }
  // 120分由60分聚合 → 数量应显著少于60分
  expect(counts[120]).toBeLessThan(counts[60])
  console.log(`✓ 120分聚合: 60分${counts[60]} → 120分${counts[120]}`)

  // 2) 5日分时（多日 + 带日期）
  await win.getByText('5日', { exact: true }).click()
  await win.waitForTimeout(2500)
  const s5 = await chartOk()
  expect(s5.canvas).toBeGreaterThanOrEqual(1)
  const m5 = await win.evaluate(
    async ({ sid }) => {
      const r = await window.api.market.getMinute(sid, 5)
      return { n: r?.points?.length ?? 0, hasDate: r?.points?.some((p) => p.time.includes(' ')) ?? false }
    },
    { sid: secid }
  )
  expect(m5.n).toBeGreaterThan(500) // 5日分时应远多于单日 ~238
  expect(m5.hasDate).toBe(true)
  console.log(`✓ 5日分时: ${m5.n} 点，带日期`)

  // 3) 季K（本地日线聚合）
  await win.getByText('季K', { exact: true }).click()
  await win.waitForTimeout(2500)
  const sq = await chartOk()
  expect(sq.canvas).toBeGreaterThanOrEqual(1)
  const q = await win.evaluate(
    async ({ sid }) => {
      const r = await window.api.market.getKline(sid, 104, 1)
      return { n: r?.points?.length ?? 0, first: r?.points?.[0]?.time, last: r?.points?.[r.points.length - 1]?.time }
    },
    { sid: secid }
  )
  expect(q.n).toBeGreaterThan(20)
  console.log(`✓ 季K: ${q.n} 根（${q.first} → ${q.last}）`)

  await win.screenshot({ path: path.join(SHOTS_DIR, 'periods-all.png') })
  await app.close()
})
