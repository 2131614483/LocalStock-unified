// 行情库位置：设置页选定 / 校验 / 立即生效
//
// 原生文件选择框无法用 Playwright 直接操作，改为在主进程里替换
// dialog.showOpenDialog 返回固定路径（app.evaluate 跑在主进程）。
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const MAIN_ENTRY = path.resolve(__dirname, '../out/main/index.js')
const PACKAGED_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const USE_PACKAGED = process.env.LOCALSTOCK_TEST_EXE === '1'
const WORKSPACE = path.resolve(__dirname, '../../..')
const REAL_DB = path.join(WORKSPACE, 'data', 'market', 'stock_data.db')
const TEST_PROFILES = path.join(WORKSPACE, 'data', 'runtime', '_pa-test-profiles', 'db')
const SHOTS_DIR = path.resolve(__dirname, '../test-results/pa')

test.beforeAll(() => {
  fs.mkdirSync(TEST_PROFILES, { recursive: true })
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

test.afterAll(() => {
  try {
    fs.rmSync(TEST_PROFILES, { recursive: true, force: true, maxRetries: 10, retryDelay: 600 })
  } catch {
    console.warn('>>> 临时 profile 暂未清理（文件被占用）:', TEST_PROFILES)
  }
})

function launch(env) {
  const base = { ...process.env, ...env }
  return USE_PACKAGED
    ? _electron.launch({ executablePath: PACKAGED_EXE, env: base })
    : _electron.launch({ args: [MAIN_ENTRY], env: base })
}

async function openSettings(win) {
  await win
    .locator('.sidebar-item', { hasText: '设置' })
    .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await win.waitForTimeout(1200)
}

/** 让下一次「选择库文件…」返回指定路径 */
async function stubPicker(app, filePath) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, filePath)
}

test('默认指向用户数据目录时给出提示，选定真库后立即生效', async () => {
  test.setTimeout(180_000)
  const profile = path.join(TEST_PROFILES, 'db-location')
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })

  // 不设 LOCALSTOCK_MARKET_DB → 落到 userData/stock_data.db
  const app = await launch({
    LOCALSTOCK_DESKTOP_USER_DATA: profile,
    LOCALSTOCK_NO_SINGLETON: '1'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {}) // 等渲染层就绪
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
  })
  await win.waitForTimeout(4000)

  await openSettings(win)
  const card = win.locator('.market-db-card')
  await expect(card).toBeVisible()

  // 1. 默认落在用户数据目录 → 应提示"请指定你的行情库"
  await expect(card.locator('.market-db-meta')).toContainText('用户数据目录')
  await expect(card.locator('.market-db-warn')).toBeVisible()
  console.log('>>> 默认位置提示已显示')

  // 2. 选定真实行情库 → 显示股票数与交易日范围
  await stubPicker(app, REAL_DB)
  await card.getByRole('button', { name: '选择库文件…' }).click()
  await expect(card.locator('.market-db-meta')).toContainText('设置中指定', { timeout: 30_000 })
  await expect(card.locator('.market-db-meta')).toContainText(/股票 \d+ 只/)
  await expect(card.locator('.market-db-meta')).toContainText(/\d{4}-\d{2}-\d{2}/)
  await expect(card.locator('.market-db-error')).toHaveCount(0)
  const meta = await card.locator('.market-db-meta').textContent()
  console.log('>>> 已切换:', (meta || '').replace(/\s+/g, ' ').trim())
  await win.screenshot({ path: path.join(SHOTS_DIR, 'db-01-picked.png') })

  // 3. 主进程侧确认已真正保存并生效
  const info = await win.evaluate(() => window.api.marketDb.getInfo())
  expect(info.source).toBe('setting')
  expect(info.valid).toBe(true)
  expect(info.stocksCount).toBeGreaterThan(1000)

  // 4. 选一个"不是行情库"的文件 → 报错且不保存
  const bogus = path.join(profile, 'not-a-db.db')
  fs.writeFileSync(bogus, 'this is not a sqlite database')
  await stubPicker(app, bogus)
  await card.getByRole('button', { name: '选择库文件…' }).click()
  await expect(card.locator('.market-db-error')).toBeVisible({ timeout: 30_000 })
  console.log('>>> 非法文件已被拒绝')
  const after = await win.evaluate(() => window.api.marketDb.getInfo())
  expect(after.path).toBe(REAL_DB) // 仍是上一次选定的真库

  // 5. 恢复默认
  await card.getByRole('button', { name: '恢复默认' }).click()
  await expect(card.locator('.market-db-meta')).toContainText('用户数据目录', { timeout: 30_000 })
  console.log('>>> 已恢复默认')

  await app.close()
})

