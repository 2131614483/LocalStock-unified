// 诊断 v3：算法画线——不清除用户数据，运行前后对比画线数量是否增加
const { _electron } = require('playwright')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

async function main() {
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  app.process().stdout.on('data', (d) => {
    const s = d.toString()
    if (/DRAW|algo|画线|python|引擎|runDraw/i.test(s)) console.log('[out]', s.trim().slice(0, 300))
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await win.waitForTimeout(6000)

  await win.locator('.stock-table tbody tr').first().waitFor({ timeout: 30_000 })
  // 真实点击进详情
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(5000)

  const secid = await win.evaluate(() => {
    const code = document.querySelector('.detail-name-box .stock-code')?.textContent?.trim()
    return (code?.startsWith('6') ? '1.' : '0.') + code
  })
  console.log('secid:', secid)
  if (!secid || secid.endsWith('undefined')) {
    await win.screenshot({ path: path.resolve(__dirname, '../test-results/18-nodetail.png') })
    await app.close()
    process.exit(1)
  }

  // 运行前画线数量（不清除用户数据）
  const before = await win.evaluate((sid) => (window.api.drawings.get(sid)).then((r) => r.current.length), secid)
  console.log('运行前画线数量:', before)

  // 切日K（画线工具条仅日K显示）
  await win.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent?.trim() === '日K')
    t?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(4000)

  const hasTools = await win.evaluate(() => !!document.querySelector('.drawing-tools'))
  console.log('日K画线工具条存在:', hasTools)
  if (!hasTools) {
    console.log('!! 画线工具条未出现（未在日K tab 或详情未就绪）')
    await win.screenshot({ path: path.resolve(__dirname, '../test-results/18-notools.png') })
    await app.close()
    process.exit(1)
  }

  // 打开算法画线面板并运行
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.drawing-tools .btn')].find((x) => x.textContent.trim() === '算法画线')
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(800)
  const panelOpen = await win.evaluate(() => !!document.querySelector('.drawing-panel textarea'))
  console.log('算法面板打开:', panelOpen)

  await win.evaluate(() => {
    const run = [...document.querySelectorAll('.drawing-panel .btn')].find((x) => x.textContent.includes('运行'))
    run?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(12_000)
  const panelMsg = await win.evaluate(() => {
    const err = document.querySelector('.drawing-panel .backtest-error')?.textContent
    const ok = document.querySelector('.drawing-panel .backtest-target-bar')?.textContent
    return { err: err || null, ok: ok || null }
  })
  console.log('面板结果:', JSON.stringify(panelMsg))

  const after = await win.evaluate((sid) => (window.api.drawings.get(sid)).then((r) => r.current.length), secid)
  console.log('运行后画线数量:', after, '增量:', after - before)

  await win.screenshot({ path: path.resolve(__dirname, '../test-results/18-algo3.png') })
  await app.close()
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })