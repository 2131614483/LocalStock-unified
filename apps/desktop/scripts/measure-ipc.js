// 测量 IPC 耗时：导航详情/切周期/市场列表，抓 [IPC-SLOW] 日志
const { _electron } = require('playwright')
const path = require('path')

async function main() {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe') })
  const slow = []
  app.process().stdout.on('data', (d) => {
    const s = d.toString()
    if (s.includes('IPC-SLOW')) slow.push(s.trim().slice(0, 120))
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 市场列表
  await win.locator('.sidebar-item', { hasText: '沪深A股' }).click()
  await win.waitForTimeout(4000)
  // 详情：日K / 分时
  await win.locator('.sidebar-item', { hasText: '自选股' }).click()
  await win.waitForTimeout(1500)
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  await win.getByText('日K', { exact: true }).click()
  await win.waitForTimeout(4000)
  // 切周期：周/月/季 + 分钟
  for (const p of ['周K', '月K', '季K']) {
    await win.getByText(p, { exact: true }).click()
    await win.waitForTimeout(2500)
  }
  await win.locator('.chart-tabs').first().getByText('分时', { exact: true }).click()
  await win.waitForTimeout(1500)
  await win.getByText('60分', { exact: true }).click()
  await win.waitForTimeout(2500)

  await app.close()
  console.log(`=== IPC-SLOW 日志（>100ms）共 ${slow.length} 条 ===`)
  for (const s of slow) console.log('  ' + s)
  if (!slow.length) console.log('  （无超过 100ms 的 handler）')
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
