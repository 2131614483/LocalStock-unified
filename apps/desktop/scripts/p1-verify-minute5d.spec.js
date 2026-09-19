// B4 验证：5日分时的价格/量能分割拖拽生效
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

test('B4 验证：5日分时分割拖拽', async () => {
  test.setTimeout(150_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // 焦点必须显式给窗口：不在前台时 Windows 会吞 mouse down（拖拽全失效）
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.show()
    w.focus()
  })
  await win.waitForTimeout(6000)

  // 进第一只自选详情（行情 1s 刷新会让行"不稳定"，用 JS click 绕过 Playwright 稳定性检测）
  await win.evaluate(() =>
    document.querySelector('.stock-table tbody tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  )
  await win.waitForTimeout(4000)
  // 切 5日 分时
  await win.evaluate(() => {
    const tab = [...document.querySelectorAll('.tab')].find((t) => t.textContent?.trim() === '5日')
    tab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(4000)

  // 拖价格/量能分割条上移 60px
  const split = win.locator('.chart-h-split').first()
  const box = await split.boundingBox()
  if (!box) throw new Error('分割条不存在')
  const gridBefore = await win.evaluate(() => {
    // 5日分支 grid: [0]=价格(top 28, height pricePct%) [1]=量能
    const chartDom = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box')
    const inst = window.echarts?.getInstanceByDom?.(chartDom)
    if (!inst) return null
    const opt = inst.getOption()
    return { g0h: opt.grid[0].height, g1top: opt.grid[1].top }
  })
  await win.mouse.move(box.x + box.width / 2, box.y + 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 5 })
  await win.mouse.up()
  await win.waitForTimeout(800)
  const gridAfter = await win.evaluate(() => {
    const chartDom = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box')
    const inst = window.echarts?.getInstanceByDom?.(chartDom)
    if (!inst) return null
    const opt = inst.getOption()
    return { g0h: opt.grid[0].height, g1top: opt.grid[1].top }
  })
  console.log(`>>> 5日分时 grid 前=${JSON.stringify(gridBefore)} 后=${JSON.stringify(gridAfter)}`)
  expect(gridAfter).not.toBeNull()
  expect(gridAfter.g0h).not.toBe(gridBefore.g0h) // 拖拽改变了价格区高度
  await win.screenshot({ path: path.resolve(__dirname, '../test-results/14-5day-minute.png') })
  await app.close()
})
