// 视觉测试：分时图右侧 AI 预测/画线面板
// 验证：两栏布局、市场状态徽标、快捷预测出标注（需 LOCALSTOCK_DS_KEY）
// 运行: cd desktop && LOCALSTOCK_DS_KEY=sk-xxx npx playwright test scripts/visual-test-minute.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')
const KEY = process.env.LOCALSTOCK_DS_KEY

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

test('分时图 AI 预测面板：两栏布局 + 快捷预测画标注', async () => {
  test.setTimeout(300_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.maximize()
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  if (KEY) {
    await win.evaluate(
      ({ k, m, b }) => window.api.ai.setConfig({ provider: 'openai', apiKey: k, model: m, baseUrl: b }),
      { k: KEY, m: process.env.LOCALSTOCK_DS_MODEL || 'deepseek-v4-flash', b: process.env.LOCALSTOCK_DS_BASE || 'https://api.deepseek.com/v1' }
    )
  }

  // 进第一只自选股详情（默认分时 tab）
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(5000)

  // 1. 两栏布局：分时图左 + 预测面板右（约半宽）
  await expect(win.locator('.minute-layout')).toBeVisible()
  await expect(win.locator('.minute-chart-col canvas').first()).toBeVisible()
  await expect(win.locator('.minute-predict')).toBeVisible()
  await expect(win.locator('.mp-market')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '27-minute-panel.png') })

  // 2. 快捷按钮 + 图例可见
  await expect(win.locator('.mp-quick .btn').first()).toBeVisible()
  await expect(win.locator('.mp-legend')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '27b-minute-legend.png') })

  // 3. 点「支撑压力」→ AI 生成标注（需 key）（面板可能在视口下方，先滚动定位）
  if (KEY) {
    const btn = win.locator('.mp-quick .btn', { hasText: '支撑压力' })
    await btn.scrollIntoViewIfNeeded()
    await win.waitForTimeout(300)
    await btn.click()
    await expect(win.locator('.mp-annot').first()).toBeVisible({ timeout: 120_000 })
    const opinion = (await win.locator('.mp-opinion').textContent()) || ''
    console.log('>>> AI 分时观点:', opinion)
    expect(opinion.length).toBeGreaterThan(2)
    await win.screenshot({ path: path.join(SHOTS_DIR, '28-minute-predicted.png') })

    // 标注数量 > 0
    const annCount = await win.locator('.mp-annot').count()
    expect(annCount).toBeGreaterThan(0)

    // 分时预测已接入监盘统计（预测历史有记录）
    const st = await win.evaluate(() => window.api.monitor.getPredictionStats())
    console.log('>>> 监盘预测统计 total:', st.total)
    expect(st.total).toBeGreaterThan(0)

    // 清空标注
    await win.locator('.mp-annotations-title .btn', { hasText: '清空' }).click()
    await expect(win.locator('.mp-annot')).toHaveCount(0)
  }

  await app.close()
})
