import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑 *.test.ts 单测，排除 scripts/ 下的 Playwright 视觉测试（*.spec.js）
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node'
  }
})
