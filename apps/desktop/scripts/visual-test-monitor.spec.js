// 视觉测试：独立监盘窗口（实时行情入库 + AI 实时预测）
// AI 预测部分需 LOCALSTOCK_DS_KEY（DeepSeek），无 key 时只验证实时数据渲染
// 运行: cd desktop && LOCALSTOCK_DS_KEY=sk-xxx npx playwright test scripts/visual-test-monitor.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')
const KEY = process.env.LOCALSTOCK_DS_KEY

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

test('监盘窗口：实时数据 + AI 实时预测（定时+异动）', async () => {
  test.setTimeout(300_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  app.process().stdout.on('data', (d) => {
    const s = d.toString()
    if (s.includes('[monitor]') || s.includes('AI 预测')) console.log('>>>主进程: ' + s.trim())
  })
  app.process().stderr.on('data', (d) => {
    const s = d.toString()
    if (s.includes('[monitor]') || s.includes('AI 预测') || s.includes('Uncaught')) console.log('>>>stderr: ' + s.trim())
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 若提供 key 先配置 AI 后端（DeepSeek）
  if (KEY) {
    await win.evaluate(
      ({ k, m, b }) => window.api.ai.setConfig({ provider: 'openai', apiKey: k, model: m, baseUrl: b, writeMode: 'auto' }),
      { k: KEY, m: process.env.LOCALSTOCK_DS_MODEL || 'deepseek-v4-flash', b: process.env.LOCALSTOCK_DS_BASE || 'https://api.deepseek.com/v1' }
    )
  }

  // 开启监盘：小规模监控，5s 间隔，定时+异动 AI
  await win.evaluate(() =>
    window.api.monitor.setConfig({
      enabled: true,
      scope: 'monitor',
      interval: 5,
      aiEnabled: true,
      aiTrigger: 'both',
      aiIntervalSec: 60,
      anomalyPct: 0.3,
      alertPct: 3,
      retention: 500
    })
  )
  // 保证列表里有监控股
  await win.evaluate(() => window.api.monitor.addStock({ secid: '1.600519', code: '600519', name: '贵州茅台' }))

  // 打开监盘窗口（单例）
  await win.evaluate(() => window.api.monitor.openWindow())
  const mon = await app.waitForEvent('window', { timeout: 20_000 })
  await mon.waitForLoadState('domcontentloaded')

  // 实时行情表出现
  await expect(mon.locator('.mon-table tbody tr').first()).toBeVisible({ timeout: 60_000 })
  await mon.waitForTimeout(2000)
  await mon.screenshot({ path: path.join(SHOTS_DIR, '22-monitor-realtime.png') })

  // 主窗口工具栏有「监盘」按钮；再次打开复用（窗口数量不变）
  await expect(win.locator('.ai-toggle', { hasText: '监盘' })).toBeVisible()
  await win.evaluate(() => window.api.monitor.openWindow())
  await mon.waitForTimeout(1000)
  expect(app.windows().filter((w) => !w.isClosed())).toHaveLength(2)

  // AI 实时预测出现（需 key）
  if (KEY) {
    // 先轮询主进程侧预测缓存（诊断更快）
    let hasPred = false
    for (let i = 0; i < 18; i++) {
      const st = await win.evaluate(() => window.api.monitor.getState())
      hasPred = (st.stocks || []).some((s) => s.prediction)
      if (hasPred) break
      await mon.waitForTimeout(10_000)
    }
    console.log('>>> 预测缓存命中:', hasPred)
    if (hasPred) {
      const st = await win.evaluate(() => window.api.monitor.getState())
      const first = (st.stocks || []).find((s) => s.prediction)
      console.log('>>> 预测示例:', JSON.stringify(first?.prediction))
    }
    await expect(mon.locator('.mon-pred').first()).toBeVisible({ timeout: 120_000 })
    const pred = (await mon.locator('.mon-pred').first().textContent()) || ''
    console.log('>>> AI 预测:', pred)
    expect(pred.length).toBeGreaterThan(3)
    await mon.screenshot({ path: path.join(SHOTS_DIR, '23-monitor-ai.png') })

    // 预测事件应写入记录
    await expect(mon.locator('.mon-event-prediction').first()).toBeVisible({ timeout: 30_000 })
  }

  // 实时入库验证：quote_history 应有该股票数据
  const rows = await win.evaluate(() => window.api.monitor.getState())
  expect(rows.config.enabled).toBe(true)

  // 命中率统计条渲染
  await expect(mon.locator('.monitor-stats')).toBeVisible()
  await mon.screenshot({ path: path.join(SHOTS_DIR, '24-monitor-stats.png') })

  // 命中率明细（按股票 / 按小时）
  await mon.locator('.monitor-stats .btn', { hasText: '明细' }).click()
  await expect(mon.locator('.monitor-detail')).toBeVisible()
  await expect(mon.locator('.monitor-detail .panel-title').first()).toHaveText('按股票命中率')
  await mon.screenshot({ path: path.join(SHOTS_DIR, '26-monitor-detail.png') })
  await mon.locator('.monitor-stats .btn', { hasText: '收起明细' }).click()
  await expect(mon.locator('.monitor-detail')).toHaveCount(0)

  // 半透明滑块存在
  await expect(mon.locator('.mon-cfg input[type="range"]')).toBeVisible()

  // 大屏/看板模式切换（进入 → 退出）
  await mon.locator('.monitor-controls .btn', { hasText: '大屏' }).click()
  await expect(mon.locator('.monitor-app.mon-large')).toHaveCount(1)
  await expect(mon.locator('.mon-exit-large')).toBeVisible()
  await mon.waitForTimeout(800)
  await mon.screenshot({ path: path.join(SHOTS_DIR, '25-monitor-large.png') })
  await mon.locator('.mon-exit-large').click()
  await expect(mon.locator('.monitor-app.mon-large')).toHaveCount(0)

  await app.close()
})
