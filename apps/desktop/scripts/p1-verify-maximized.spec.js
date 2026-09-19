// P1 主窗最大化验证：最大化下 侧栏拖拽 / 表头吸顶 / 图表随容器缩放 仍正常
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

test('主窗最大化：侧栏拖拽 + 表头吸顶 + 图表缩放', async () => {
  test.setTimeout(150_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 最大化主窗
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].maximize()
  }, { BrowserWindow: (await import('electron')).BrowserWindow })
  await win.waitForTimeout(1500)

  // ---- 1. 侧栏拖拽（最大化宽屏下）----
  const sidebarBefore = await win.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0)
  const splitter = win.locator('.main .splitter').first()
  const sb = await splitter.boundingBox()
  await win.mouse.move(sb.x + sb.width / 2, sb.y + 300)
  await win.mouse.down()
  await win.mouse.move(sb.x + sb.width / 2 + 100, sb.y + 300, { steps: 5 })
  await win.mouse.up()
  await win.waitForTimeout(500)
  const sidebarAfter = await win.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0)
  console.log(`>>> [最大化] 侧栏宽 ${sidebarBefore.toFixed(0)} -> ${sidebarAfter.toFixed(0)}`)
  expect(sidebarAfter).toBeGreaterThan(sidebarBefore + 60)

  // ---- 2. 表格吸顶（最大化下压缩卡片滚动）----
  await win.evaluate(() => {
    const card = document.querySelector('.table-card')
    if (card) card.style.height = '300px'
  })
  await win.waitForTimeout(300)
  await win.evaluate(() => {
    const s = document.querySelector('.table-card .table-scroll')
    if (s) s.scrollTop = 999
  })
  await win.waitForTimeout(400)
  const sticky = await win.evaluate(() => {
    const s = document.querySelector('.table-card .table-scroll')
    const th = document.querySelector('.stock-table thead th')
    return {
      st: s?.scrollTop ?? 0,
      rel: th && s ? th.getBoundingClientRect().top - s.getBoundingClientRect().top : 99
    }
  })
  console.log(`>>> [最大化] 吸顶 scrollTop=${sticky.st.toFixed(0)} 表头相对=${sticky.rel.toFixed(1)}`)
  if (sticky.st > 10) expect(Math.abs(sticky.rel)).toBeLessThan(3)

  // ---- 3. 详情页图表随最大化容器缩放 ----
  await win.evaluate(() =>
    document.querySelector('.stock-table tbody tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  )
  await win.waitForTimeout(4000)
  await win.evaluate(() => {
    const tab = [...document.querySelectorAll('.tab')].find((t) => t.textContent?.trim() === '日K')
    tab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(4000)
  const canvasMax = await win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas').boundingBox()
  console.log(`>>> [最大化] canvas 宽=${canvasMax?.width.toFixed(0)}`)
  expect(canvasMax?.width).toBeGreaterThan(1200) // 最大化下图表应很宽

  // 恢复窗口尺寸：canvas 应跟随缩小（ResizeObserver）
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.unmaximize()
    w.setSize(1360, 860)
  }, { BrowserWindow: (await import('electron')).BrowserWindow })
  await win.waitForTimeout(1000)
  const canvasNorm = await win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas').boundingBox()
  console.log(`>>> [还原1366] canvas 宽=${canvasNorm?.width.toFixed(0)}`)
  expect(canvasNorm?.width).toBeLessThan((canvasMax?.width ?? 0) - 100)

  await win.screenshot({ path: path.resolve(__dirname, '../test-results/15-main-restore.png') })
  await app.close()
})
