// 视觉测试：视图浮窗（独立系统窗口自由排布）
// 验证：窗口菜单、拆出自选浮窗并渲染、显隐切换复用（窗口数不变）、详情浮窗
// 运行: cd desktop && npx playwright test scripts/visual-test-float.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

test('视图浮窗：窗口菜单拆出独立系统窗口，显隐切换复用', async () => {
  test.setTimeout(300_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)
  console.log('>>> 主窗就绪')

  // 1. 窗口菜单
  await expect(win.locator('.win-wrap .ai-toggle')).toBeVisible()
  await win.locator('.win-wrap .ai-toggle').click()
  await expect(win.locator('.win-menu')).toBeVisible()
  await expect(win.locator('.win-menu-item').first()).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '29-win-menu.png') })

  // 2. 打开自选股浮窗 → 新独立系统窗口渲染自选列表
  const beforeCount = app.windows().filter((w) => !w.isClosed()).length
  console.log('>>> 打开浮窗前窗口数:', beforeCount)
  await win.locator('.win-menu-item', { hasText: '自选股' }).click()
  const floatWin = await app.waitForEvent('window', { timeout: 20_000 })
  await floatWin.waitForLoadState('domcontentloaded')
  await expect(floatWin.locator('.float-app .stock-table tbody tr').first()).toBeVisible({
    timeout: 30_000
  })
  await floatWin.screenshot({ path: path.join(SHOTS_DIR, '30-float-watchlist.png') })
  const afterOpen = app.windows().filter((w) => !w.isClosed()).length
  console.log('>>> 打开浮窗后窗口数:', afterOpen)
  expect(afterOpen).toBeGreaterThanOrEqual(beforeCount + 1)
  console.log('>>> 自选浮窗渲染完成')

  // 3. 显隐切换（隐藏→再显示）复用同一窗口，数量不变
  await win.locator('.win-menu-item', { hasText: '自选股' }).click() // 隐藏
  await win.waitForTimeout(500)
  await win.locator('.win-menu-item', { hasText: '自选股' }).click() // 再显示
  await win.waitForTimeout(500)
  const afterToggle = app.windows().filter((w) => !w.isClosed()).length
  console.log('>>> 显隐切换后窗口数:', afterToggle)
  expect(afterToggle).toBe(afterOpen)

  // 4. 详情浮窗：主窗进个股详情后，菜单出现「个股详情」
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await expect(win.locator('.detail-price')).toBeVisible({ timeout: 20_000 })
  // 浮窗切换不关闭菜单；若关了则重开
  if (!(await win.locator('.win-menu').isVisible().catch(() => false))) {
    await win.locator('.win-wrap .ai-toggle').click()
  }
  const detailItem = win.locator('.win-menu-item', { hasText: '个股详情' })
  await expect(detailItem).toBeVisible()
  await detailItem.click()
  const detailFloat = await app.waitForEvent('window', { timeout: 20_000 })
  await detailFloat.waitForLoadState('domcontentloaded')
  await expect(detailFloat.locator('.detail-price')).toBeVisible({ timeout: 30_000 })
  await detailFloat.screenshot({ path: path.join(SHOTS_DIR, '31-float-detail.png') })
  console.log('>>> 详情浮窗渲染完成')

  await app.close()
})
