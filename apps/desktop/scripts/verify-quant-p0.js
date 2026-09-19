// P0 真实联调：桌面端设置页连接聚宽-local，校验日期/因子/API 数量及本机地址保护。
const { _electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const executablePath = process.env.LOCALSTOCK_TEST_EXE
  ? path.resolve(process.env.LOCALSTOCK_TEST_EXE)
  : require('electron')
const packaged = Boolean(process.env.LOCALSTOCK_TEST_EXE)
const SHOT = path.resolve(__dirname, '../test-results/22-ai-quant-service-settings.png')
const AI_SHOT = path.resolve(__dirname, '../test-results/22-ai-quant-status.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localstock-quant-p0-'))
  let app
  try {
    app = await _electron.launch({
      executablePath,
      args: [...(packaged ? [] : [projectRoot]), `--user-data-dir=${profileRoot}`],
      env: { ...process.env, APPDATA: profileRoot, LOCALSTOCK_NO_SINGLETON: '1' }
    })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show())
    await win.getByRole('button', { name: '设置', exact: true }).click()
    const card = win.locator('.quant-settings-card')
    await card.waitFor({ timeout: 10_000 })
    await card.getByRole('button', { name: '检测连接', exact: true }).click()
    await card.getByText('连接正常', { exact: true }).waitFor({ timeout: 30_000 })

    const status = await win.evaluate(() => window.api.quant.testConnection())
    assert(status.connected, `量化服务连接失败：${status.error}`)
    assert(status.factorsCount === 25, `因子数量错误：${status.factorsCount}`)
    assert(status.engineApiCount === 24, `策略 API 数量错误：${status.engineApiCount}`)
    assert(status.dateFrom === '1991-06-01', `最早日期错误：${status.dateFrom}`)

    const remoteBlocked = await win.evaluate(async () => {
      try {
        await window.api.quant.setConfig({ baseUrl: 'http://example.com:3000' })
        return false
      } catch {
        return true
      }
    })
    assert(remoteBlocked, '非本机量化服务地址未被拦截')

    fs.mkdirSync(path.dirname(SHOT), { recursive: true })
    await win.screenshot({ path: SHOT })
    await win.locator('.sidebar-item').filter({ hasText: /^AI$/ }).click()
    const badge = win.locator('.ai-data-status.connected')
    await badge.waitFor({ timeout: 30_000 })
    const badgeText = await badge.textContent()
    assert(badgeText?.includes('25 因子'), `AI 数据状态徽标错误：${badgeText}`)
    await win.screenshot({ path: AI_SHOT })
    console.log(JSON.stringify({ ok: true, status, remoteBlocked, badgeText, screenshots: [SHOT, AI_SHOT] }, null, 2))
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(profileRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
