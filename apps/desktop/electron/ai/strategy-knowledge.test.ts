import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const mocks = vi.hoisted(() => ({ path: '' }))
vi.mock('../db', () => ({ getSetting: () => mocks.path }))

import {
  getStrategyKnowledgeStatus,
  readStrategyKnowledge,
  searchStrategyKnowledge
} from './strategy-knowledge'

describe('策略知识库', () => {
  beforeEach(async () => {
    mocks.path = await mkdtemp(join(tmpdir(), 'strategy-kb-'))
    await mkdir(join(mocks.path, '2024年度精选策略'))
    await writeFile(join(mocks.path, '2024年度精选策略', 'RSRS择时策略.txt'), '使用 RSRS 指标判断市场趋势\n示例策略代码')
    await writeFile(join(mocks.path, '价值投资.py'), '# 低估值与 ROE 多因子策略')
  })

  afterEach(async () => {
    await rm(mocks.path, { recursive: true, force: true })
  })

  it('统计策略文件和年份', async () => {
    const status = await getStrategyKnowledgeStatus() as { files: number; years: Record<string, number> }
    expect(status.files).toBe(2)
    expect(status.years['2024']).toBe(1)
  })

  it('搜索标题和正文并读取原文', async () => {
    const found = await searchStrategyKnowledge('RSRS') as { total: number; results: Array<{ path: string }> }
    expect(found.total).toBe(1)
    const doc = await readStrategyKnowledge(found.results[0].path, 0, 1000) as { content: string }
    expect(doc.content).toContain('市场趋势')
    const body = await searchStrategyKnowledge('ROE') as { total: number }
    expect(body.total).toBe(1)
  })

  it('阻止越过知识库目录读取文件', async () => {
    await expect(readStrategyKnowledge('..\\outside.txt')).rejects.toThrow()
  })
})
