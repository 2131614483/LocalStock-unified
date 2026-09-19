// 算法画线端到端回归：隔离用户数据，验证生成、持久化与 canvas 实际渲染。
const { _electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const APP_EXE = process.env.LOCALSTOCK_TEST_EXE
  ? path.resolve(process.env.LOCALSTOCK_TEST_EXE)
  : path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOT = path.resolve(__dirname, '../test-results/18-algo-fixed.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localstock-algo-test-'))
  let app

  try {
    app = await _electron.launch({
      executablePath: APP_EXE,
      args: [`--user-data-dir=${profileRoot}`],
      env: {
        ...process.env,
        APPDATA: profileRoot,
        LOCALSTOCK_NO_SINGLETON: '1'
      }
    })

    const actualUserData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    assert(
      path.resolve(actualUserData).toLowerCase().startsWith(path.resolve(profileRoot).toLowerCase()),
      `测试没有使用隔离用户目录：${actualUserData}`
    )

    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0]
      current.show()
      current.focus()
    })
    await win.waitForTimeout(6000)

    const firstRow = win.locator('.stock-table tbody tr').first()
    await firstRow.waitFor({ timeout: 30_000 })
    await firstRow.click()
    await win.waitForTimeout(5000)

    const secid = await win.evaluate(() => {
      const code = document.querySelector('.detail-name-box .stock-code')?.textContent?.trim()
      if (!code) return null
      return `${code.startsWith('6') ? '1' : '0'}.${code}`
    })
    assert(secid, '未进入股票详情页，无法取得 secid')

    await win.evaluate(() => {
      const tab = [...document.querySelectorAll('.tab')].find((node) => node.textContent?.trim() === '日K')
      tab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await win.waitForTimeout(4000)
    assert(await win.locator('.drawing-tools').count(), '日 K 画线工具条未出现')

    const before = await win.evaluate(
      (sid) => window.api.drawings.get(sid).then((result) => result.current.length),
      secid
    )
    assert(before === 0, `隔离用户目录中不应存在历史画线，实际为 ${before}`)

    await win.evaluate(() => {
      const button = [...document.querySelectorAll('.drawing-tools .btn')]
        .find((node) => node.textContent?.trim() === '算法画线')
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await win.locator('.drawing-panel textarea').waitFor({ timeout: 5000 })
    await win.evaluate(() => {
      const button = [...document.querySelectorAll('.drawing-panel .btn')]
        .find((node) => node.textContent?.includes('运行'))
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await win.waitForFunction(() => {
      return Boolean(
        document.querySelector('.drawing-panel .backtest-target-bar') ||
        document.querySelector('.drawing-panel .backtest-error')
      )
    }, null, { timeout: 30_000 })

    const panelResult = await win.evaluate(() => ({
      ok: document.querySelector('.drawing-panel .backtest-target-bar')?.textContent?.trim() ?? null,
      error: document.querySelector('.drawing-panel .backtest-error')?.textContent?.trim() ?? null
    }))
    assert(!panelResult.error, `算法运行失败：${panelResult.error}`)

    const after = await win.evaluate(
      (sid) => window.api.drawings.get(sid).then((result) => result.current),
      secid
    )
    assert(after.length === 3, `预期生成 3 条画线，实际 ${after.length}`)
    assert(after.filter((item) => item.type === 'hline').length === 2, '缺少压力/支撑水平线')
    assert(after.filter((item) => item.type === 'segment').length === 1, '缺少趋势线')

    await win.waitForTimeout(1500)
    const pixels = await win.evaluate(() => {
      const canvas = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box canvas')
      if (!canvas) return { error: 'no canvas' }
      const ctx = canvas.getContext('2d')
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const targets = {
        red: { rgb: [245, 34, 45], tolerance: 14, rows: [], total: 0 },
        green: { rgb: [20, 177, 67], tolerance: 14, rows: [], total: 0 },
        blue: { rgb: [47, 129, 247], tolerance: 20, rows: [], total: 0 }
      }

      for (let y = 0; y < canvas.height; y++) {
        const counts = { red: 0, green: 0, blue: 0 }
        for (let x = 0; x < canvas.width; x += 4) {
          const offset = (y * canvas.width + x) * 4
          if (data[offset + 3] < 200) continue
          for (const [name, target] of Object.entries(targets)) {
            const [r, g, b] = target.rgb
            if (
              Math.abs(data[offset] - r) <= target.tolerance &&
              Math.abs(data[offset + 1] - g) <= target.tolerance &&
              Math.abs(data[offset + 2] - b) <= target.tolerance
            ) {
              counts[name]++
              target.total++
            }
          }
        }
        for (const name of Object.keys(targets)) {
          if (counts[name] > 20) targets[name].rows.push(counts[name])
        }
      }

      const summarize = (target) => ({
        rows: target.rows.length,
        maxCount: target.rows.length ? Math.max(...target.rows) : 0,
        total: target.total
      })
      return {
        width: canvas.width,
        height: canvas.height,
        red: summarize(targets.red),
        green: summarize(targets.green),
        blue: summarize(targets.blue)
      }
    })

    assert(!pixels.error, '没有找到当前 K 线 canvas')
    // 每 4px 采样一次；水平线应横跨主图，显著长于普通蜡烛。
    assert(pixels.red.maxCount >= 150, `压力线未横向渲染：${JSON.stringify(pixels.red)}`)
    assert(pixels.green.maxCount >= 150, `支撑线未横向渲染：${JSON.stringify(pixels.green)}`)
    assert(pixels.blue.total >= 100, `趋势线未渲染：${JSON.stringify(pixels.blue)}`)

    const chartScale = await win.evaluate(() => {
      const dom = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box')
      const instance = window.echarts?.getInstanceByDom?.(dom)
      if (!instance) return { error: 'no echarts instance' }
      const option = instance.getOption()
      const candleData = option.series?.find((item) => item.type === 'candlestick')?.data ?? []
      const start = Number(option.dataZoom?.[0]?.start ?? 0)
      const end = Number(option.dataZoom?.[0]?.end ?? 100)
      const from = Math.max(0, Math.floor(candleData.length * start / 100))
      const to = Math.min(candleData.length, Math.ceil(candleData.length * end / 100))
      const visible = candleData.slice(from, to)
      const visibleLow = Math.min(...visible.map((item) => Number(item[2])))
      const visibleHigh = Math.max(...visible.map((item) => Number(item[3])))
      const axisExtent = instance.getModel().getComponent('yAxis', 0).axis.scale.getExtent()
      return {
        filterModes: option.dataZoom?.map((item) => item.filterMode),
        visibleLow,
        visibleHigh,
        axisMin: axisExtent[0],
        axisMax: axisExtent[1]
      }
    })
    assert(!chartScale.error, '无法读取 K 线价格轴状态')
    assert(
      chartScale.filterModes.every((mode) => mode === 'filter'),
      `dataZoom 过滤模式不正确：${JSON.stringify(chartScale.filterModes)}`
    )
    const visibleRange = Math.max(0.01, chartScale.visibleHigh - chartScale.visibleLow)
    const axisRange = chartScale.axisMax - chartScale.axisMin
    assert(
      axisRange <= visibleRange * 3,
      `价格轴被窗口外历史数据压缩：${JSON.stringify(chartScale)}`
    )

    // 再缩放到最后 60 根，验证 datazoom 事件会更新 custom series 可视锚点，画线不会再次消失。
    const zoomCheck = await win.evaluate(async () => {
      const dom = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box')
      const instance = window.echarts?.getInstanceByDom?.(dom)
      if (!instance) return { error: 'no echarts instance' }
      const beforeOption = instance.getOption()
      const candleData = beforeOption.series?.find((item) => item.type === 'candlestick')?.data ?? []
      const targetStart = Math.max(0, (candleData.length - 60) / candleData.length * 100)
      instance.dispatchAction({ type: 'dataZoom', start: targetStart, end: 100 })
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const option = instance.getOption()
      const canvas = dom.querySelector('canvas')
      const ctx = canvas.getContext('2d')
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const colors = {
        red: { rgb: [245, 34, 45], tolerance: 14, maxRow: 0 },
        green: { rgb: [20, 177, 67], tolerance: 14, maxRow: 0 }
      }
      for (let y = 0; y < canvas.height; y++) {
        const counts = { red: 0, green: 0 }
        for (let x = 0; x < canvas.width; x += 4) {
          const offset = (y * canvas.width + x) * 4
          if (image[offset + 3] < 200) continue
          for (const [name, target] of Object.entries(colors)) {
            const [r, g, b] = target.rgb
            if (
              Math.abs(image[offset] - r) <= target.tolerance &&
              Math.abs(image[offset + 1] - g) <= target.tolerance &&
              Math.abs(image[offset + 2] - b) <= target.tolerance
            ) counts[name]++
          }
        }
        colors.red.maxRow = Math.max(colors.red.maxRow, counts.red)
        colors.green.maxRow = Math.max(colors.green.maxRow, counts.green)
      }
      const axisExtent = instance.getModel().getComponent('yAxis', 0).axis.scale.getExtent()
      return {
        targetStart,
        actualStart: Number(option.dataZoom?.[0]?.start),
        redMaxRow: colors.red.maxRow,
        greenMaxRow: colors.green.maxRow,
        axisMin: axisExtent[0],
        axisMax: axisExtent[1]
      }
    })
    assert(!zoomCheck.error, '无法执行缩放后的画线回归')
    assert(Math.abs(zoomCheck.actualStart - zoomCheck.targetStart) < 0.2, `缩放状态未保持：${JSON.stringify(zoomCheck)}`)
    assert(zoomCheck.redMaxRow >= 150, `缩放后压力线消失：${JSON.stringify(zoomCheck)}`)
    assert(zoomCheck.greenMaxRow >= 150, `缩放后支撑线消失：${JSON.stringify(zoomCheck)}`)

    fs.mkdirSync(path.dirname(SHOT), { recursive: true })
    await win.screenshot({ path: SHOT })
    console.log(JSON.stringify({
      ok: true,
      isolatedUserData: actualUserData,
      secid,
      panelResult,
      drawings: after.map(({ type, color, label }) => ({ type, color, label })),
      pixels,
      chartScale,
      zoomCheck,
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
