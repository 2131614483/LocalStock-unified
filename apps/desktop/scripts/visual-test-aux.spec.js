// 视觉测试（补盲）：指数栏 / 盘口五档 / 回测结果曲线 / 预警页 / 设置页
// 覆盖 docs/视觉识别测试清单.md 中现有 spec 未断言的界面（#9 #11 #13 #18 #19）
// 运行: cd desktop && npx playwright test scripts/visual-test-aux.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

// 辅助：启动打包版并等行情推送
async function launchApp() {
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)
  return { app, win }
}

test('指数栏 + 盘口五档', async () => {
  test.setTimeout(120_000)
  const { app, win } = await launchApp()

  // 1. 指数栏：5 大指数渲染（名称/价格/涨跌幅）
  await expect(win.locator('.index-bar .index-item').first()).toBeVisible()
  const idxCount = await win.locator('.index-bar .index-item').count()
  expect(idxCount).toBeGreaterThanOrEqual(3)
  await win.screenshot({ path: path.join(SHOTS_DIR, '25-indexbar.png') })

  // 2. 进详情，等盘口数据（3s 轮询，最多约 12s）
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(5000)
  await expect(win.locator('.orderbook .ob-row').first()).toBeVisible({
    timeout: 15_000
  })
  await expect(win.locator('.ob-sell .ob-row')).toHaveCount(5)
  await expect(win.locator('.ob-buy .ob-row')).toHaveCount(5)
  await expect(win.locator('.ob-info .kv')).toHaveCount(8)
  await win.screenshot({ path: path.join(SHOTS_DIR, '26-orderbook.png') })

  await app.close()
})

test('回测结果曲线', async () => {
  test.setTimeout(180_000)
  const { app, win } = await launchApp()

  // 回测页：等编辑器与模板
  await win.locator('.sidebar-item', { hasText: '回测' }).click()
  await expect(win.locator('.code-editor')).toBeVisible({ timeout: 15_000 })

  // 用双均线模板（干净的默认代码），并把回测区间缩到近 1 年，加快出结果
  await win.locator('.template-item', { hasText: '双均线' }).click()
  const startInput = win.locator('.param-label', { hasText: '开始日期' }).locator('input[type=date]')
  await startInput.fill('2025-08-13')

  // 运行回测
  await win.locator('.run-btn').click()

  // 等结果或报错出现
  await expect(win.locator('.backtest-result, .backtest-error').first()).toBeVisible({
    timeout: 120_000
  })
  const isErr = await win.locator('.backtest-error').isVisible()
  if (isErr) {
    const msg = await win.locator('.backtest-error').textContent()
    throw new Error('回测失败: ' + msg)
  }

  // 指标卡 + 收益/回撤两条 canvas 曲线（容器类是 chart-box-sm，见 ResizableChartShell）
  await expect(win.locator('.metric-grid .metric-card').first()).toBeVisible()
  const metricCount = await win.locator('.metric-grid .metric-card').count()
  expect(metricCount).toBeGreaterThanOrEqual(8)
  await expect(win.locator('.backtest-result .chart-box-sm canvas').first()).toBeVisible()
  const canvasCount = await win.locator('.backtest-result .chart-box-sm canvas').count()
  expect(canvasCount).toBeGreaterThanOrEqual(2)
  await win.screenshot({ path: path.join(SHOTS_DIR, '27-backtest-result.png') })

  await app.close()
})

test('预警页', async () => {
  test.setTimeout(90_000)
  const { app, win } = await launchApp()

  await win.locator('.sidebar-item', { hasText: '预警' }).click()
  await win.waitForTimeout(2000)
  // 规则表单（股票/规则类型选择 + 添加/扫描按钮）渲染
  await expect(win.locator('.btn', { hasText: '添加规则' })).toBeVisible()
  await expect(win.locator('.btn', { hasText: '立即扫描' })).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '28-alerts.png') })

  await app.close()
})

test('设置页', async () => {
  test.setTimeout(90_000)
  const { app, win } = await launchApp()

  await win.locator('.sidebar-item', { hasText: '设置' }).click()
  await win.waitForTimeout(2000)
  // 分区卡片（行情/AI 后端/实时监盘/回测/行情数据）
  await expect(win.locator('.settings-card').first()).toBeVisible()
  const cardCount = await win.locator('.settings-card').count()
  expect(cardCount).toBeGreaterThanOrEqual(4)
  await win.screenshot({ path: path.join(SHOTS_DIR, '29-settings.png') })

  await app.close()
})
