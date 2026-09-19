// 视觉测试：价格行为 AI 页（pa-agent 由桌面端托管启动，无需手动跑脚本）
//
// 运行: cd desktop && npm run build && npx playwright test scripts/visual-test-pa.spec.js --reporter=list
//
// 两个场景：
//   1. 正常路径  —— 复用工作区已自举的 venv，服务应自动就绪
//   2. 缺依赖    —— 指向一个干净的 userData，应出现「安装运行环境」提示而非静默失败
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const MAIN_ENTRY = path.resolve(__dirname, '../out/main/index.js')
// 设 LOCALSTOCK_TEST_EXE=1 可改为测打包产物（dist/win-unpacked），验证 resources 里的服务能否自启
const PACKAGED_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const USE_PACKAGED = process.env.LOCALSTOCK_TEST_EXE === '1'
const WORKSPACE = path.resolve(__dirname, '../../..')
const SHOTS_DIR = path.resolve(__dirname, '../test-results/pa')

/** 启动被测应用：默认用 out/ 产物（迭代快），设 LOCALSTOCK_TEST_EXE=1 用打包产物 */
function launch(env) {
  const base = { ...process.env, ...env }
  return USE_PACKAGED
    ? _electron.launch({ executablePath: PACKAGED_EXE, env: base })
    : _electron.launch({ args: [MAIN_ENTRY], env: base })
}

// 与 start-desktop.ps1 / workspace-env.ps1 一致的运行环境
const WORKSPACE_ENV = {
  LOCALSTOCK_DESKTOP_USER_DATA: path.join(WORKSPACE, 'data', 'runtime', 'desktop'),
  LOCALSTOCK_MARKET_DB: path.join(WORKSPACE, 'data', 'market', 'stock_data.db'),
  LOCALSTOCK_PA_RUNTIME_DIR: path.join(WORKSPACE, 'data', 'runtime', 'pa-agent')
}

/** 临时 profile 目录统一放在这里，跑完清掉，避免在工作区留垃圾 */
const TEST_PROFILES = path.join(WORKSPACE, 'data', 'runtime', '_pa-test-profiles', 'pa')

test.beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  fs.mkdirSync(TEST_PROFILES, { recursive: true })
})

test.afterAll(() => {
  // 刚被杀掉的 pa-agent 子进程会短暂持有 venv 里的 python.exe（Windows 上删不掉）。
  // 清理失败不应判定测试失败 —— 换个时间点重跑一次，仍失败就留下目录并提示。
  try {
    fs.rmSync(TEST_PROFILES, { recursive: true, force: true, maxRetries: 10, retryDelay: 600 })
  } catch (error) {
    console.warn('>>> 临时 profile 暂未清理（文件被占用），可稍后手工删除:', TEST_PROFILES)
  }
})

