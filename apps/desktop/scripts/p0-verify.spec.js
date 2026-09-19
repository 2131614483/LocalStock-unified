// 临时探针：验证 1) 表头吸顶（滚动表体后表头仍在顶部）2) 图表随容器 resize（拖侧栏后 canvas 尺寸变化）
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

test('P0 验证：表头吸顶 + 图表随容器缩放', async () => {
  test.setTimeout(150_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // ---- 1. 自选列表：压缩滚动区高度强制滚动，表头应吸顶 ----
  await expect(win.locator('.stock-table tbody tr').first()).toBeVisible({ timeout: 30_000 })
  const scrollBox = win.locator('.table-card .table-scroll')
  await expect(scrollBox).toHaveCount(1)
  // 压缩卡片高度（scrollBox 是 flex:1，直接设 height 无效）→ 行数多于可视区 → 可滚动
  const rowCount = await win.locator('.stock-table tbody tr').count()
  console.log(`>>> 自选行数=${rowCount}`)
  await win.locator('.table-card').first().evaluate((el) => { el.style.height = '180px' })
  await win.waitForTimeout(300)
  const thBefore = await win.locator('.stock-table thead th').first().boundingBox()
  await scrollBox.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await win.waitForTimeout(400)
  const thAfter = await win.locator('.stock-table thead th').first().boundingBox()
  const scrollY = await scrollBox.evaluate((el) => el.scrollTop)
  console.log(`>>> scrollTop=${scrollY}, 表头y 前=${thBefore?.y} 后=${thAfter?.y}`)
  expect(scrollY).toBeGreaterThan(10)
  expect(thAfter?.y).toBeGreaterThan(0)
  // 吸顶：滚动前后表头 y 基本不变（±3px）
  expect(Math.abs((thAfter?.y ?? 0) - (thBefore?.y ?? 0))).toBeLessThan(3)
  await win.screenshot({ path: path.resolve(__dirname, '../test-results/11-sticky-header.png') })

  // ---- 2. 详情页：拖侧栏分隔条，K线 canvas 宽度应实时跟随（ResizeObserver） ----
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await win.locator('.tab', { hasText: '日K' }).click()
  await win.waitForTimeout(4000)
  // 拖侧栏分隔条：先清持久化值（可能已在上限 380，+80 会被 max 钳住），reload 后重新进详情
  await win.evaluate(() => localStorage.removeItem('split.sidebar'))
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(4000)
  await win.evaluate(() =>
    document.querySelector('.stock-table tbody tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  )
  await win.waitForTimeout(4000)
  await win.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent?.trim() === '日K')
    t?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(4000)
  const canvasBefore = await win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas').boundingBox()
  console.log(`>>> 拖拽前 canvas 宽=${canvasBefore?.width}`)

  // 拖侧栏分隔条（SplitPane splitter）向右 +80px
  const splitter = win.locator('.main .splitter').first()
  const sb = await splitter.boundingBox()
  if (sb) {
    await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await win.mouse.down()
    await win.mouse.move(sb.x + sb.width / 2 + 80, sb.y + sb.height / 2, { steps: 5 })
    await win.mouse.up()
  }
  await win.waitForTimeout(800) // 等 rAF resize
  const canvasAfter = await win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas').boundingBox()
  console.log(`>>> 拖拽后 canvas 宽=${canvasAfter?.width}`)
  expect(Math.abs((canvasAfter?.width ?? 0) - (canvasBefore?.width ?? 0))).toBeGreaterThan(50)
  // canvas 属性尺寸/CSS 尺寸比应接近 DPR 整数（未拉伸模糊）
  const ratio = await win.evaluate(() => {
    const c = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
    return c ? c.width / c.getBoundingClientRect().width : 0
  })
  console.log(`>>> canvas 属性/CSS 尺寸比=${ratio.toFixed(3)}（≈DPR 即未拉伸）`)
  expect(ratio).toBeGreaterThan(0.9)

  await app.close()
})
