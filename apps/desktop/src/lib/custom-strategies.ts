const SETTINGS_KEY = 'backtest.customStrategies'
const MAX_RECORDS = 100

export interface CustomStrategy {
  id: string
  name: string
  code: string
  createdAt: number
  updatedAt: number
}

function defaultName(code: string): string {
  const first = code.split('\n').find((line) => line.trim())?.trim()
  const meaningful = first?.startsWith('#') ? first.slice(1).trim() : first
  return meaningful?.slice(0, 48) || '未命名策略'
}

function makeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalize(value: unknown): CustomStrategy[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CustomStrategy[] => {
    if (!item || typeof item !== 'object') return []
    const strategy = item as Partial<CustomStrategy>
    if (typeof strategy.id !== 'string' || typeof strategy.code !== 'string') return []
    const createdAt = Number.isFinite(strategy.createdAt) ? strategy.createdAt! : Date.now()
    const updatedAt = Number.isFinite(strategy.updatedAt) ? strategy.updatedAt! : createdAt
    return [{
      id: strategy.id,
      name: typeof strategy.name === 'string' && strategy.name.trim()
        ? strategy.name.trim()
        : defaultName(strategy.code),
      code: strategy.code,
      createdAt,
      updatedAt
    }]
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECORDS)
}

async function list(): Promise<CustomStrategy[]> {
  const saved = await window.api.settings.get(SETTINGS_KEY)
  if (!saved) return []
  try {
    return normalize(JSON.parse(saved))
  } catch {
    return []
  }
}

async function save(strategies: CustomStrategy[]): Promise<CustomStrategy[]> {
  const normalized = normalize(strategies)
  await window.api.settings.set(SETTINGS_KEY, JSON.stringify(normalized))
  return normalized
}

/** 用户创建的命名策略：与编辑历史分开保存，可长期作为模板复用。 */
export const customStrategyManager = {
  list,

  async create(name: string, code: string): Promise<CustomStrategy> {
    const strategy: CustomStrategy = {
      id: makeId(),
      name: name.trim() || defaultName(code),
      code,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await save([strategy, ...await list()])
    return strategy
  },

  async update(id: string, patch: Pick<CustomStrategy, 'name' | 'code'>): Promise<CustomStrategy | null> {
    const strategies = await list()
    const current = strategies.find((strategy) => strategy.id === id)
    if (!current) return null
    const updated: CustomStrategy = {
      ...current,
      name: patch.name.trim() || defaultName(patch.code),
      code: patch.code,
      updatedAt: Date.now()
    }
    await save(strategies.map((strategy) => strategy.id === id ? updated : strategy))
    return updated
  },

  async remove(id: string): Promise<void> {
    await save((await list()).filter((strategy) => strategy.id !== id))
  }
}

