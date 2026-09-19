// 视觉测试：画线功能（手动拖拽画线 + Python 算法画线）—— 含像素级视觉分析
// 启动打包版应用 → 进详情 → 日K → 手动画线 → 历史版本 → 算法画线
// 视觉分析门禁：画水平线后，读取点击行（0.5H）像素 —— before 全黑，after 出现横贯的
// 亮线（1px + 85% 透明度 + DPR 抗锯齿，故用亮度>100 阈值而非纯白）→ 证明线渲染在点击位置。
// 截图存 test-results/draw-*.png 供人工目检。
// 运行: cd desktop && npx playwright test scripts/visual-test-drawing.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

// 当前可见 K 线 canvas 的任意比例坐标（CSS 像素，供 mouse 操作）
async function chartPoint(win, fx, fy) {
  const box = await win
    .locator('.chart-pane:not(.pane-hidden) .chart-box canvas')
    .boundingBox()
  if (!box) throw new Error('找不到可见的 K 线 canvas')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

// 区域内亮度 >= minLum 的像素计数（在浏览器内统计，返回小数值）。
// 画线为 1px + 0.85 透明度 + DPR(1.25x) 抗锯齿，强度分散在 ~150-220，用亮度阈值捕捉。
function countLum(win, minLum, region) {
  return win.evaluate(
    ({ minLum, x0, y0, x1, y1 }) => {
      const c = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
      if (!c) return -1
      const ctx = c.getContext('2d')
      const W = c.width
      const H = c.height
      const xa = Math.floor(W * x0)
      const ya = Math.floor(H * y0)
      const w = Math.max(1, Math.floor(W * (x1 - x0)))
      const h = Math.max(1, Math.floor(H * (y1 - y0)))
      const img = ctx.getImageData(xa, ya, w, h).data
      let n = 0
      for (let i = 0; i < img.length; i += 4) {
        if ((img[i] + img[i + 1] + img[i + 2]) / 3 >= minLum) n++
      }
      return n
    },
    { minLum, ...region }
  )
}

// 图表主区（避开图例/边缘/底部滑块条）
const CHART_REGION = { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 }

// 水平线点击位置的行带区域（避开边缘/图例）
const HLINE_REGION = { x0: 0.08, y0: 0.47, x1: 0.92, y1: 0.53 }

// —— 多重验证层 1：区域相似度（用户思路）——
// 画线前快照 canvas，画线后对比：若完全一致则线未渲染（无效）。
async function snapshotChart(win) {
  return win.evaluate(() => {
    const c = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
    if (!c) return { err: 'no canvas' }
    const ctx = c.getContext('2d')
    window.__snap = ctx.getImageData(0, 0, c.width, c.height)
    return { W: c.width, H: c.height }
  })
}
async function diffChart(win) {
  return win.evaluate(() => {
    const c = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
    if (!c) return { changed: -1 }
    const ctx = c.getContext('2d')
    const now = ctx.getImageData(0, 0, c.width, c.height)
    const before = window.__snap
    if (!before) return { changed: -1 }
    let changed = 0
    for (let i = 0; i < now.data.length; i += 4) {
      const d =
        Math.abs(now.data[i] - before.data[i]) +
        Math.abs(now.data[i + 1] - before.data[i + 1]) +
        Math.abs(now.data[i + 2] - before.data[i + 2])
      if (d > 90) changed++
    }
    return { changed, total: now.data.length / 4 }
  })
}

// 区域内"黄色系"像素计数（r>80 && g>60 && b<80；矩形 50% 填充后内部黄/黄绿均可捕获，
// 红绿蜡烛 r/g 有一项过低不被计入）
function countYellow(win, region) {
  return win.evaluate(
    ({ x0, y0, x1, y1 }) => {
      const c = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
      if (!c) return -1
      const ctx = c.getContext('2d')
      const W = c.width
      const H = c.height
      const xa = Math.floor(W * x0)
      const ya = Math.floor(H * y0)
      const w = Math.max(1, Math.floor(W * (x1 - x0)))
      const h = Math.max(1, Math.floor(H * (y1 - y0)))
      const img = ctx.getImageData(xa, ya, w, h).data
      let n = 0
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] > 80 && img[i + 1] > 60 && img[i + 2] < 80) n++
      }
      return n
    },
    region
  )
}

