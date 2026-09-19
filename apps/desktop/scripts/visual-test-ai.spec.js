// 视觉测试：AI 助手面板（Phase 1）
// 验证：面板开关渲染、配置弹层、未配置 API Key 时发送消息的错误提示、ai:getConfig IPC
// 运行: cd desktop && npx playwright test scripts/visual-test-ai.spec.js --reporter=list
const { _electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe')
const SHOTS_DIR = path.resolve(__dirname, '../test-results')

test.beforeAll(() => fs.mkdirSync(SHOTS_DIR, { recursive: true }))

test('AI 助手面板：开关/配置/未配置时的错误提示', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 1. 工具栏 AI 开关可见 → 打开面板（title 精确匹配，监盘按钮也是 .ai-toggle）
  await expect(win.locator('.ai-toggle[title="AI 助手"]')).toBeVisible()
  await win.locator('.ai-toggle[title="AI 助手"]').click()
  await expect(win.locator('.ai-panel')).toBeVisible()
  await expect(win.locator('.ai-empty')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '11-ai-panel.png') })

  // 2. ai:getConfig IPC 返回有效配置（已持久化的后端可能是 openai/DeepSeek，不断言默认值）
  const cfg = await win.evaluate(() => window.api.ai.getConfig())
  expect(['anthropic', 'openai']).toContain(cfg.provider)
  expect(typeof cfg.model).toBe('string')

  // 3. 打开配置弹层可见（不改变持久化配置，避免干扰用户已配好的 DeepSeek）
  await win.locator('.ai-gear[title="AI 设置"]').click()
  await expect(win.locator('.ai-config')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '12-ai-config.png') })
  await win.locator('.ai-gear[title="AI 设置"]').click() // 收起
  await expect(win.locator('.ai-config')).toHaveCount(0)

  // 4. 发送消息：已配置 key → 真实回复；未配置 → 显示配置错误（不崩溃、不卡住）
  await win.locator('.ai-input').fill('请只回复两个字：收到')
  await win.locator('.ai-send').click()
  if (!cfg.apiKey) {
    await expect(win.locator('.ai-msg-error')).toBeVisible({ timeout: 10_000 })
    const errText = (await win.locator('.ai-msg-error').textContent()) || ''
    expect(errText).toContain('API Key')
    await win.screenshot({ path: path.join(SHOTS_DIR, '13-ai-error.png') })
  } else {
    await win.waitForFunction(
      () => {
        const sendBtn = document.querySelector('.ai-input-bar .btn.primary')
        const texts = [...document.querySelectorAll('.ai-msg-assistant .ai-msg-text')]
        const last = texts[texts.length - 1]
        return !!sendBtn && !!last && last.textContent.trim().length > 0
      },
      { timeout: 120_000 }
    )
    const reply = await win.locator('.ai-msg-assistant .ai-msg-text').last().textContent()
    console.log('>>> AI 面板回复:', reply)
    expect(reply.length).toBeGreaterThan(0)
    await win.screenshot({ path: path.join(SHOTS_DIR, '13-ai-reply.png') })
  }

  // 5. 发送按钮在运行中禁用的前置状态恢复（running=false 后 input 可继续输入）
  await win.locator('.ai-input').fill('你好')
  await expect(win.locator('.ai-send')).toBeVisible()

  await app.close()
})

test('独立 AI 页（侧边栏 AI）渲染', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({ executablePath: APP_EXE })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 精确匹配 AI 项，避免与「自选股」等冲突
  await win.locator('.sidebar-item span:not(.icon)', { hasText: /^AI$/ }).click()
  await expect(win.locator('.ai-page')).toBeVisible()
  await expect(win.locator('.ai-empty')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '18-ai-page.png') })

  // 独立页也能打开配置
  await win.locator('.ai-page .ai-gear[title="AI 设置"]').click()
  await expect(win.locator('.ai-page .ai-config')).toBeVisible()
  await win.screenshot({ path: path.join(SHOTS_DIR, '19-ai-page-config.png') })

  await app.close()
})
