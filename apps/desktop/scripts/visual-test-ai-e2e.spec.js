// 真实 LLM 端到端（Phase 5）：需 DeepSeek API Key（环境变量 LOCALSTOCK_DS_KEY）
// 验证：只读问答 → 工具调用；AI 写画线 → 审计 → 回滚
// 运行: cd desktop && LOCALSTOCK_DS_KEY=sk-xxx npx playwright test scripts/visual-test-ai-e2e.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')
const KEY = process.env.LOCALSTOCK_DS_KEY
const MODEL = process.env.LOCALSTOCK_DS_MODEL || 'deepseek-v4-flash'
const BASE = process.env.LOCALSTOCK_DS_BASE || 'https://api.deepseek.com/v1'

test.beforeAll(() => {
  if (!KEY) throw new Error('缺少 LOCALSTOCK_DS_KEY 环境变量')
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

async function configureAi(win) {
  await win.evaluate(
    ({ key, model, base }) =>
      window.api.ai.setConfig({ provider: 'openai', apiKey: key, model, baseUrl: base, writeMode: 'auto' }),
    { key: KEY, model: MODEL, base: BASE }
  )
}

/** 等待一条 AI 消息流式完成（发送按钮恢复「发送」且最后一条 assistant 非空） */
async function waitAiDone(win, timeout = 180_000) {
  await win.waitForFunction(
    () => {
      const sendBtn = document.querySelector('.ai-input-bar .btn.primary')
      const texts = [...document.querySelectorAll('.ai-msg-assistant .ai-msg-text')]
      const last = texts[texts.length - 1]
      const err = document.querySelector('.ai-msg-error')
      return !!err || (!!sendBtn && !!last && last.textContent.trim().length > 0)
    },
    { timeout }
  )
  const err = await win.locator('.ai-msg-error').first().textContent().catch(() => null)
  return err || null
}

test('真实 LLM：只读问答 + 工具调用', async () => {
  test.setTimeout(240_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)
  await configureAi(win)

  await win.locator('.ai-toggle[title="AI 助手"]').click()
  await expect(win.locator('.ai-panel')).toBeVisible()
  await win.locator('.ai-input').fill(
    '请调用工具查询贵州茅台（secid 1.600519）的现价，并查看近一年日K的走势特征，然后用一两句话回答。'
  )
  await win.locator('.ai-send').click()
  const err = await waitAiDone(win)
  expect(err, `AI 报错：${err}`).toBeNull()

  const reply = await win.locator('.ai-msg-assistant .ai-msg-text').last().textContent()
  console.log('>>> AI 回复:', reply)
  expect(reply.length).toBeGreaterThan(5)
  const tools = await win.locator('.ai-tool-name').allTextContents()
  console.log('>>> 调用工具:', tools.join(','))
  expect(tools.some((n) => ['get_quotes', 'get_kline', 'get_orderbook'].includes(n))).toBe(true)
  await win.screenshot({ path: path.join(SHOTS_DIR, '20-e2e-read.png') })

  await app.close()
})

test('真实 LLM：AI 画线写入 + 审计 + 回滚', async () => {
  test.setTimeout(300_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const startTs = Date.now()
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)
  await configureAi(win)

  // 进第一只自选股详情，清空其画线保证确定性
  await win.locator('.stock-table tbody tr').first().click()
  await win.waitForTimeout(4000)
  const code = (await win.locator('.detail-name-box .stock-code').textContent()).trim()
  const secid = (code.startsWith('6') ? '1.' : '0.') + code
  console.log('>>> 目标股票:', secid)
  await win.evaluate(async (sid) => window.api.drawings.clear(sid), secid)

  // 打开 AI 面板，让 AI 用 draw_lines 画最近 60 日支撑压力水平线
  await win.locator('.ai-toggle[title="AI 助手"]').click()
  await win.locator('.ai-input').fill(
    `请用 draw_lines 工具给股票 ${secid} 画出两条水平线：最近 60 日最高价压力线（颜色 #f5222d，label 压力）和最低价支撑线（颜色 #14b143，label 支撑）。请先调用 get_kline 获取数据，再用 draw_lines 保存。`
  )
  await win.locator('.ai-send').click()
  const err = await waitAiDone(win, 240_000)
  expect(err, `AI 报错：${err}`).toBeNull()

  // 验证画线已写入
  const count = await win.evaluate(
    async (sid) => (await window.api.drawings.get(sid)).current.length,
    secid
  )
  console.log('>>> 画线后数量:', count)
  expect(count).toBeGreaterThan(0)

  // 验证审计有画线写操作（只统计本次运行已应用、未回滚的）
  const audit = await win.evaluate(() => window.api.ai.getAudit())
  const drawEntries = audit.filter(
    (a) =>
      ['draw_lines', 'run_draw_algo', 'clear_drawings'].includes(a.tool) &&
      a.status === 'applied' &&
      a.ts > startTs
  )
  console.log('>>> 画线审计(applied):', drawEntries.map((a) => `${a.tool}:${a.status}`).join(', '))
  expect(drawEntries.length).toBeGreaterThan(0)
  await win.screenshot({ path: path.join(SHOTS_DIR, '21-e2e-draw-audit.png') })

  // 回滚本次运行的全部画线写操作 → 恢复清空状态
  for (const e of drawEntries) {
    const r = await win.evaluate((id) => window.api.ai.rollback(id), e.id)
    console.log('>>> 回滚', e.tool, e.id, r)
    expect(r.ok).toBe(true)
  }
  const after = await win.evaluate(
    async (sid) => (await window.api.drawings.get(sid)).current.length,
    secid
  )
  console.log('>>> 回滚后数量:', after)
  expect(after).toBe(0)

  await app.close()
})
