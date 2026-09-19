// K 线右侧留白回归：默认最新 K 线靠右，向右拖到底后右半屏成为可画线区域。
const { _electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const packagedExe = process.env.LOCALSTOCK_TEST_EXE
  ? path.resolve(process.env.LOCALSTOCK_TEST_EXE)
  : null
const executablePath = packagedExe || require('electron')
const SHOT = path.resolve(__dirname, '../test-results/20-kline-right-space.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localstock-right-space-'))
  let app

  try {
    app = await _electron.launch({
      executablePath,
      args: [...(packagedExe ? [] : [projectRoot]), `--user-data-dir=${profileRoot}`],
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
    await win.locator('.tab').filter({ hasText: /^日K$/ }).click()
    await win.waitForTimeout(4500)

    const selector = '.chart-pane:not(.pane-hidden) .chart-box'
    await win.locator(`${selector} canvas`).waitFor({ timeout: 20_000 })
    const initial = await win.evaluate((chartSelector) => {
      const dom = document.querySelector(chartSelector)
      const chart = window.echarts?.getInstanceByDom?.(dom)
      const option = chart?.getOption()
      const candles = option?.series?.find((series) => series.type === 'candlestick')?.data ?? []
      const axis = option?.xAxis?.[0]?.data ?? []
      const zoom = option?.dataZoom?.[0]
      return {
        candleCount: candles.length,
        axisCount: axis.length,
        futureCount: axis.filter((value) => String(value).startsWith('__future_')).length,
        start: Number(zoom?.start),
        end: Number(zoom?.end)
      }
    }, selector)

    assert(initial.candleCount > 0, '日 K 没有行情数据')
    assert(initial.futureCount === Math.ceil(Math.min(120, initial.candleCount) / 2), `未来留白数量不正确：${JSON.stringify(initial)}`)
    assert(initial.axisCount === initial.candleCount + initial.futureCount, `横轴未包含未来留白：${JSON.stringify(initial)}`)
    assert(initial.end < 100, `默认窗口没有停在最新 K 线：${JSON.stringify(initial)}`)

    const span = initial.end - initial.start
    await win.evaluate(({ chartSelector, start }) => {
      const dom = document.querySelector(chartSelector)
      const chart = window.echarts?.getInstanceByDom?.(dom)
      chart?.dispatchAction({ type: 'dataZoom', start, end: 100 })
    }, { chartSelector: selector, start: 100 - span })
    await win.waitForTimeout(1200)

    const dragged = await win.evaluate((chartSelector) => {
      const dom = document.querySelector(chartSelector)
      const option = window.echarts?.getInstanceByDom?.(dom)?.getOption()
      const candles = option?.series?.find((series) => series.type === 'candlestick')?.data ?? []
      const axis = option?.xAxis?.[0]?.data ?? []
      const zoom = option?.dataZoom?.[0]
      const startIndex = Math.round(Number(zoom?.start) * axis.length / 100)
      const endIndex = Math.round(Number(zoom?.end) * axis.length / 100)
      const latestRatio = (candles.length - startIndex) / Math.max(1, endIndex - startIndex)
      return {
        candleCount: candles.length,
        axisCount: axis.length,
        start: Number(zoom?.start),
        end: Number(zoom?.end),
        startIndex,
        endIndex,
        latestRatio
      }
    }, selector)

    assert(Math.abs(dragged.end - 100) < 0.2, `无法向右拖到未来区域：${JSON.stringify(dragged)}`)
    assert(dragged.latestRatio > 0.42 && dragged.latestRatio < 0.58, `最新 K 线没有位于画面中央附近：${JSON.stringify(dragged)}`)

    // 右半屏空白不只是展示空间，还必须能实时预览并保存画线。
    await win.getByRole('button', { name: '趋势线', exact: true }).click()
    const chartBounds = await win.locator(selector).boundingBox()
    assert(chartBounds, '找不到日 K 图表区域')
    const startPoint = { x: chartBounds.x + chartBounds.width * 0.62, y: chartBounds.y + chartBounds.height * 0.30 }
    const endPoint = { x: chartBounds.x + chartBounds.width * 0.86, y: chartBounds.y + chartBounds.height * 0.48 }
    await win.mouse.move(startPoint.x, startPoint.y)
    await win.mouse.down()
    await win.mouse.move(endPoint.x, endPoint.y, { steps: 8 })
    await win.waitForTimeout(500)
    const previewCount = await win.evaluate((chartSelector) => {
      const dom = document.querySelector(chartSelector)
      const series = window.echarts?.getInstanceByDom?.(dom)?.getOption()?.series ?? []
      return series.find((item) => item.type === 'custom')?.data?.length ?? 0
    }, selector)
    assert(previewCount >= 1, '右侧空白区拖动画线时没有实时预览')
    await win.mouse.up()
    await win.waitForTimeout(700)
    const futureDrawing = await win.evaluate(() => {
      const code = document.querySelector('.detail-name-box .stock-code')?.textContent?.trim()
      const secid = code ? `${code.startsWith('6') ? '1' : '0'}.${code}` : ''
      return window.api.drawings.get(secid).then((result) => result.current.find((drawing) => drawing.scope === 'kline:day'))
    })
    assert(futureDrawing, '右侧空白区画线没有保存')
    assert(futureDrawing.points.every((point) => point.x >= initial.candleCount), `画线端点未落在未来区域：${JSON.stringify(futureDrawing.points)}`)

    fs.mkdirSync(path.dirname(SHOT), { recursive: true })
    await win.screenshot({ path: SHOT })
    console.log(JSON.stringify({ ok: true, initial, dragged, previewCount, futureDrawing, screenshot: SHOT }, null, 2))
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(profileRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
