// 诊断：读 KLineChart option 里 custom series 是否存在 + 触发 renderItem 是否正确执行
const { _electron } = require('playwright')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

async function main() {
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  // 捕获渲染进程 DRAW-RENDER-ERR
  app.process().stdout.on('data', (d) => {
    const s = d.toString()
    if (/DRAW|renderItem|render-error|ERR/i.test(s)) console.log('[out]', s.trim().slice(0, 200))
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await win.waitForTimeout(6000)
  await win.locator('.stock-table tbody tr').first().waitFor({ timeout: 30_000 })
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(5000)
  const secid = await win.evaluate(() => {
    const code = document.querySelector('.detail-name-box .stock-code')?.textContent?.trim()
    return (code?.startsWith('6') ? '1.' : '0.') + code
  })
  await win.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent?.trim() === '日K')
    t?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(5000)

  const r = await win.evaluate(async (sid) => {
    const dom = document.querySelector('.chart-pane:not(.pane-hidden) .chart-box')
    const inst = window.echarts?.getInstanceByDom?.(dom)
    if (!inst) return { err: 'no echarts inst' }
    const opt = inst.getOption()
    const series = (opt.series ?? []).map((s) => ({ type: s.type, name: s.name, dataLen: s.data?.length ?? 0 }))
    // 画线 custom series 是否在
    const custom = series.find((s) => s.type === 'custom')
    const drawings = await window.api.drawings.get(sid)
    return {
      series,
      customPresent: !!custom,
      drawingCount: drawings.current.length,
      // 尝试手动触发 renderItem 看是否抛（模拟：从 drawings 取第一条 hline 用 renderItem 找不到，只能看 ECharts 是否渲染）
      zrHandlersOk: !!inst.getZr()
    }
  }, secid)
  console.log(JSON.stringify(r, null, 2))
  await app.close()
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })