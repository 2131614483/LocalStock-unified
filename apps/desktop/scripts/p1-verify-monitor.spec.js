// B3 验证 v2：监盘窗 SplitPane 在 默认窗口 / 最大化 两种尺寸下都正确
// 默认 940x640：钳制生效，事件面板可见；最大化（如 1920x1080）：initial 不被错误钳小，两栏都大
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const { execSync } = require('child_process')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

async function openMonitor(app, win) {
  await win.evaluate(() => {
    localStorage.removeItem('split.monitor')
    window.api.monitor.openWindow()
  })
  const mon = await app.waitForEvent('window', { timeout: 15_000 })
  await mon.waitForLoadState('domcontentloaded')
  await mon.waitForTimeout(2500)
  return mon
}

async function measure(mon) {
  return mon.evaluate(() => {
    const body = document.querySelector('.monitor-body')
    const items = document.querySelectorAll('.monitor-body .splitpane > .splitpane-item')
    const t = items[0]?.getBoundingClientRect()
    const e = items[1]?.getBoundingClientRect()
    return {
      bodyW: body?.getBoundingClientRect().width ?? 0,
      tableW: t?.width ?? 0,
      eventsW: e?.width ?? 0,
      eventsH: e?.height ?? 0
    }
  })
}

test('B3 验证：监盘窗 默认尺寸 + 最大化', async () => {
  test.setTimeout(180_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(3000)

  // ---- 场景1：默认 940x640 ----
  let mon = await openMonitor(app, win)
  let d = await measure(mon)
  console.log(`>>> [默认940] body宽=${d.bodyW.toFixed(0)} 表格格=${d.tableW.toFixed(0)} 事件格=${d.eventsW.toFixed(0)}x${d.eventsH.toFixed(0)}`)
  expect(d.eventsW).toBeGreaterThan(120)
  expect(d.tableW + d.eventsW).toBeLessThanOrEqual(d.bodyW + 10)
  await mon.close()
  await win.waitForTimeout(800)

  // ---- 场景2：最大化监盘窗（重开，最大化）----
  // 先把分隔条拖到 800（用户值），验证：最大化恢复 800；缩回默认窗钳小；再最大化又恢复 800
  mon = await openMonitor(app, win)
  // 拖分隔条到 ~800（JS 模拟 mousedown/mousemove/mouseup）
  await mon.evaluate(() => {
    const sp = document.querySelector('.monitor-body .splitpane')
    const splitter = sp?.querySelector('.splitter')
    if (!splitter) return
    const rect = splitter.getBoundingClientRect()
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    splitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }))
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 480, clientY: y }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 480, clientY: y }))
  })
  await mon.waitForTimeout(400)
  let d2 = await measure(mon)
  console.log(`>>> [拖到800] 表格格=${d2.tableW.toFixed(0)} 事件格=${d2.eventsW.toFixed(0)}`)
  const userW = d2.tableW
  expect(userW).toBeGreaterThan(700) // 用户拖大生效

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('监盘'))
    if (w) w.maximize()
  }, { BrowserWindow: (await import('electron')).BrowserWindow })
  await mon.waitForTimeout(1200) // 等 resize + 钳制重算
  d2 = await measure(mon)
  console.log(`>>> [最大化] body宽=${d2.bodyW.toFixed(0)} 表格格=${d2.tableW.toFixed(0)} 事件格=${d2.eventsW.toFixed(0)}x${d2.eventsH.toFixed(0)}`)
  expect(d2.tableW + d2.eventsW).toBeLessThanOrEqual(d2.bodyW + 10)
  expect(d2.eventsW).toBeGreaterThan(120)
  expect(d2.tableW).toBeGreaterThan(700) // 最大化后用户值完整恢复（不被钳小值卡死）

  // 缩回默认尺寸：钳制生效，事件格仍可见
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('监盘'))
    if (w) {
      w.unmaximize()
      w.setSize(940, 640)
    }
  }, { BrowserWindow: (await import('electron')).BrowserWindow })
  await mon.waitForTimeout(1000)
  d2 = await measure(mon)
  console.log(`>>> [缩回940] 表格格=${d2.tableW.toFixed(0)} 事件格=${d2.eventsW.toFixed(0)}`)
  expect(d2.tableW).toBeLessThan(userW) // 被钳小
  expect(d2.eventsW).toBeGreaterThan(120) // 事件格仍可见
  await mon.screenshot({ path: path.resolve(__dirname, '../test-results/13-monitor-maximized.png') })
  await app.close()
})
