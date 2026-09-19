// 诊断：对比手动画线与算法画线的数据差异，像素验证算法画线是否真的画到 canvas
const { _electron } = require('playwright')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

async function main() {
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
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
  // 切日K + 打开算法画线运行（默认模板生成 hline x2 + segment x1）
  await win.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent?.trim() === '日K')
    t?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(4000)
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.drawing-tools .btn')].find((x) => x.textContent.trim() === '算法画线')
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(800)
  await win.evaluate(() => {
    const run = [...document.querySelectorAll('.drawing-panel .btn')].find((x) => x.textContent.includes('运行'))
    run?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await win.waitForTimeout(10_000)

  // 读所有画线 + K线数据，检查算法画线坐标
  const info = await win.evaluate(async (sid) => {
    const r = await window.api.drawings.get(sid)
    const k = await window.api.market.getKline(sid, 101, 1)
    const n = k?.points?.length ?? 0
    const times = k?.points?.map((p) => p.time) ?? []
    return {
      n,
      all: r.current.map((d) => ({
        type: d.type,
        color: d.color,
        visible: d.visible,
        deleted: d.deleted,
        pts: d.points.map((p) => ({ x: p.x, t: p.t, y: p.y }))
      })),
      // 检查第一个 hline 的 y 是否在 K 线价区之间
      firstIdx: times[0],
      lastIdx: times[n - 1]
    }
  }, secid)
  console.log('K线点数:', info.n)
  for (const d of info.all) {
    const badX = d.pts.some((p) => p.x != null && (p.x < 0 || p.x > info.n))
    const noT = d.pts.every((p) => p.t === undefined)
    console.log(
      `- type=${d.type} color=${d.color} visible=${d.visible} deleted=${d.deleted} pts=${JSON.stringify(d.pts)} badX=${badX} noT=${noT}`
    )
  }
  await app.close()
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })