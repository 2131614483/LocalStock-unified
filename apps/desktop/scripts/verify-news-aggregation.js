const { _electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const executablePath = path.resolve(process.env.LOCALSTOCK_TEST_EXE || 'dist/win-unpacked/LocalStock.exe')
const shot = path.resolve(__dirname, '../test-results/24-news-aggregation.png')
const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'localstock-news-'))
  let app
  try {
    app = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env: { ...process.env, APPDATA: profile, LOCALSTOCK_NO_SINGLETON: '1' } })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show())
    const apiResult = await win.evaluate(() => window.api.news.list('1.600519', '贵州茅台', 100))
    const historicalResult = await win.evaluate(() => window.api.news.range('1.600519', '贵州茅台', '2026-05-26', '2026-06-15'))
    console.log('historical direct:', historicalResult.items.length, historicalResult.items[0])
    assert(apiResult.items.length >= 20 && apiResult.items.length <= 100, '新闻接口没有返回最多100条聚合数据')
    await win.evaluate(() => window.api.watchlist.add({ secid: '1.600519', code: '600519', name: '贵州茅台' }))
    await win.reload()
    await win.locator('.stock-table tbody tr').filter({ hasText: '贵州茅台' }).first().click({ timeout: 15000 })
    await win.getByRole('button', { name: '新闻聚合', exact: true }).click()
    await win.locator('.stock-news-panel').waitFor()
    await win.locator('.stock-news-item').first().waitFor({ timeout: 15000 })
    const previewsOk = await win.locator('.stock-news-item p').evaluateAll((nodes) => nodes.every((node) => (node.textContent || '').replace(/…$/, '').length <= 100))
    assert(previewsOk, '新闻摘要超过前100字')
    assert(await win.getByRole('button', { name: /AI时间线梳理/ }).count() === 1, '缺少AI时间线梳理入口')
    await win.locator('.tab').filter({ hasText: /^日K$/ }).click()
    const chart = win.locator('.kline-chart-box canvas').first()
    await chart.waitFor({ timeout: 15000 })
    const box = await chart.boundingBox()
    assert(box, '找不到K线画布')
    await win.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.35)
    await win.waitForFunction(() => {
      const text = document.querySelector('.news-range-status')?.textContent || ''
      return !text.includes('正在检索') && !text.includes('将鼠标移到K线上')
    }, null, { timeout: 20000 })
    const status = await win.locator('.news-range-status').innerText()
    console.log('hover news status:', status)
    assert(!status.includes('将鼠标移到K线上'), 'K线悬停日期没有传给新闻窗口')
    assert(await win.locator('.stock-news-item').count() > 0, '历史K线日期窗口没有检索到原始新闻')
    await win.screenshot({ path: shot, fullPage: false })
    console.log(JSON.stringify({ ok: true, fetched: apiResult.items.length, visible: await win.locator('.stock-news-item').count(), status, screenshot: shot }, null, 2))
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
