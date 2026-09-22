const SETTINGS_KEY = 'backtest.strategyHistory'
const LEGACY_STORAGE_KEY = 'localstock.backtest.code-history'
const MAX_RECORDS = 100

export interface StrategyHistoryRecord {
  id: string
  name: string
  code: string
  createdAt: number
  updatedAt: number
}

type LegacyRecord = { code?: unknown; ts?: unknown }

function defaultName(code: string): string {
  const first = code.split('\n').find((line) => line.trim())?.trim()
  const meaningful = first?.startsWith('#') ? first.slice(1).trim() : first
  return (meaningful?.slice(0, 48) || '未命名策略')
}

function makeId(): string {
  return `strategy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalize(value: unknown): StrategyHistoryRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): StrategyHistoryRecord[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Partial<StrategyHistoryRecord>
    if (typeof record.id !== 'string' || typeof record.code !== 'string') return []
    const createdAt = Number.isFinite(record.createdAt) ? record.createdAt! : Date.now()
    const updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt! : createdAt
    return [{
      id: record.id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : defaultName(record.code),
      code: record.code,
      createdAt,
      updatedAt
    }]
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECORDS)
}

async function save(records: StrategyHistoryRecord[]): Promise<StrategyHistoryRecord[]> {
  const normalized = normalize(records)
  await window.api.settings.set(SETTINGS_KEY, JSON.stringify(normalized))
  return normalized
}

/**
 * 回测策略历史的单一读写入口。记录保存到桌面端 settings，重启和刷新后仍可管理。
 */
export const strategyHistoryManager = {
  async list(): Promise<StrategyHistoryRecord[]> {
    const saved = await window.api.settings.get(SETTINGS_KEY)
    if (saved) {
      try {
        return normalize(JSON.parse(saved))
      } catch {
        return []
      }
    }

    // 把旧版下拉菜单中的本地记录无损迁移到新的持久管理器。
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]') as LegacyRecord[]
      const migrated = legacy.flatMap((item, index): StrategyHistoryRecord[] => {
        if (typeof item.code !== 'string' || !item.code.trim()) return []
        const timestamp = typeof item.ts === 'number' && Number.isFinite(item.ts)
          ? item.ts
          : Date.now() - index
        return [{
          id: `legacy-${timestamp}-${index}`,
          name: defaultName(item.code),
          code: item.code,
          createdAt: timestamp,
          updatedAt: timestamp
        }]
      })
      return migrated.length ? save(migrated) : []
    } catch {
      return []
    }
  },

  async create(name: string, code: string): Promise<StrategyHistoryRecord> {
    const record: StrategyHistoryRecord = {
      id: makeId(),
      name: name.trim() || defaultName(code),
      code,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await save([record, ...await this.list()])
    return record
  },

  async capture(code: string): Promise<StrategyHistoryRecord | null> {
    if (!code.trim()) return null
    const records = await this.list()
    const existing = records.find((record) => record.code === code)
    if (existing) return existing
    const record: StrategyHistoryRecord = {
      id: makeId(),
      name: defaultName(code),
      code,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await save([record, ...records])
    return record
  },

  async update(id: string, patch: Pick<StrategyHistoryRecord, 'name' | 'code'>): Promise<StrategyHistoryRecord | null> {
    const records = await this.list()
    const current = records.find((record) => record.id === id)
    if (!current) return null
    const updated: StrategyHistoryRecord = {
      ...current,
      name: patch.name.trim() || defaultName(patch.code),
      code: patch.code,
      updatedAt: Date.now()
    }
    await save(records.map((record) => record.id === id ? updated : record))
    return updated
  },

  async remove(id: string): Promise<void> {
    await save((await this.list()).filter((record) => record.id !== id))
  }
}
