// 图表快捷键回归：平移、缩放、最新/未来、输入保护、周期/画线与设置持久化。
const { _electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const packagedExe = process.env.LOCALSTOCK_TEST_EXE ? path.resolve(process.env.LOCALSTOCK_TEST_EXE) : null
const executablePath = packagedExe || require('electron')
const SHOT = path.resolve(__dirname, '../test-results/21-chart-shortcuts-settings.png')
const DETAIL_SHOT = path.resolve(__dirname, '../test-results/21-chart-shortcuts-pan.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function getZoom(win) {
  return win.evaluate(() => {
    const dom = document.querySelector('.chart-pane:not(.pane-hidden) .kline-chart-box')
    const option = window.echarts?.getInstanceByDom?.(dom)?.getOption()
    const candles = option?.series?.find((series) => series.type === 'candlestick')?.data ?? []
    const axis = option?.xAxis?.[0]?.data ?? []
    const zoom = option?.dataZoom?.[0]
    return {
      start: Number(zoom?.start),
      end: Number(zoom?.end),
      span: Number(zoom?.end) - Number(zoom?.start),
      candles: candles.length,
      axis: axis.length
    }
  })
}

async function openFirstStockDayK(win) {
  await win.getByRole('button', { name: '自选股', exact: true }).click()
  await win.locator('.stock-table tbody tr').first().waitFor({ timeout: 30_000 })
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(3500)
  await win.locator('.tab').filter({ hasText: /^日K$/ }).click()
  await win.locator('.chart-pane:not(.pane-hidden) .kline-chart-box canvas').waitFor({ timeout: 20_000 })
  await win.waitForTimeout(1200)
}

async function main() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localstock-shortcuts-'))
  let app
  try {
    app = await _electron.launch({
      executablePath,
      args: [...(packagedExe ? [] : [projectRoot]), `--user-data-dir=${profileRoot}`],
      env: { ...process.env, APPDATA: profileRoot, LOCALSTOCK_NO_SINGLETON: '1' }
    })
    const win = await app.firstWindow()
    win.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`))
    win.on('pageerror', (error) => console.error(`[renderer-error] ${error.stack || error.message}`))
    await win.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show())
    await win.waitForTimeout(6000)
    await openFirstStockDayK(win)

    const initial = await getZoom(win)
    const oneDefaultStep = (10 / initial.axis) * 100
    await win.keyboard.press('ArrowLeft')
    await win.waitForTimeout(350)
    const left = await getZoom(win)
    assert(Math.abs((initial.start - left.start) - oneDefaultStep) < 0.08, `左键平移步长错误：${JSON.stringify({ initial, left })}`)

    await win.keyboard.press('ArrowRight')
    await win.waitForTimeout(350)
    const returned = await getZoom(win)
    assert(Math.abs(returned.start - initial.start) < 0.08, '右键未返回原窗口')

    await win.keyboard.press('Shift+ArrowLeft')
    await win.waitForTimeout(350)
    const fastLeft = await getZoom(win)
    assert(Math.abs((returned.start - fastLeft.start) - oneDefaultStep * 5) < 0.1, 'Shift 快速平移倍数错误')

    await win.keyboard.press('ArrowUp')
    await win.waitForTimeout(350)
    const zoomed = await getZoom(win)
    assert(zoomed.span < fastLeft.span, '上键没有放大图表')

    await win.keyboard.press('End')
    await win.waitForTimeout(350)
    const future = await getZoom(win)
    assert(Math.abs(future.end - 100) < 0.1, 'End 没有进入右侧留白')
    await win.keyboard.press('Home')
    await win.waitForTimeout(350)
    const latest = await getZoom(win)
    assert(Math.abs(latest.end - (latest.candles / latest.axis) * 100) < 0.1, 'Home 没有回到最新行情')

    // 输入保护：搜索框里按方向键不能移动图表。
    await win.locator('.search-input').focus()
    const beforeInput = await getZoom(win)
    await win.keyboard.press('ArrowLeft')
    await win.waitForTimeout(250)
    const afterInput = await getZoom(win)
    assert(Math.abs(afterInput.start - beforeInput.start) < 0.001, '输入框内方向键误操作了图表')
    await win.keyboard.press('Escape')
    await win.locator('.kline-chart-box').click({ position: { x: 20, y: 20 } })

    // 画线工具、取消与周期切换。
    await win.keyboard.press('Alt+T')
    assert(await win.getByRole('button', { name: '趋势线', exact: true }).evaluate((node) => node.classList.contains('active')), 'Alt+T 未选择趋势线')
    await win.keyboard.press('Escape')
    assert(!(await win.getByRole('button', { name: '趋势线', exact: true }).evaluate((node) => node.classList.contains('active'))), 'Esc 未取消画线')
    await win.keyboard.press(']')
    await win.waitForTimeout(1200)
    assert(await win.locator('.tab.active').filter({ hasText: /^周K$/ }).count(), '] 未切换到下一周期')

    // 设置页：切换专业模式、步长并确认写入 settings。
    await win.getByRole('button', { name: '设置', exact: true }).click()
    const card = win.locator('.shortcuts-settings-card')
    await card.waitFor({ timeout: 5000 })
    await card.locator('label').filter({ hasText: '快捷键模式' }).locator('select').selectOption('professional')
    await card.locator('label').filter({ hasText: '每次平移' }).locator('select').selectOption('20')
    await win.waitForTimeout(500)
    const saved = await win.evaluate(() => window.api.settings.get('chart.shortcuts').then((raw) => JSON.parse(raw)))
    assert(saved.mode === 'professional' && saved.panBars === 20, `快捷键设置未保存：${JSON.stringify(saved)}`)
    assert(await card.getByText('A/D', { exact: true }).count(), '专业模式说明未显示')
    fs.mkdirSync(path.dirname(SHOT), { recursive: true })
    await win.screenshot({ path: SHOT })

    // 专业模式实时生效：D 平移 20 根，数字 3 切换周 K。
    await openFirstStockDayK(win)
    const proInitial = await getZoom(win)
    await win.keyboard.press('d')
    await win.waitForTimeout(350)
    const proRight = await getZoom(win)
    const proStep = (20 / proInitial.axis) * 100
    assert(Math.abs((proRight.start - proInitial.start) - proStep) < 0.08, `专业模式 D 键步长错误：${JSON.stringify({ proInitial, proRight })}`)
    await win.keyboard.press('3')
    await win.waitForTimeout(1200)
    assert(await win.locator('.tab.active').filter({ hasText: /^周K$/ }).count(), '专业模式数字 3 未切换周 K')
    await win.keyboard.press('2')
    await win.waitForTimeout(1200)
    fs.mkdirSync(path.dirname(DETAIL_SHOT), { recursive: true })
    await win.screenshot({ path: DETAIL_SHOT })

    console.log(JSON.stringify({ ok: true, initial, left, fastLeft, zoomed, future, latest, saved, proInitial, proRight, screenshots: [SHOT, DETAIL_SHOT] }, null, 2))
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(profileRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
