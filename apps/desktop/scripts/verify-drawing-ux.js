// 画线 UX 回归：隔离用户数据验证算法编辑框尺寸、分时/多周期工具栏、拖拽实时预览与周期隔离。
const { _electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const APP_EXE = process.env.LOCALSTOCK_TEST_EXE
  ? path.resolve(process.env.LOCALSTOCK_TEST_EXE)
  : path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOT = path.resolve(__dirname, '../test-results/19-drawing-ux.png')
const EDITOR_SHOT = path.resolve(__dirname, '../test-results/19-algo-editor-resized.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function clickButton(win, text) {
  await win.getByRole('button', { name: text, exact: true }).click()
}

async function drawWithPreview(win, chartSelector, toolName) {
  await clickButton(win, toolName)
  const chartBox = win.locator(chartSelector)
  const bounds = await chartBox.boundingBox()
  assert(bounds, `找不到图表区域：${chartSelector}`)
  const start = { x: bounds.x + bounds.width * 0.32, y: bounds.y + bounds.height * 0.30 }
  const end = { x: bounds.x + bounds.width * 0.62, y: bounds.y + bounds.height * 0.52 }

  await win.mouse.move(start.x, start.y)
  await win.mouse.down()
  await win.mouse.move(end.x, end.y, { steps: 8 })
  await win.waitForTimeout(500)

  const preview = await win.evaluate((selector) => {
    const dom = document.querySelector(selector)
    const instance = window.echarts?.getInstanceByDom?.(dom)
    const custom = instance?.getOption()?.series?.find((series) => series.type === 'custom')
    return { present: Boolean(custom), dataLength: custom?.data?.length ?? 0 }
  }, chartSelector)
  assert(preview.present && preview.dataLength >= 1, `${toolName} 拖动过程中没有实时预览：${JSON.stringify(preview)}`)

  await win.mouse.up()
  await win.waitForTimeout(700)
  return preview
}

async function main() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localstock-drawing-ux-'))
  let app

  try {
    app = await _electron.launch({
      executablePath: APP_EXE,
      args: [`--user-data-dir=${profileRoot}`],
      env: { ...process.env, APPDATA: profileRoot, LOCALSTOCK_NO_SINGLETON: '1' }
    })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0]
      current.show()
      current.focus()
    })
    await win.waitForTimeout(6000)
    await win.locator('.stock-table tbody tr').first().waitFor({ timeout: 30_000 })
    await win.locator('.stock-table tbody tr').first().click()
    await win.waitForTimeout(5000)

    const secid = await win.evaluate(() => {
      const code = document.querySelector('.detail-name-box .stock-code')?.textContent?.trim()
      return code ? `${code.startsWith('6') ? '1' : '0'}.${code}` : null
    })
    assert(secid, '未进入股票详情页')

    // 1) 默认当日分时也有完整画线工具，并可调整/记忆算法编辑框高度。
    await win.locator('.minute-chart-col .chart-box canvas').waitFor({ timeout: 20_000 })
    assert(await win.locator('.drawing-tools').count(), '当日分时没有画线工具栏')
    await clickButton(win, '算法画线')
    const editor = win.locator('.drawing-algo-editor')
    await editor.waitFor({ timeout: 5000 })
    const initialHeight = await editor.evaluate((node) => node.offsetHeight)
    assert(initialHeight >= 350, `算法代码框默认高度仍过小：${initialHeight}`)
    await editor.evaluate((node) => {
      node.style.height = '520px'
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    const savedHeight = await win.evaluate(() => Number(localStorage.getItem('drawing.algo.editorHeight')))
    assert(savedHeight >= 500, `算法代码框高度没有持久化：${savedHeight}`)
    await win.locator('.drawing-panel').getByRole('button', { name: '关闭', exact: true }).click()
    await clickButton(win, '算法画线')
    const restoredHeight = await win.locator('.drawing-algo-editor').evaluate((node) => node.offsetHeight)
    assert(restoredHeight >= 500, `重新打开后代码框高度未恢复：${restoredHeight}`)
    fs.mkdirSync(path.dirname(EDITOR_SHOT), { recursive: true })
    await win.locator('.drawing-algo-editor').evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await win.waitForTimeout(300)
    await win.screenshot({ path: EDITOR_SHOT })
    await win.locator('.drawing-panel').getByRole('button', { name: '运行并画线', exact: true }).click()
    await win.locator('.drawing-panel .backtest-target-bar').waitFor({ timeout: 30_000 })
    const minuteAlgoDrawings = await win.evaluate(
      (sid) => window.api.drawings.get(sid).then((result) => result.current),
      secid
    )
    assert(minuteAlgoDrawings.length === 3, `分时算法画线没有生成 3 条：${minuteAlgoDrawings.length}`)
    assert(minuteAlgoDrawings.every((drawing) => drawing.scope === 'minute:day'), '分时算法画线周期未隔离')
    await win.locator('.drawing-panel').getByRole('button', { name: '关闭', exact: true }).click()

    // 2/3) 当日分时矩形在 mouseup 前已有预览；完成后保存到 minute:day。
    const minutePreview = await drawWithPreview(win, '.minute-chart-col .chart-box', '矩形')
    const minuteDrawings = await win.evaluate((sid) => window.api.drawings.get(sid).then((result) => result.current), secid)
    assert(minuteDrawings.length === 4, `分时手动画线未保存：${minuteDrawings.length}`)
    assert(minuteDrawings.every((drawing) => drawing.scope === 'minute:day'), '分时画线周期错误')

    // 切到日 K：分时画线不串入；趋势线同样有实时预览并保存到 kline:day。
    await win.locator('.tab').filter({ hasText: /^日K$/ }).click()
    await win.waitForTimeout(4500)
    const dayChartSelector = '.chart-pane:not(.pane-hidden) .chart-box'
    const initialDayCustom = await win.evaluate((selector) => {
      const dom = document.querySelector(selector)
      return window.echarts?.getInstanceByDom?.(dom)?.getOption()?.series?.filter((series) => series.type === 'custom').length ?? 0
    }, dayChartSelector)
    assert(initialDayCustom === 0, `分时画线串到了日 K：custom=${initialDayCustom}`)
    const dayPreview = await drawWithPreview(win, dayChartSelector, '趋势线')
    const allDrawings = await win.evaluate((sid) => window.api.drawings.get(sid).then((result) => result.current), secid)
    assert(allDrawings.length === 5, `日 K 画线未保存：${allDrawings.length}`)
    assert(allDrawings.some((drawing) => drawing.scope === 'kline:day'), '缺少 kline:day 画线')

    // 周 K 与分钟 K 入口均存在，覆盖“每一个窗口”的周期入口。
    await win.locator('.tab').filter({ hasText: /^周K$/ }).click()
    await win.waitForTimeout(2500)
    assert(await win.locator('.drawing-tools').count(), '周 K 没有画线工具栏')
    await win.locator('.tab').filter({ hasText: /^分时$/ }).first().click()
    await win.locator('.tab').filter({ hasText: /^5分$/ }).click()
    await win.waitForTimeout(3000)
    assert(await win.locator('.drawing-tools').count(), '5 分钟 K 没有画线工具栏')

    fs.mkdirSync(path.dirname(SHOT), { recursive: true })
    await win.screenshot({ path: SHOT })
    console.log(JSON.stringify({
      ok: true,
      secid,
      initialHeight,
      savedHeight,
      restoredHeight,
      minutePreview,
      dayPreview,
      scopes: allDrawings.map((drawing) => drawing.scope),
      editorScreenshot: EDITOR_SHOT,
      screenshot: SHOT
    }, null, 2))
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(profileRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
