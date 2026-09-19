import { create } from 'zustand'
import type {
  PaAnalysisMode,
  PaAnalysisRecord,
  PaKlineResult,
  PaServerStatus,
  PaServiceConfig,
  PaServiceStatus,
  PaStreamEvent,
  PaTimeframe
} from '../../shared/types'

/** 分析阶段（用于界面进度提示） */
export type PaPhase =
  | 'idle'
  | 'preparing'
  | 'stage1'
  | 'stage2'
  | 'done'
  | 'error'
  | 'cancelled'

const PHASE_LABEL: Record<PaPhase, string> = {
  idle: '待命',
  preparing: '准备数据',
  stage1: '阶段一 · 市场诊断',
  stage2: '阶段二 · 交易决策',
  done: '已完成',
  error: '失败',
  cancelled: '已取消'
}

export const paPhaseLabel = (phase: PaPhase): string => PHASE_LABEL[phase] ?? phase

/** 阶段事件名 → 阶段（服务端 OrchestratorEvent 的名称） */
function phaseForEvent(event: string): PaPhase | null {
  if (event.startsWith('Stage1')) return 'stage1'
  if (event.startsWith('Stage2')) return 'stage2'
  if (event === 'Cancelled') return 'cancelled'
  if (event === 'InsufficientData' || event.endsWith('Failed')) return 'error'
  return null
}

/** IPC 调用失败时 Electron 会加一层包装，去掉它只留可读信息 */
function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

interface PaState {
  // 配置
  config: PaServiceConfig | null
  status: PaServiceStatus | null
  /** 托管服务进程状态（启动中/就绪/依赖缺失/错误） */
  server: PaServerStatus | null
  installing: boolean
  installMsg: string
  installError: string | null

  // 分析参数
  symbol: string
  symbolName: string
  timeframe: PaTimeframe
  barCount: number
  analysisMode: PaAnalysisMode

  // 行情
  kline: PaKlineResult | null
  klineLoading: boolean

  // 运行状态
  running: boolean
  jobId: string | null
  phase: PaPhase
  stage1Reasoning: string
  stage1Content: string
  stage2Reasoning: string
  stage2Content: string
  record: PaAnalysisRecord | null
  error: string | null
  promptText: string
  strategyFiles: string[]
  startedAt: number | null
  finishedAt: number | null

  setSymbol(symbol: string, name?: string): void
  setTimeframe(tf: PaTimeframe): void
  setBarCount(n: number): void
  setAnalysisMode(mode: PaAnalysisMode): void
  setImportedKline(bars: PaKlineResult['bars'], name?: string): void

  loadConfig(): Promise<void>
  saveConfig(patch: Partial<PaServiceConfig>): Promise<void>
  testConnection(): Promise<void>

  /** 订阅托管服务状态（组件卸载时取消） */
  watchServer(): () => void
  restartServer(): Promise<void>
  installDeps(): Promise<void>

  loadKline(): Promise<void>
  analyze(): Promise<void>
  cancel(): Promise<void>
  /** 导入离线模型回复：支持 Markdown 围栏、前后说明文字及阶段一/二 JSON。 */
  importJson(text: string): { ok: boolean; error?: string }
  reset(): void
}

let unsubscribe: (() => void) | null = null