test('手动拖拽画线 + 算法画线（含像素级视觉分析）', async () => {
  test.setTimeout(180_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 1. 进详情，清空该股票测试画线（保证像素分析确定性），回自选后再进
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  const code0 = (await win.locator('.detail-name-box .stock-code').textContent()).trim()
  const secid = (code0.startsWith('6') ? '1.' : '0.') + code0
  await win.evaluate(async (sid) => window.api.drawings.clear(sid), secid)
  await win.locator('.sidebar-item', { hasText: '自选股' }).click()
  await win.waitForTimeout(1200)
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await win.locator('.tab', { hasText: '日K' }).click()
  await win.waitForTimeout(4000)
  await expect(win.locator('.drawing-tools')).toBeVisible()
  await expect(
    win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas')
  ).toHaveCount(1)
  console.log('✓ 日K 画线工具条与 canvas 就绪（已清空测试画线）')

  // 选白色（便于像素验证）
  await win.locator('.drawing-colors .drawing-color').nth(5).click()

  // 2. 水平线（单击即画）→ 多重验证：区域相似度 + 点击行亮度增量
  const lumBefore = await countLum(win, 100, HLINE_REGION)
  await snapshotChart(win)
  await win.locator('.drawing-tools .btn', { hasText: '水平线' }).click()
  await win.waitForTimeout(500)
  const p1 = await chartPoint(win, 0.5, 0.5)
  await win.mouse.click(p1.x, p1.y)
  await win.waitForTimeout(1200)
  await expect(win.locator('.drawing-tools .btn', { hasText: '删除' })).toBeVisible()
  const lumAfter = await countLum(win, 100, HLINE_REGION)
  const regionDiff = await diffChart(win)
  console.log(
    `>>> 水平线：点击行带亮度像素 ${lumBefore} → ${lumAfter}（增量 ${lumAfter - lumBefore}）`
  )
  console.log(`>>> 水平线：区域相似度对比 变化像素 ${regionDiff.changed}/${regionDiff.total}（完全一致则线未渲染）`)
  expect(regionDiff.changed).toBeGreaterThan(500)
  expect(lumAfter - lumBefore).toBeGreaterThanOrEqual(400)
  await win.screenshot({ path: path.join(SHOTS_DIR, 'draw-03-hline.png') })

  // 3. 趋势线（拖拽两点）→ 创建并保存、坐标有效
  // 注：拖拽会触发 inside dataZoom 平移（图表随拖而移，画线位置随视窗变化），
  // 故不做像素差值，改为验证数据已入库 + 坐标在 kline 索引范围内。
  const countBefore = await win.evaluate(
    async (sid) => (await window.api.drawings.get(sid)).current.length,
    secid
  )
  await win.locator('.drawing-tools .btn', { hasText: '趋势线' }).click()
  await win.waitForTimeout(500)
  const s = await chartPoint(win, 0.25, 0.45)
  const e = await chartPoint(win, 0.55, 0.25)
  await win.mouse.move(s.x, s.y)
  await win.mouse.down()
  await win.mouse.move(e.x, e.y, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(1200)
  const countAfter = await win.evaluate(
    async (sid) => (await window.api.drawings.get(sid)).current.length,
    secid
  )
  console.log(`>>> 趋势线：画线数 ${countBefore} → ${countAfter}`)
  expect(countAfter).toBeGreaterThan(countBefore)
  const klineInfo = await win.evaluate(
    async (sid) => {
      const r = await window.api.drawings.get(sid)
      const last = r.current[r.current.length - 1]
      const k = await window.api.market.getKline(sid, 101, 1)
      return { pts: last?.points, n: k.points.length }
    },
    secid
  )
  console.log(`>>> 趋势线坐标：${JSON.stringify(klineInfo.pts)}（kline n=${klineInfo.n}）`)
  for (const p of klineInfo.pts) {
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x).toBeLessThan(klineInfo.n)
  }
  await win.screenshot({ path: path.join(SHOTS_DIR, 'draw-04-trendline.png') })

  // 4. 历史版本：自动保存
  await win.locator('.drawing-tools .btn', { hasText: '历史' }).click()
  await expect(win.locator('.drawing-history .history-item').first()).toBeVisible()
  const verCount = await win.locator('.drawing-history .history-item').count()
  console.log(`✓ 画线历史已自动保存（${verCount} 个版本）`)
  await win.screenshot({ path: path.join(SHOTS_DIR, 'draw-05-history.png') })
  await win.locator('.drawing-panel .btn', { hasText: '关闭' }).click()

  // 5. 算法画线：默认算法 → 成功消息 + 压力/支撑/趋势 三条入库
  await win.locator('.drawing-tools .btn', { hasText: '算法画线' }).click()
  await expect(win.locator('.drawing-panel .code-editor')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, 'draw-06-algo-panel.png') })
  await win.locator('.drawing-panel .btn.primary', { hasText: '运行并画线' }).click()

  const resultLoc = win.locator('.drawing-panel .backtest-target-bar')
  const errLoc = win.locator('.drawing-panel .backtest-error')
  await resultLoc.or(errLoc).first().waitFor({ state: 'visible', timeout: 30_000 })
  if (await errLoc.isVisible().catch(() => false)) {
    throw new Error(`算法画线失败：${await errLoc.textContent()}`)
  }
  const resultText = await resultLoc.textContent()
  console.log(`✓ 算法画线结果：${resultText}`)

  const algo = await win.evaluate(
    async (sid) => {
      const r = await window.api.drawings.get(sid)
      return r.current
        .filter((d) => d.source === 'algo')
        .map((d) => ({ type: d.type, label: d.label, color: d.color, y: d.points?.[0]?.y }))
    },
    secid
  )
  console.log(`>>> 算法画线入库：${JSON.stringify(algo)}`)
  expect(algo.length).toBeGreaterThanOrEqual(3)
  const labels = algo.map((d) => d.label)
  expect(labels).toContain('压力')
  expect(labels).toContain('支撑')
  await expect(win.locator('.drawing-tools .btn', { hasText: '删除' })).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, 'draw-07-algo-result.png') })

  // 6. 矩形（黄色填充）→ 内部应是填充块（50% 填充），非仅描边
  await win.locator('.drawing-colors .drawing-color').nth(3).click() // 黄色 #f5c542
  const yellowBefore = await countYellow(win, CHART_REGION)
  await win.locator('.drawing-tools .btn', { hasText: '矩形' }).click()
  await win.waitForTimeout(500)
  const rs = await chartPoint(win, 0.3, 0.3)
  const re = await chartPoint(win, 0.7, 0.6)
  await win.mouse.move(rs.x, rs.y)
  await win.mouse.down()
  await win.mouse.move(re.x, re.y, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(1200)
  const yellowAfter = await countYellow(win, CHART_REGION)
  console.log(`>>> 矩形：黄色填充像素 ${yellowBefore} → ${yellowAfter}（增量 ${yellowAfter - yellowBefore}）`)
  // 拖拽会平移图表，但填充块位移不改变其像素量 → 增量≈填充块面积（应≥5000）
  expect(yellowAfter - yellowBefore).toBeGreaterThanOrEqual(5000)
  await win.screenshot({ path: path.join(SHOTS_DIR, 'draw-08-rect.png') })

  await app.close()
})

