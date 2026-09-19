// 视觉测试：分栏拖拽缩放（SplitPane）—— 边界缩放光标 + 拖拽改尺寸
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

async function cursorOf(win, sel) {
  return win.evaluate((s) => getComputedStyle(document.querySelector(s)).cursor, sel)
}

/** 在分隔条上横向拖拽 deltaX 像素 */
async function dragSplitter(win, sel, deltaX) {
  const box = await win.locator(sel).boundingBox()
  const y = box.y + box.height / 2
  await win.mouse.move(box.x + 3, y)
  await win.mouse.down()
  await win.mouse.move(box.x + 3 + deltaX, y, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(300)
}

async function maximize(app) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.maximize()
  })
  await new Promise((r) => setTimeout(r, 800))
}

test('K线看板：图表高度 + 主图/副图分割 拖拽缩放（↕）', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await maximize(app)
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await win.locator('.tab', { hasText: '日K' }).click()
  await win.waitForTimeout(3000)

  // 1. 图表高度横条 + 主图/副图分割条：row-resize 光标（分割条定位可见 pane，避开隐藏分时图）
  const kVResize = '.chart-v-resize'
  const kHSplit = '.chart-pane:not(.pane-hidden) .chart-h-split'
  const kWrap = '.chart-pane:not(.pane-hidden) .chart-resize-wrap'
  await expect(win.locator(kVResize)).toBeVisible()
  await expect(win.locator(kHSplit)).toBeVisible()
  expect(await cursorOf(win, kVResize)).toBe('row-resize')
  expect(await cursorOf(win, kHSplit)).toBe('row-resize')

  // 2. 拖拽底部高度横条 -80px（向上收缩）→ 图表变矮（横条可能在视口下方，先滚动到可见）
  const h0 = (await win.locator(kWrap).boundingBox()).height
  let vb = await win.locator(kVResize).boundingBox()
  console.log('>>> 高度条位置:', JSON.stringify({ y: vb.y, h: vb.height, bottom: Math.round(vb.y + vb.height) }))
  if (vb.y + vb.height > 820) {
    await win.evaluate(() => {
      const c = document.querySelector('.content')
      if (c) c.scrollTop = Math.max(0, c.scrollHeight)
    })
    await win.waitForTimeout(300)
    vb = await win.locator(kVResize).boundingBox()
    console.log('>>> 滚动后高度条 y:', Math.round(vb.y))
  }
  await win.mouse.move(vb.x + vb.width / 2, vb.y + 4)
  await win.mouse.down()
  await win.waitForTimeout(120)
  await win.mouse.move(vb.x + vb.width / 2, vb.y + 4 - 80, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const h1 = (await win.locator(kWrap).boundingBox()).height
  console.log('>>> 图表高度:', h0, '→', h1)
  expect(h1).toBeLessThan(h0 - 30)

  // 3. 主图/副图分割：先上移（价格区变小），再下移（变大）——相对断言，避免上限钳制
  const s0 = Number((await win.locator(kHSplit).getAttribute('style')).match(/top: ([\d.]+)px/)[1])
  let sb = await win.locator(kHSplit).boundingBox()
  await win.mouse.move(sb.x + 50, sb.y + 3)
  await win.mouse.down()
  await win.waitForTimeout(120)
  await win.mouse.move(sb.x + 50, sb.y + 3 - 40, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(300)
  const sUp = Number((await win.locator(kHSplit).getAttribute('style')).match(/top: ([\d.]+)px/)[1])
  sb = await win.locator(kHSplit).boundingBox()
  await win.mouse.move(sb.x + 50, sb.y + 3)
  await win.mouse.down()
  await win.waitForTimeout(120)
  await win.mouse.move(sb.x + 50, sb.y + 3 + 80, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(300)
  const sDown = Number((await win.locator(kHSplit).getAttribute('style')).match(/top: ([\d.]+)px/)[1])
  console.log('>>> 主图/副图分割 top:', s0, '→ 上', sUp, '→ 下', sDown)
  expect(sUp).toBeLessThan(s0)
  expect(sDown).toBeGreaterThan(sUp)
  await win.screenshot({ path: path.join(SHOTS_DIR, '37-resize-kline.png') })

  await app.close()
})

test('K线图与窗口等比例缩放（宽高比不变）', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await maximize(app)
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)
  // 重置持久化分栏宽度（避免残留值吃掉窗口宽度），再 reload
  await win.evaluate(() => {
    localStorage.setItem('split.sidebar', '168')
    localStorage.setItem('split.detail', '260')
    localStorage.setItem('split.minute', '520')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(5000)
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await win.locator('.tab', { hasText: '日K' }).click()
  await win.waitForTimeout(3000)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w.isMaximized()) w.unmaximize()
    w.setSize(1450, 900)
  })
  await win.waitForTimeout(1200)

  const wrap = '.chart-pane:not(.pane-hidden) .chart-resize-wrap'
  const b0 = await win.locator(wrap).boundingBox()
  const ratio0 = b0.height / b0.width
  console.log('>>> 初始宽高:', Math.round(b0.width), 'x', Math.round(b0.height), '比例', ratio0.toFixed(3))

  // 缩小窗口宽度 → 图表应等比例变矮
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1150, 900)
  })
  await win.waitForTimeout(1200)
  const b1 = await win.locator(wrap).boundingBox()
  const ratio1 = b1.height / b1.width
  console.log('>>> 缩小后宽高:', Math.round(b1.width), 'x', Math.round(b1.height), '比例', ratio1.toFixed(3))
  expect(b1.width).toBeLessThan(b0.width - 80)
  expect(Math.abs(ratio1 - ratio0)).toBeLessThan(0.06)

  // 放大窗口宽度 → 图表应等比例变高
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1450, 900)
  })
  await win.waitForTimeout(1200)
  const b2 = await win.locator(wrap).boundingBox()
  const ratio2 = b2.height / b2.width
  console.log('>>> 放大后宽高:', Math.round(b2.width), 'x', Math.round(b2.height), '比例', ratio2.toFixed(3))
  expect(b2.width).toBeGreaterThan(b1.width + 80)
  expect(Math.abs(ratio2 - ratio1)).toBeLessThan(0.06)
  await win.screenshot({ path: path.join(SHOTS_DIR, '38-resize-proportional.png') })

  await app.close()
})