export const usePa = create<PaState>((set, get) => ({
  config: null,
  status: null,
  server: null,
  installing: false,
  installMsg: '',
  installError: null,

  symbol: '600519',
  symbolName: '',
  timeframe: '1d',
  barCount: 100,
  analysisMode: 'original',

  kline: null,
  klineLoading: false,

  running: false,
  jobId: null,
  phase: 'idle',
  stage1Reasoning: '',
  stage1Content: '',
  stage2Reasoning: '',
  stage2Content: '',
  record: null,
  error: null,
  promptText: '',
  strategyFiles: [],
  startedAt: null,
  finishedAt: null,

  setSymbol: (symbol, name) => {
    set({ symbol, symbolName: name ?? '' })
  },
  setTimeframe: (timeframe) => set({ timeframe }),
  setBarCount: (barCount) => set({ barCount: Math.max(30, Math.min(500, barCount || 100)) }),
  setAnalysisMode: (analysisMode) => set({ analysisMode }),
  setImportedKline: (bars, name) => {
    const { symbol, timeframe } = get()
    if (bars.length) set({ kline: { symbol, name: name ?? symbol, timeframe, bars } })
  },

  loadConfig: async () => {
    try {
      const config = await window.api.pa.getConfig()
      set({ config })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  saveConfig: async (patch) => {
    try {
      const config = await window.api.pa.setConfig(patch)
      set({ config, error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  testConnection: async () => {
    const status = await window.api.pa.testConnection()
    set({ status })
  },

  watchServer: () => {
    // 立即取一次当前状态，再订阅后续推送
    void window.api.pa.getServerStatus().then((server) => {
      set({ server })
      if (server.state === 'ready') {
        void get().testConnection()
        void get().loadKline()
      }
    })
    const offStatus = window.api.pa.onServerStatus((server) => {
      const wasReady = get().server?.state === 'ready'
      set({ server })
      // 就绪后拉一次健康详情（股票数、库路径）
      if (server.state === 'ready') {
        void get().testConnection()
        // 服务从「未就绪」变为就绪时，补拉之前被跳过的那次行情
        if (!wasReady) void get().loadKline()
      }
    })
    const offDeps = window.api.pa.onDepsProgress((evt) => {
      // 首次运行由主进程自动触发安装，这里同样要反映"安装中"状态
      if (evt.type === 'error') {
        set({ installError: evt.message ?? '安装失败', installing: false })
      } else if (evt.type === 'done') {
        set({ installMsg: `环境就绪（Python ${evt.version ?? ''}）`, installing: false })
      } else {
        set({ installMsg: evt.message ?? '', installing: true })
      }
    })
    return () => {
      offStatus()
      offDeps()
    }
  },

  restartServer: async () => {
    set({ installError: null, installMsg: '正在重启服务…' })
    const server = await window.api.pa.restartServer()
    set({ server, installMsg: '' })
    if (server.state === 'ready') void get().testConnection()
  },

  installDeps: async () => {
    set({ installing: true, installError: null, installMsg: '正在准备…' })
    try {
      const res = await window.api.pa.installDeps()
      if (!res.ok) set({ installError: res.error ?? '安装失败' })
      else set({ installMsg: '安装完成' })
    } catch (error) {
      set({ installError: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ installing: false })
    }
  },

  loadKline: async () => {
    const { symbol, timeframe, barCount, server } = get()
    if (!symbol) return
    // 服务状态未知或未就绪时静默跳过：横幅已在说明原因，
    // 这里再抛一遍只会是重复噪音。就绪后 watchServer 会补拉一次。
    if (server?.state !== 'ready') return
    set({ klineLoading: true })
    try {
      const kline = await window.api.pa.getKline(symbol, timeframe, Math.max(barCount + 20, 120))
      set({ kline, klineLoading: false, error: null })
    } catch (error) {
      set({ klineLoading: false, error: cleanError(error) })
    }
  },

  analyze: async () => {
    const { symbol, timeframe, barCount, analysisMode, running } = get()
    if (running) return
    if (!symbol.trim()) {
      set({ error: '请先选择股票' })
      return
    }

    // 每次分析前刷新一次订阅，避免 StrictMode 双挂载后漏事件
    if (unsubscribe) unsubscribe()
    unsubscribe = window.api.pa.onEvent((evt) => handleEvent(evt, set, get))

    set({
      running: true,
      phase: 'preparing',
      stage1Reasoning: '',
      stage1Content: '',
      stage2Reasoning: '',
      stage2Content: '',
      record: null,
      error: null,
      promptText: '',
      strategyFiles: [],
      jobId: null,
      startedAt: Date.now(),
      finishedAt: null
    })

    const res = await window.api.pa.analyze({ symbol, timeframe, barCount, analysisMode })
    if (!res.ok) {
      set({ running: false, phase: 'error', error: res.error ?? '提交分析失败' })
    }
    // 行情同步刷新，保证图上 K 线与分析所用一致
    void get().loadKline()
  },

  cancel: async () => {
    await window.api.pa.cancel()
    set({ running: false, phase: 'cancelled', finishedAt: Date.now() })
  },

  importJson: (text) => {
    try {
      const blocks = extractJsonObjects(text)
      if (!blocks.length) throw new Error('未找到可解析的 JSON 对象')
      let stage1: Record<string, unknown> | null = null
      let stage2: Record<string, unknown> | null = null
      for (const block of blocks) {
        const wrapped1 = asObject(block.stage1_diagnosis ?? block.stage1 ?? block.diagnosis)
        const wrapped2 = asObject(block.stage2_decision ?? block.stage2)
        if (wrapped1) stage1 = wrapped1
        if (wrapped2) stage2 = wrapped2
        if (!stage2 && asObject(block.decision)) stage2 = block
        if (!stage1 && isDiagnosis(block)) stage1 = block
      }
      if (!stage1 && !stage2) throw new Error('JSON 中未识别到阶段一诊断或阶段二交易决策')
      const current = get()
      const record: PaAnalysisRecord = {
        meta: { timestamp_local_iso: new Date().toISOString(), symbol: current.symbol, timeframe: current.timeframe },
        stage1_diagnosis: stage1 ?? undefined,
        stage2_decision: stage2 as PaAnalysisRecord['stage2_decision']
      }
      set({
        record,
        stage1Content: stage1 ? JSON.stringify(stage1, null, 2) : '',
        stage2Content: stage2 ? JSON.stringify(stage2, null, 2) : '',
        running: false,
        phase: 'done',
        error: null,
        finishedAt: Date.now()
      })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: `导入结果失败：${message}` })
      return { ok: false, error: message }
    }
  },

  reset: () => {
    set({
      running: false,
      jobId: null,
      phase: 'idle',
      stage1Reasoning: '',
      stage1Content: '',
      stage2Reasoning: '',
      stage2Content: '',
      record: null,
      error: null,
      promptText: '',
      strategyFiles: [],
      startedAt: null,
      finishedAt: null
    })
  }
}))

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isDiagnosis(value: Record<string, unknown>): boolean {
  return ['cycle_position', 'market_phase', 'detected_patterns', 'strategy_files_needed'].some((key) => key in value)
}

/** 从 ```json 围栏、带解释的回复中提取所有完整对象；不依赖模型输出格式完全规范。 */
function extractJsonObjects(text: string): Record<string, unknown>[] {
  const candidates = text.match(/```(?:json)?\s*([\s\S]*?)```/gi)?.map((part) => part.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')) ?? [text]
  const output: Record<string, unknown>[] = []
  for (const candidate of candidates) {
    let start = -1
    let depth = 0
    let quote = false
    let escaped = false
    for (let i = 0; i < candidate.length; i++) {
      const char = candidate[i]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quote = false
        continue
      }
      if (char === '"') { quote = true; continue }
      if (char === '{') { if (depth++ === 0) start = i }
      if (char === '}' && depth && --depth === 0 && start >= 0) {
        try {
          const parsed = JSON.parse(candidate.slice(start, i + 1))
          const object = asObject(parsed)
          if (object) output.push(object)
        } catch { /* 继续找后续完整 JSON 块 */ }
        start = -1
      }
    }
  }
  return output
}

function handleEvent(
  evt: PaStreamEvent,
  set: (partial: Partial<PaState>) => void,
  get: () => PaState
): void {
  switch (evt.type) {
    case 'started':
      set({ jobId: evt.jobId })
      break
    case 'frame_ready':
      set({ phase: 'stage1', symbolName: evt.name || get().symbolName })
      break
    case 'stage_event': {
      const next = phaseForEvent(evt.event)
      if (next) set({ phase: next })
      break
    }
    case 'stage1_reasoning':
      set({ stage1Reasoning: get().stage1Reasoning + evt.text })
      break
    case 'stage1_content':
      set({ stage1Content: get().stage1Content + evt.text })
      break
    case 'stage2_reasoning':
      set({ stage2Reasoning: get().stage2Reasoning + evt.text })
      break
    case 'stage2_content':
      set({ stage2Content: get().stage2Content + evt.text })
      break
    case 'prompt':
      set({ promptText: evt.text })
      break
    case 'stage2_files':
      set({ strategyFiles: evt.files })
      break
    case 'done':
      set({
        record: evt.record,
        running: false,
        phase: evt.record?.exception ? 'error' : 'done',
        finishedAt: Date.now(),
        error: evt.record?.exception?.message ?? null
      })
      break
    case 'error':
      set({
        running: false,
        phase: 'error',
        error: evt.errorType ? `${evt.message}` : evt.message,
        finishedAt: Date.now()
      })
      break
    case 'closed':
      if (get().running) set({ running: false, finishedAt: Date.now() })
      break
    default:
      break
  }
}
