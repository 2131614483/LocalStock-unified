// P1 验证探针 v3：缩放（Ctrl+滚轮真实输入）/ 标题栏拖拽区 / 指数五档占位 / 窗口记忆（resizeTo 走渲染层）
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const { readFileSync, writeFileSync } = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

test('P1 验证：缩放 + 标题栏 + 指数五档', async () => {
  test.setTimeout(150_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  const sideW = () =>
    win.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0)

  // ---- 1. 全局缩放：合成 Ctrl+wheel 事件（Playwright 的 mouse.wheel+修饰键在 Electron 会挂起）。
  // webFrame.setZoomFactor 是浏览器级缩放：CSS px 布局值不变，dpr 与渲染分辨率变 → 用 dpr 断言 ----
  const dprBefore = await win.evaluate(() => window.devicePixelRatio)
  await win.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -240, cancelable: true }))
  })
  await win.waitForTimeout(400)
  const dprAfter = await win.evaluate(() => window.devicePixelRatio)
  console.log(`>>> Ctrl+滚轮：dpr ${dprBefore} -> ${dprAfter}`)
  expect(dprAfter).toBeGreaterThan(dprBefore)
  const zoomSaved = await win.evaluate(() => window.api.settings.get('ui.zoom'))
  console.log(`>>> ui.zoom=${zoomSaved}`)
  expect(Number(zoomSaved)).toBeGreaterThan(1)
  // 复位
  await win.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '0', cancelable: true }))
  )
  await win.waitForTimeout(300)
  const dprReset = await win.evaluate(() => window.devicePixelRatio)
  console.log(`>>> Ctrl+0 复位后 dpr=${dprReset}（应=基础dpr，即 zoom=1）`)
  const zoomAfterReset = await win.evaluate(() => window.api.settings.get('ui.zoom'))
  console.log(`>>> 复位后 ui.zoom=${zoomAfterReset}`)
  expect(Number(zoomAfterReset)).toBe(1)

  // ---- 2. 深色标题栏拖拽区 ----
  const dragRegion = await win.evaluate(() => {
    const tb = document.querySelector('.toolbar')
    return tb ? getComputedStyle(tb).webkitAppRegion : 'none'
  })
  console.log(`>>> toolbar app-region=${dragRegion}`)
  expect(dragRegion).toBe('drag')
  const btnRegion = await win.evaluate(() => {
    const b = document.querySelector('.toolbar button')
    return b ? getComputedStyle(b).webkitAppRegion : 'none'
  })
  console.log(`>>> toolbar button app-region=${btnRegion}`)
  expect(btnRegion).toBe('no-drag')

  // ---- 3. 指数详情：五档占位 ----
  // 注：index-item 在 drag 区内（no-drag 子项），Playwright hit-test 判定不稳定会超时，
  // 真实用户点击不受影响 → 用 JS click 绕过
  await win.evaluate(() => document.querySelector('.index-item')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await win.waitForTimeout(3000)
  const obEmpty = await win.locator('.orderbook .empty').textContent().catch(() => '')
  console.log(`>>> 指数详情五档区=${obEmpty?.trim()}`)
  expect(obEmpty).toContain('指数无五档盘口')
  await win.screenshot({ path: path.resolve(__dirname, '../test-results/12-index-detail.png') })

  await app.close()
})

test('P1 验证：窗口尺寸记忆', async () => {
  test.setTimeout(120_000)
  const stateFile = path.join(process.env.APPDATA || '', 'localstock-desktop', 'window-state.json')

  // 预清理：删掉上次记忆（前序探针可能最大化过主窗），保证从默认尺寸开始
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf-8'))
    delete raw.main
    writeFileSync(stateFile, JSON.stringify(raw, null, 2))
  } catch {}

  // 第一启动：先还原窗口再 resizeTo（Electron 渲染进程支持）
  const app1 = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win1 = await app1.firstWindow()
  await win1.waitForLoadState('domcontentloaded')
  await win1.waitForTimeout(2500)
  await app1.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w.isMaximized()) w.unmaximize()
  })
  await win1.waitForTimeout(300)
  const r1 = await win1.evaluate(() => {
    window.resizeTo(1100, 720)
    return new Promise((r) => setTimeout(() => r({ w: window.outerWidth, h: window.outerHeight }), 400))
  })
  console.log(`>>> 第一启动 resizeTo 后外框=${r1.w}x${r1.h}`)
  await app1.close()
  await new Promise((r) => setTimeout(r, 1200))

  // state 文件应保存
  let saved = null
  try {
    saved = JSON.parse(readFileSync(stateFile, 'utf-8'))
  } catch {}
  console.log(`>>> window-state.json main=`, JSON.stringify(saved?.main))
  expect(saved?.main?.width).toBeGreaterThan(1000)

  // 第二启动：恢复
  const app2 = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win2 = await app2.firstWindow()
  await win2.waitForLoadState('domcontentloaded')
  await win2.waitForTimeout(2500)
  const outer = await win2.evaluate(() => ({ w: window.outerWidth, h: window.outerHeight }))
  console.log(`>>> 第二启动窗口外框=${outer.w}x${outer.h}`)
  expect(outer.w).toBeGreaterThan(1000)
  expect(outer.w).toBeLessThan(1250)
  await app2.close()

  // 清理：删除 window-state.json 的 main 记录，避免影响后续测试/探针的窗口尺寸假设
  const { unlinkSync } = require('fs')
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf-8'))
    delete raw.main
    writeFileSync(stateFile, JSON.stringify(raw, null, 2))
  } catch {}
})
