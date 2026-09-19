// 视觉测试：自动选股页（Phase 3）
// 验证：选股页渲染、模式切换、规则编辑、全市场扫描出结果
// 运行: cd desktop && npx playwright test scripts/visual-test-selection.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

test('选股页：规则引擎全市场扫描出结果 + AI 模式切换', async () => {
  test.setTimeout(180_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 1. 进入选股页（精确匹配，避免「自选股」）
  await win.locator('.sidebar-item span:not(.icon)', { hasText: /^选股$/ }).click()
  await expect(win.locator('.sel-head')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '14-selection-page.png') })

  // 2. 模式切换：AI 模式 tab
  await win.locator('.sel-mode .btn', { hasText: 'AI 智能' }).click()
  await expect(win.locator('.code-editor').first()).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '15-selection-ai.png') })
  await win.locator('.sel-mode .btn', { hasText: '规则引擎' }).click()

  // 3. 规则表单：添加"突破新高"条件并设置回看 20 日，top=10
  await win.locator('.sel-filters-title .btn', { hasText: '添加条件' }).click()
  const row = win.locator('.sel-filter-row').first()
  await row.locator('select').selectOption('price_breakout')
  await row.locator('input').nth(0).fill('20') // 回看N日
  await win.locator('.param-label input[type="number"]').first().fill('10') // top=10

  // 4. 开始选股（全市场扫描，本地 worker）
  await win.locator('.sel-actions .btn.primary').click()
  await win.screenshot({ path: path.join(SHOTS_DIR, '16-selection-scanning.png') })
  await expect(win.locator('.sel-result-table tbody tr').first()).toBeVisible({
    timeout: 90_000
  })
  await win.waitForTimeout(1500)
  await win.screenshot({ path: path.join(SHOTS_DIR, '17-selection-result.png') })

  // 5. 结果行有理由且可点详情
  const hitCount = await win.locator('.sel-result-table tbody tr').count()
  expect(hitCount).toBeGreaterThan(0)
  await expect(win.locator('.sel-result-table tbody tr').first()).toContainText('突破')
  await win.locator('.sel-result-table tbody tr').first().getByRole('button', { name: '详情' }).click()
  await expect(win.locator('.detail-price')).toBeVisible({ timeout: 20_000 })

  await app.close()
})