/** 取一个干净的 profile 目录 */
function freshProfile(name) {
  const dir = path.join(TEST_PROFILES, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function jsClick(win, locator) {
  await locator.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

async function openPaPage(win) {
  await jsClick(win, win.locator('.sidebar-item', { hasText: '价格行为 AI' }))
  await win.waitForTimeout(2000)
}

test('托管服务自动就绪 + 图表 + 提交流程', async () => {
  test.setTimeout(240_000)
  const app = await launch({ ...WORKSPACE_ENV, LOCALSTOCK_NO_SINGLETON: '1' })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
  })
  await win.waitForTimeout(4000)

  await openPaPage(win)
  await win.screenshot({ path: path.join(SHOTS_DIR, '01-enter.png') })

  // 关键断言：无需任何手工启动，服务应自动变为已连接
  await expect(win.locator('.pa-conn')).toContainText('服务已连接', { timeout: 60_000 })
  console.log('>>> 托管服务已自动就绪')
  await expect(win.locator('.pa-banner')).toHaveCount(0)

  // K 线图渲染
  await expect(win.locator('.pa-chart-canvas canvas')).toHaveCount(1, { timeout: 20_000 })
  await win.waitForTimeout(1200)
  await win.screenshot({ path: path.join(SHOTS_DIR, '02-kline.png') })

  // K线数改小（本地模型上下文有限）
  await win.locator('.pa-field input[type=number]').fill('60')
  await win.waitForTimeout(1000)

  // 提交分析：按钮切到「取消分析」证明 running 置位
  await jsClick(win, win.locator('.pa-btn-primary'))
  await expect(win.locator('.pa-btn-danger')).toBeVisible({ timeout: 20_000 })
  console.log('>>> 已提交分析')

  // 阶段徽章推进到阶段一（frame_ready 已回到渲染层）
  await expect(win.locator('.pa-phase')).toContainText('阶段一', { timeout: 90_000 })
  console.log('>>> 收到 frame_ready，阶段一已开始')
  await win.screenshot({ path: path.join(SHOTS_DIR, '03-stage1.png') })

  // 取消，避免本地模型长时间占用
  await jsClick(win, win.locator('.pa-btn-danger'))
  await expect(win.locator('.pa-btn-primary')).toBeVisible({ timeout: 20_000 })
  console.log('>>> 已取消，回到空闲态')

  await app.close()
})

// 运行环境损坏（venv 里的 python.exe 是个假文件）时应当**自愈**：
// 探测到不可用 → 忽略它 → 用本机 Python 重建 → 服务恢复。
// 这条覆盖"用户机器上留了半截环境"的情形，避免要求用户手工删目录。
test('运行环境损坏时自动重建并恢复', async () => {
  test.skip(process.env.LOCALSTOCK_TEST_INSTALL !== '1', '需联网重建环境，默认跳过')
  test.setTimeout(600_000)
  const profile = freshProfile('broken-env')
  fs.mkdirSync(path.join(profile, 'pa-agent-venv', 'Scripts'), { recursive: true })
  fs.writeFileSync(path.join(profile, 'pa-agent-venv', 'Scripts', 'python.exe'), 'not a real python')

  const app = await launch({
    LOCALSTOCK_DESKTOP_USER_DATA: profile,
    LOCALSTOCK_MARKET_DB: WORKSPACE_ENV.LOCALSTOCK_MARKET_DB,
    LOCALSTOCK_NO_SINGLETON: '1'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
  })
  await win.waitForTimeout(4000)

  await openPaPage(win)
  console.log('>>> 环境已损坏，等待自动重建…')
  await expect(win.locator('.pa-conn')).toContainText('服务已连接', { timeout: 540_000 })
  console.log('>>> 已自动重建并恢复')
  // 假 python.exe 应已被真实解释器替换
  const size = fs.statSync(path.join(profile, 'pa-agent-venv', 'Scripts', 'python.exe')).size
  expect(size).toBeGreaterThan(10_000)
  await win.screenshot({ path: path.join(SHOTS_DIR, '05-healed.png') })

  await app.close()
})

// 全新环境会**自动**装好运行环境，不需要点任何按钮（需联网，默认跳过）
test('全新环境自动准备运行环境（无需点击）', async () => {
  test.skip(process.env.LOCALSTOCK_TEST_INSTALL !== '1', '需联网安装，默认跳过')
  test.setTimeout(600_000)
  const profile = freshProfile('fresh-env')

  const app = await launch({
    LOCALSTOCK_DESKTOP_USER_DATA: profile,
    LOCALSTOCK_MARKET_DB: WORKSPACE_ENV.LOCALSTOCK_MARKET_DB,
    LOCALSTOCK_NO_SINGLETON: '1'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
  })
  await win.waitForTimeout(4000)

  await openPaPage(win)
  console.log('>>> 全新环境，未做任何点击，等待自动准备运行环境…')
  await expect(win.locator('.pa-conn')).toContainText('服务已连接', { timeout: 540_000 })
  await expect(win.locator('.pa-banner')).toHaveCount(0)
  console.log('>>> 已自动就绪，无需手动点击')
  expect(fs.existsSync(path.join(profile, 'pa-agent-venv', 'Scripts', 'python.exe'))).toBe(true)
  await win.screenshot({ path: path.join(SHOTS_DIR, '06-auto-installed.png') })

  await app.close()
})