test('迁移环境变量指向缺失文件时不静默回退到空库', async () => {
  test.setTimeout(120_000)
  const profile = path.join(TEST_PROFILES, 'db-missing-env')
  const missingDb = path.join(profile, 'missing-stock_data.db')
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })

  const app = await launch({
    LOCALSTOCK_DESKTOP_USER_DATA: profile,
    LOCALSTOCK_MARKET_DB: missingDb,
    LOCALSTOCK_NO_SINGLETON: '1'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
  })
  await win.waitForTimeout(2500)

  await openSettings(win)
  const card = win.locator('.market-db-card')
  await expect(card.locator('.market-db-meta')).toContainText('环境变量 LOCALSTOCK_MARKET_DB')
  await expect(card.locator('.market-db-error')).toContainText('文件不存在')
  await expect(card.locator('.market-db-warn')).toContainText('工作区指定的行情库文件不可用')
  const info = await win.evaluate(() => window.api.marketDb.getInfo())
  expect(info.source).toBe('env')
  expect(info.path).toBe(missingDb)
  expect(info.exists).toBe(false)
  console.log('>>> 缺失环境变量路径已明确报错，未回退到用户数据目录')

  await app.close()
})

async function openPaPage(win) {
  await win
    .locator('.sidebar-item', { hasText: '价格行为 AI' })
    .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await win.waitForTimeout(2500)
}

// 用户的实际工作流：软件与数据库分开存放 → 在设置里指定库 →
// 本地 K 线、选股、回测、价格行为 AI 全部切到新库。
test('选定行情库后价格行为 AI 一并切换', async () => {
  test.setTimeout(300_000)
  const profile = path.join(TEST_PROFILES, 'db-pa-link')
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  // 复用已自举的 venv，避免本用例再联网装依赖（本用例只关心库路径联动）
  const srcVenv = path.join(WORKSPACE, 'data', 'runtime', 'desktop', 'pa-agent-venv')
  if (fs.existsSync(srcVenv)) {
    fs.cpSync(srcVenv, path.join(profile, 'pa-agent-venv'), { recursive: true })
  }

  const app = await launch({
    LOCALSTOCK_DESKTOP_USER_DATA: profile,
    LOCALSTOCK_NO_SINGLETON: '1'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
  })
  await win.waitForTimeout(4000)

  // 1. 初始：没设路径 → pa-agent 指向用户数据目录的空库 → 应明确报"缺表"
  await openPaPage(win)
  await expect(win.locator('.pa-banner-desc')).toBeVisible({ timeout: 60_000 })
  const before = (await win.locator('.pa-banner-desc').textContent()) || ''
  console.log('>>> 指定库之前:', before.slice(0, 70))
  expect(before).toMatch(/数据表|行情库/)
  await expect(win.locator('.pa-conn')).toContainText('服务异常')

  // 2. 在设置里选定真库
  await openSettings(win)
  const card = win.locator('.market-db-card')
  await expect(card).toBeVisible()
  await stubPicker(app, REAL_DB)
  await card.getByRole('button', { name: '选择库文件…' }).click()
  await expect(card.locator('.market-db-meta')).toContainText('设置中指定', { timeout: 30_000 })
  console.log('>>> 已在设置里选定真库')

  // 3. 回到价格行为页 → 服务应自动用新库重启并连上
  await openPaPage(win)
  await expect(win.locator('.pa-conn')).toContainText('服务已连接', { timeout: 90_000 })
  await expect(win.locator('.pa-banner')).toHaveCount(0)
  const ok = (await win.locator('.pa-conn').textContent()) || ''
  console.log('>>> 切换后:', ok.trim())
  expect(ok).toMatch(/\d+ 只/)
  await win.screenshot({ path: path.join(SHOTS_DIR, 'db-02-pa-linked.png') })

  await app.close()
})