test('画线管理：显示/隐藏勾选 + 删除进回收站 + 恢复', async () => {
  test.setTimeout(150_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 进详情，清空该股票测试画线，回自选后再进
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  const code0 = (await win.locator('.detail-name-box .stock-code').textContent()).trim()
  const secid = (code0.startsWith('6') ? '1.' : '0.') + code0
  await win.evaluate(async (sid) => window.api.drawings.clear(sid), secid)
  await win.locator('.sidebar-item', { hasText: '自选股' }).click()
  await win.waitForTimeout(1200)
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await win.locator('.tab', { hasText: '日K' }).click()
  await win.waitForTimeout(4000)

  // 白像素计数（亮度>200）；图表内容本身有若干 >200 像素，故用"基线对比"
  const whiteVisible = () => countLum(win, 200, CHART_REGION)
  const baseline = await whiteVisible()
  console.log(`>>> 画线前基线 lum>=200 = ${baseline}`)

  // 选白色，画一条水平线（制造可管理的画线）
  await win.locator('.drawing-colors .drawing-color').nth(5).click()
  await win.locator('.drawing-tools .btn', { hasText: '水平线' }).click()
  await win.waitForTimeout(500)
  const b = await win.locator('.chart-pane:not(.pane-hidden) .chart-box canvas').boundingBox()
  await win.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5)
  await win.waitForTimeout(1200)
  expect(await whiteVisible()).toBeGreaterThan(baseline + 500)

  // 打开管理面板：列表 1 条、复选框默认勾选
  await win.locator('.drawing-tools .btn', { hasText: '管理' }).click()
  await expect(win.locator('.drawing-panel .table-title', { hasText: '画线管理' })).toBeVisible()
  await expect(win.locator('.drawing-manage-item')).toHaveCount(1)
  await expect(win.locator('.drawing-manage-item input[type="checkbox"]')).toBeChecked()

  // 取消勾选 → 图表上画线隐藏（回到基线）
  await win.locator('.drawing-manage-item input[type="checkbox"]').uncheck()
  await win.waitForTimeout(800)
  // 阈值 baseline+400：隐藏后仅剩重绘抗锯齿噪声（实测 +230~270），+200 过紧会误报
  expect(await whiteVisible()).toBeLessThan(baseline + 400)
  console.log('✓ 取消勾选后画线隐藏（回到基线）')

  // 重新勾选 → 重新显示
  await win.locator('.drawing-manage-item input[type="checkbox"]').check()
  await win.waitForTimeout(800)
  expect(await whiteVisible()).toBeGreaterThan(baseline + 500)
  console.log('✓ 重新勾选后画线恢复显示')

  // 删除 → 进回收站
  await win.locator('.drawing-manage-item .btn', { hasText: '删除' }).click()
  await win.waitForTimeout(800)
  await expect(win.locator('.drawing-manage-item')).toHaveCount(0)
  expect(await whiteVisible()).toBeLessThan(baseline + 400)
  console.log('✓ 删除后进入回收站（列表空、图表回到基线）')

  // 回收站：1 条 → 恢复
  await win.locator('.drawing-panel .btn', { hasText: /回收站/ }).click()
  await expect(win.locator('.drawing-manage-item')).toHaveCount(1)
  await win.locator('.drawing-manage-item .btn', { hasText: '恢复' }).click()
  await win.waitForTimeout(800)
  await win.locator('.drawing-panel .btn', { hasText: '画线列表' }).click()
  await expect(win.locator('.drawing-manage-item')).toHaveCount(1)
  console.log('✓ 从回收站恢复，回到画线列表')

  // 关闭面板，画线重新显示在图表
  await win.locator('.drawing-panel .btn', { hasText: '关闭' }).click()
  expect(await whiteVisible()).toBeGreaterThan(baseline + 500)
  console.log('✓ 恢复后画线重新显示在图表')
  await win.screenshot({ path: path.join(SHOTS_DIR, 'draw-09-manage.png') })

  await app.close()
})
