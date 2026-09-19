// E2E：算法画线 · AI 生成代码（本地 Ollama qwen3.5:9b）
// 链路：写 AI 配置（openai 兼容 → localhost:11434/v1）→ 进详情日K → 开算法面板 → 快捷需求生成 → 验证代码变化 → 运行 → 画线数 +n
const { _electron } = require('playwright')
const path = require('path')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')

async function main() {
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await win.waitForTimeout(5000)

  // 1. 配置 AI 走本地 Ollama（openai 兼容、免 key）
  const cfg = await win.evaluate(() =>
    window.api.ai.setConfig({ provider: 'openai', model: 'qwen3.5:9b', baseUrl: 'http://localhost:11434/v1', apiKey: '' })
  )
  console.log('AI 配置:', cfg.provider, cfg.model, cfg.baseUrl)

  await win.locator('.stock-table tbody tr').first().waitFor({ timeout: 30_000 })
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(5000)
  const secid = await win.evaluate(() => {
    const code = document.querySelector('.detail-name-box .stock-code')?.textContent?.trim()
    return (code?.startsWith('6') ? '1.' : '0.') + code
  })
  console.log('secid:', secid)

  // 2. 切日K + 开算法画线面板
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
  const ui = await win.evaluate(() => ({
    aiBar: !!document.querySelector('.algo-ai-bar'),
    chips: [...document.querySelectorAll('.algo-ai-chip')].length,
    runBtn: !!document.querySelector('.algo-ai-row .btn.primary')
  }))
  console.log('AI 面板 UI:', JSON.stringify(ui))
  await win.screenshot({ path: path.resolve(__dirname, '../test-results/19-ai-panel.png') })

  // 3. 记录代码前状态，点第一个快捷需求（本地 9B 生成较慢，给足超时）
  const codeBefore = await win.evaluate(() => document.querySelector('.drawing-algo-editor')?.value.slice(0, 80))
  console.log('生成前代码头:', JSON.stringify(codeBefore))
  await win.evaluate(() => {
    const chip = document.querySelector('.algo-ai-chip')
    chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  // 轮询等待生成完成（AI busy 消失 + note 出现）
  let gen = null
  for (let i = 0; i < 60; i++) {
    await win.waitForTimeout(2000)
    gen = await win.evaluate(() => ({
      busy: !!document.querySelector('.algo-ai-note:not(.ok)'),
      note: document.querySelector('.algo-ai-note.ok')?.textContent ?? null,
      err: document.querySelector('.algo-ai-bar .backtest-error')?.textContent ?? null
    }))
    if (!gen.busy) break
  }
  console.log('生成结果:', JSON.stringify(gen))

  // 4. 验证代码框被 AI 填充
  const codeAfter = await win.evaluate(() => document.querySelector('.drawing-algo-editor')?.value ?? '')
  console.log('生成后代码长度:', codeAfter.length, '头:', JSON.stringify(codeAfter.slice(0, 100)))
  const changed = codeAfter.length > 50 && !codeAfter.startsWith('# K线画线算法（Python）\n# 环境')
  console.log('代码已被 AI 更新:', changed)

  // 5. 运行上屏（若生成成功）
  if (changed) {
    const before = await win.evaluate((sid) => window.api.drawings.get(sid).then((r) => r.current.length), secid)
    await win.evaluate(() => {
      const run = [...document.querySelectorAll('.drawing-panel .btn')].find((x) => x.textContent.includes('运行'))
      run?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await win.waitForTimeout(10_000)
    const runMsg = await win.evaluate(() => ({
      err: document.querySelector('.drawing-panel > .backtest-error')?.textContent ?? null,
      ok: document.querySelector('.backtest-target-bar')?.textContent ?? null
    }))
    const after = await win.evaluate((sid) => window.api.drawings.get(sid).then((r) => r.current.length), secid)
    console.log('运行结果:', JSON.stringify(runMsg), '画线数', before, '->', after)
    await win.screenshot({ path: path.resolve(__dirname, '../test-results/19-ai-drawn.png') })
  }

  await app.close()
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })