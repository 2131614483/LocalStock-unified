const { _electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const executablePath = path.resolve(process.env.LOCALSTOCK_TEST_EXE || 'dist/win-unpacked/LocalStock.exe')
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'localstock-sqlite-speed-'))
  let app
  try {
    app = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env: { ...process.env, APPDATA: profile, LOCALSTOCK_NO_SINGLETON: '1' } })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    const result = await win.evaluate(async () => {
      const params = { pn: 1, pz: 50, fid: 'f3', order: 'desc' }
      const t0 = performance.now()
      const first = await window.api.market.getMarketList(params)
      const t1 = performance.now()
      const cached = await window.api.market.getMarketList(params)
      const t2 = performance.now()
      return { firstMs: t1 - t0, cachedMs: t2 - t1, total: first.total, rows: first.list.length, cachedRows: cached.list.length }
    })
    if (result.total < 5000 || result.firstMs > 2000 || result.cachedMs > 200) throw new Error(`性能不达标: ${JSON.stringify(result)}`)
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(profile, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exit(1) })
