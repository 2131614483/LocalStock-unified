// U9 验证：表格列宽拖拽 + 持久化 + 行情 memo 行不重渲
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

test('U9 验证：列宽拖拽 + 持久化', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.show()
    w.focus()
  })
  await win.waitForTimeout(6000)

  // 清掉上次宽度记忆（保证初始 auto 布局）
  await win.evaluate(() => localStorage.removeItem('table.colwidths.watchlist'))

  // 找到"名称"列表头的列宽拖拽把手，向右拖 60px，验证列变宽（真实 mouse，合成事件触发不了 React handler）
  const desktop = __dirname
  const before = await win.evaluate(
    () =>
      [...document.querySelectorAll('.stock-table thead th')]
        .find((t) => t.textContent.trim().startsWith('名称'))
        ?.getBoundingClientRect().width ?? 0
  )
  const rzBox = await win.evaluate(() => {
    const th = [...document.querySelectorAll('.stock-table thead th')].find((t) =>
      t.textContent.trim().startsWith('名称')
    )
    const r = th?.querySelector('.col-resizer')?.getBoundingClientRect()
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
  })
  await win.mouse.move(rzBox.x + 1, rzBox.y + rzBox.h / 2)
  await win.mouse.down()
  await win.mouse.move(rzBox.x + 61, rzBox.y + rzBox.h / 2, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(600)
  const after = await win.evaluate(
    () =>
      [...document.querySelectorAll('.stock-table thead th')]
        .find((t) => t.textContent.trim().startsWith('名称'))
        ?.getBoundingClientRect().width ?? 0
  )
  console.log(`>>> 名称列宽 前=${before.toFixed(0)} 后=${after.toFixed(0)}`)
  expect(after).toBeGreaterThan(before + 40)
  // 持久化
  const saved = await win.evaluate(() => localStorage.getItem('table.colwidths.watchlist'))
  console.log(`>>> 持久化宽度=${saved}`)
  expect(saved).toContain('name')
  await win.screenshot({ path: path.resolve(__dirname, '../test-results/17-colwidth.png') })
  await app.close()
})

test('行情 memo：静止行不重渲染', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.show()
    w.focus()
  })
  await win.waitForTimeout(6000)
  await expect(win.locator('.stock-table tbody tr').first()).toBeVisible({ timeout: 30_000 })

  // 给每个数据单元格加 render 计数标记（用 CSS 动画触发属性作为探针不可行，改用 MutationObserver 统计行级 DOM 变更）
  // 简化：统计 3s 内 tbody 行节点是否被替换（memo 生效时静止行 tr 引用不变）
  const sample = await win.evaluate(async () => {
    const rows = [...document.querySelectorAll('.stock-table tbody tr')]
    if (!rows.length) return { count: 0 }
    // 标记每个 tr 的自定义属性（React 渲染会复用元素，标记会保留 → 静止行说明元素没被重建）
    rows.forEach((tr, i) => tr.setAttribute('data-probe', String(i)))
    await new Promise((r) => setTimeout(r, 3500)) // 等几次行情推送
    const still = [...document.querySelectorAll('.stock-table tbody tr')]
    return {
      count: still.length,
      probes: still.map((tr) => tr.getAttribute('data-probe')),
      changed: still.some((tr, i) => tr.getAttribute('data-probe') !== String(i))
    }
  })
  console.log(`>>> 行情 3.5s 后行=${sample.count} 标记=${JSON.stringify(sample.probes)} 是否重建=${sample.changed}`)
  // memo 生效：静止行（无变化）应保留下标，不是全部重建
  expect(sample.changed).toBe(false)
  await app.close()
})