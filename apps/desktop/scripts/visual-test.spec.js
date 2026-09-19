// 视觉测试：LocalStock 桌面版（Playwright + Electron）
// 启动应用 → 截图 → 模拟点击/导航 → 断言界面渲染
// 运行: cd desktop && npx playwright test scripts/visual-test.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

// 启动方式：用 electron 加载构建产物 out/main/index.js（dev 构建模式，数据走 userData）
// 若需测打包版：改用 executablePath: APP_EXE（win-unpacked 的 exe 本身即 electron 运行时）
const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const MAIN_ENTRY = 'out/main/index.js'
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

/** JS 点击：行情 1s 刷新会让表格行/tab 内容持续变化，Playwright 稳定性检测易超时，用 JS 事件绕过 */
async function jsClick(win, locator) {
  await locator.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

test('主界面渲染 + 详情页 + K线周期 + 搜索', async () => {
  test.setTimeout(150_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await win.waitForTimeout(6000) // 等行情推送

  // 1. 主界面：自选股表格
  await win.screenshot({ path: path.join(SHOTS_DIR, '01-watchlist.png') })
  await expect(win.locator('.stock-table tbody tr').first()).toBeVisible()

  // 2. 进入第一只股票详情：报价头非空
  await jsClick(win, win.locator('.stock-table tbody tr').first())
  await win.waitForTimeout(5000)
  await win.screenshot({ path: path.join(SHOTS_DIR, '02-detail.png') })
  await expect(win.locator('.detail-price')).toHaveText(/\d+\.\d+/)

  // 3. 分时 tab：canvas 渲染（新浪分时）
  await expect(
    win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas')
  ).toHaveCount(1)
  await win.screenshot({ path: path.join(SHOTS_DIR, '03-minute.png') })

  // 4. 日K：canvas 渲染 + 截图
  await jsClick(win, win.locator('.tab', { hasText: '日K' }))
  await win.waitForTimeout(4000)
  await expect(
    win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas')
  ).toHaveCount(1)
  await win.screenshot({ path: path.join(SHOTS_DIR, '04-dayk.png') })

  // 5. 周K / 月K
  await jsClick(win, win.locator('.tab', { hasText: '周K' }))
  await win.waitForTimeout(3000)
  await win.screenshot({ path: path.join(SHOTS_DIR, '05-weekk.png') })
  await jsClick(win, win.locator('.tab', { hasText: '月K' }))
  await win.waitForTimeout(3000)
  await win.screenshot({ path: path.join(SHOTS_DIR, '06-monthk.png') })

  // 6. 返回自选 + 搜索"茅台"（东财 searchapi 限流会失败，此时跳过搜索断言而非判失败）
  await jsClick(win, win.locator('.sidebar-item', { hasText: '自选股' }))
  await win.waitForTimeout(2000)
  await win.locator('.search-input').fill('茅台')
  await win.waitForTimeout(2500)
  await win.screenshot({ path: path.join(SHOTS_DIR, '07-search.png') })
  const searchItemCount = await win.locator('.search-item').count()
  if (searchItemCount > 0) {
    await expect(win.locator('.search-item').first()).toBeVisible()
  } else {
    console.log('>>> 搜索无结果（东财 searchapi 限流，跳过断言，非 UI 回归）')
  }

  await app.close()
})

test('沪深A股列表 + 回测页', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await win.waitForTimeout(6000)

  // 沪深A股列表（本地数据，全库 GROUP BY 生成较慢，等待更久）
  await jsClick(win, win.locator('.sidebar-item', { hasText: '沪深A股' }))
  await expect(win.locator('.stock-table tbody tr').first()).toBeVisible({
    timeout: 20_000
  })
  await win.waitForTimeout(2000)
  await win.screenshot({ path: path.join(SHOTS_DIR, '08-market.png') })

  // 回测页（模板加载 + 编辑器）
  await jsClick(win, win.locator('.sidebar-item', { hasText: '回测' }))
  await expect(win.locator('.code-editor')).toBeVisible({ timeout: 15_000 })
  await expect(win.locator('.template-item').first()).toBeVisible({ timeout: 15_000 })
  await win.screenshot({ path: path.join(SHOTS_DIR, '09-backtest.png') })

  await app.close()
})

test('K线画线交互：选工具拖拽画线并保存', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  // 捕获渲染进程画线日志，便于定位
  app.process().stdout.on('data', (d) => {
    const s = d.toString()
    if (s.includes('DRAW-RENDER')) console.log('>>> ' + s.trim())
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await win.waitForTimeout(6000)

  // 进详情，清空该股票测试画线（保证画线数确定性），回自选后再进
  await jsClick(win, win.locator('.stock-table tbody tr').first())
  await win.waitForTimeout(4000)
  const code0 = (await win.locator('.detail-name-box .stock-code').textContent()).trim()
  const secid = (code0.startsWith('6') ? '1.' : '0.') + code0
  await win.evaluate(async (sid) => window.api.drawings.clear(sid), secid)
  await jsClick(win, win.locator('.sidebar-item', { hasText: '自选股' }))
  await win.waitForTimeout(1200)
  await jsClick(win, win.locator('.stock-table tbody tr').first())
  await win.waitForTimeout(4000)
  await jsClick(win, win.locator('.tab', { hasText: '日K' }))
  await win.waitForTimeout(4000)

  // 1. 画线工具条可见（仅日K）
  await expect(win.locator('.drawing-tools')).toBeVisible()

  // 记录画线前的数量（清空后应为 0）
  const before = await win.evaluate(
    async (sid) => (await window.api.drawings.get(sid)).current.length,
    secid
  )
  console.log(`>>> 画线前数量: ${before}`)

  // 2. 选白色画线颜色（K线/MA 无纯白，便于像素级验证画线渲染）
  await jsClick(win, win.locator('.drawing-colors .drawing-color').nth(5))
  // 3. 选择"趋势线"工具（按钮高亮）
  await jsClick(win, win.locator('.drawing-tools .btn', { hasText: '趋势线' }))
  await expect(
    win.locator('.drawing-tools .btn.active', { hasText: '趋势线' })
  ).toBeVisible()
  // 等 KLineChart 的 zr 事件绑定完成：轮询 chart-box 出现 drawing-active 且
  // zr 上有 mousedown handler（通过派发合成事件验证），行情刷新重渲染会让绑定晚于 400ms
  await win.waitForFunction(() => {
    const dom = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box')
    const inst = window.echarts?.getInstanceByDom?.(dom)
    if (!inst) return false
    const c = dom.getBoundingClientRect()
    const ev = new MouseEvent('mousedown', { clientX: c.x + 10, clientY: c.y + 10, bubbles: true })
    dom.querySelector('canvas')?.dispatchEvent(ev)
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: c.x + 10, clientY: c.y + 10, bubbles: true }))
    // pending 画线被合成事件创建即说明 zr 已绑定（hline 工具才单击成线；趋势线 mousedown 只 setPending）
    // 间接判定：drawing-active 类在（effect 已跑过一轮）+ 再等一帧
    return dom.classList.contains('drawing-active')
  }, { timeout: 10_000 })
  await win.waitForTimeout(800)

  // 4. 在 K线 canvas 上拖拽画一条趋势线（mousedown → 移动 → mouseup）
  const canvas = win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas')
  const box = await canvas.boundingBox()
  const x1 = box.x + box.width * 0.25
  const y1 = box.y + box.height * 0.45
  const x2 = box.x + box.width * 0.55
  const y2 = box.y + box.height * 0.25
  await win.mouse.move(x1, y1)
  await win.mouse.down()
  await win.mouse.move(x2, y2, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(1500)

  // 5. 验证画线已保存（current 数量 +1）
  const after = await win.evaluate(
    async (sid) => (await window.api.drawings.get(sid)).current.length,
    secid
  )
  expect(after).toBeGreaterThan(before)

  // 5.5 读取画线坐标，确认在 K 线索引范围内（坐标有效则画线能渲染）
  const drawInfo = await win.evaluate(async (sid) => {
    const r = await window.api.drawings.get(sid)
    const last = r.current[r.current.length - 1]
    const k = await window.api.market.getKline(sid, 101, 1)
    return last && k ? { points: last.points, n: k.points.length } : null
  }, secid)
  console.log('>>> 画线坐标:', JSON.stringify(drawInfo))
  expect(drawInfo).not.toBeNull()
  for (const p of drawInfo.points) {
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x).toBeLessThan(drawInfo.n)
  }

  // 6. 验证画线实际渲染到 canvas（纯白像素 > 0）
  const whitePx = await win.evaluate(() => {
    const c = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
    if (!c) return 0
    try {
      const ctx = c.getContext('2d')
      const img = ctx.getImageData(0, 0, c.width, c.height).data
      let count = 0
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] > 235 && img[i + 1] > 235 && img[i + 2] > 235) count++
      }
      return count
    } catch {
      return -1
    }
  })
  expect(whitePx).toBeGreaterThan(0)

  // 7. 画完一条线自动退出画线模式（恢复图表缩放/拖拽）
  await expect(win.locator('.drawing-tools .btn.active')).toHaveCount(0)
  await win.screenshot({ path: path.join(SHOTS_DIR, '10-drawing.png') })

  await app.close()
})