test('分栏拖拽缩放：侧栏/盘口/模板/AI面板 光标+改尺寸', async () => {
  test.setTimeout(180_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await maximize(app)
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 1. 侧栏分隔条：col-resize 光标
  const sideSplit = '.main .splitter-col'
  await expect(win.locator(sideSplit)).toBeVisible()
  expect(await cursorOf(win, sideSplit)).toBe('col-resize')

  // 2. 拖拽侧栏：先缩后放（宽度持久化，起始值不定，用相对变化断言）
  const w0 = (await win.locator('.sidebar').boundingBox()).width
  await dragSplitter(win, sideSplit, -80)
  const wShrink = (await win.locator('.sidebar').boundingBox()).width
  await dragSplitter(win, sideSplit, 140)
  const wGrow = (await win.locator('.sidebar').boundingBox()).width
  console.log('>>> 侧栏宽度:', w0, '→ 缩', wShrink, '→ 放', wGrow)
  expect(wShrink).toBeLessThan(w0)
  expect(wGrow).toBeGreaterThan(wShrink)
  await win.screenshot({ path: path.join(SHOTS_DIR, '33-resize-sidebar.png') })

  // 3. 个股详情：盘口分隔条 col-resize（用直子选择器，避开分时图内嵌分隔条）
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  const obSplit = '.detail-bottom > .splitpane > .splitter-col'
  await expect(win.locator(obSplit)).toBeVisible()
  expect(await cursorOf(win, obSplit)).toBe('col-resize')
  const ob0 = (await win.locator('.orderbook').boundingBox()).width
  await dragSplitter(win, obSplit, -60)
  const obShrink = (await win.locator('.orderbook').boundingBox()).width
  await dragSplitter(win, obSplit, 100)
  const obGrow = (await win.locator('.orderbook').boundingBox()).width
  console.log('>>> 盘口宽度:', ob0, '→ 缩', obShrink, '→ 放', obGrow)
  expect(obShrink).toBeLessThan(ob0)
  expect(obGrow).toBeGreaterThan(obShrink)
  await win.screenshot({ path: path.join(SHOTS_DIR, '34-resize-detail.png') })

  // 4. 回测：模板分隔条 col-resize
  await win.locator('.sidebar-item span:not(.icon)', { hasText: /^回测$/ }).click()
  await win.waitForTimeout(2000)
  const tplSplit = '.editor-panel .splitter-col'
  await expect(win.locator(tplSplit)).toBeVisible()
  expect(await cursorOf(win, tplSplit)).toBe('col-resize')
  await win.screenshot({ path: path.join(SHOTS_DIR, '35-resize-backtest.png') })

  // 5. AI 面板：左侧把手 col-resize，拖拽改宽
  await win.locator('.ai-toggle[title="AI 助手"]').click()
  await expect(win.locator('.panel-resize-handle')).toBeVisible()
  expect(await cursorOf(win, '.panel-resize-handle')).toBe('col-resize')
  const p0 = (await win.locator('.ai-panel').boundingBox()).width
  await dragSplitter(win, '.panel-resize-handle', -120) // 把手向左拖 → 面板变宽
  const p1 = (await win.locator('.ai-panel').boundingBox()).width
  console.log('>>> AI 面板宽度:', p0, '→', p1)
  expect(p1).toBeGreaterThan(p0 + 40)
  await win.screenshot({ path: path.join(SHOTS_DIR, '36-resize-ai.png') })

  await app.close()
})
