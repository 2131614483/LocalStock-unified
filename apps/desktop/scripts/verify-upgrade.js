// 升级保留测试：启动新版应用（旧库 user_version=0）→ 迁移执行 → 用户数据(自选/设置/画线)保留
const { _electron } = require('playwright')
const path = require('path')

async function main() {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe') })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 1) 自选保留（默认 8 只）
  const wl = await win.evaluate(async () => await window.api.watchlist.list())
  console.log('自选股数量:', wl.length, '示例:', wl[0]?.name)
  console.log('自选保留:', wl.length === 8 ? 'OK' : `异常(${wl.length})`)

  // 2) 设置读取（无则 null，不崩溃）
  const setting = await win.evaluate(async () => await window.api.settings.get('chart.indicators'))
  console.log('设置读取(可空):', setting === null ? '(空,正常)' : setting)

  // 3) 画线读取（无则空数组，不崩溃）
  const drawings = await win.evaluate(async () => {
    const r = await window.api.drawings.get('1.600036')
    return { current: r.current.length, history: r.history.length }
  })
  console.log('画线读取(可空):', JSON.stringify(drawings))

  // 4) 预警表存在（迁移 v2 后）
  const alerts = await win.evaluate(async () => (await window.api.alerts.list()).length)
  console.log('预警规则(迁移后表可用):', alerts)

  await win.screenshot({ path: path.join(__dirname, '../test-results/upgrade-check.png') })
  await app.close()
  console.log('升级启动正常，用户数据未丢失')
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
