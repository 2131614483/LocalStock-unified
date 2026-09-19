// 主进程与渲染进程共享的数据结构

export interface Quote {
  secid: string // "1.600519"（市场.代码）
  code: string // "600519"
  name: string // "贵州茅台"
  price: number // 现价
  change: number // 涨跌额
  changePercent: number // 涨跌幅 %
  open: number // 今开
  high: number // 最高
  low: number // 最低
  preClose: number // 昨收
  volume: number // 成交量（手）
  amount: number // 成交额（元）
  amplitude?: number // 振幅 %
  turnoverRate?: number // 换手率 %
  pe?: number // 市盈率（动）
  pb?: number // 市净率
  volumeRatio?: number // 量比
  totalMv?: number // 总市值（元）
  floatMv?: number // 流通市值（元）
  industry?: string // 所属行业
  limitUp?: number // 涨停价（腾讯数据）
  limitDown?: number // 跌停价（腾讯数据）
  isIndex?: boolean // 是否为指数
  time?: string // 数据时间（腾讯）
}

export interface KlinePoint {
  time: string // "2026-01-05" 或 "2026-08-10 09:30"
  open: number
  close: number
  high: number
  low: number
  volume: number // 手
  amount: number // 元
}

export interface KlineResult {
  secid: string
  name: string
  preClose?: number
  points: KlinePoint[]
  /** 数据是否来自过期缓存/旧本地回退（真实时数据不带此字段或为 false） */
  stale?: boolean
}

export interface MinutePoint {
  time: string // "09:30"；多日分时为 "MM-DD HH:MM"
  price: number // 现价
  avg: number // 均价
  high: number
  low: number
  volume: number // 手
  amount: number // 元
  /** 该分时点所在交易日的昨收（多日分时逐日不同；缺省用 MinuteResult.preClose） */
  preClose?: number
}

export interface MinuteResult {
  secid: string
  name: string
  preClose: number
  /** 分时对应交易日（YYYY-MM-DD） */
  date?: string
  points: MinutePoint[]
  /** 数据是否来自过期缓存（真实时数据不带此字段或为 false） */
  stale?: boolean
}

export interface OrderLevel {
  price: number
  volume: number // 手
}

export interface OrderBook {
  secid: string
  name: string
  price: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  preClose: number
  volume: number // 手
  amount: number // 元
  turnoverRate?: number
  pe?: number
  pb?: number
  amplitude?: number
  volumeRatio?: number
  totalMv?: number
  floatMv?: number
  limitUp?: number
  limitDown?: number
  bid: OrderLevel[] // 买一~买五
  ask: OrderLevel[] // 卖一~卖五
  time: string
}

export interface SearchResult {
  code: string
  name: string
  pinyin: string
  secid: string
  type: string // "沪A" / "深A" 等
}

export interface WatchItem {
  secid: string
  code: string
  name: string
}

export interface StockNewsItem {
  id: string
  title: string
  content: string
  publishedAt: string
  source: string
  url: string
}

export interface NewsAnalysis {
  summary: string
  timeline: Array<{ date: string; event: string; impact: string }>
  risks: string[]
}

export interface MarketListParams {
  pn: number // 页码（从 1 开始）
  pz: number // 每页数量
  fid: string // 排序字段，如 f3 涨跌幅 f6 成交额 f12 代码
  order: 'asc' | 'desc'
}

export interface MarketListResult {
  total: number
  list: Quote[]
}

// K线周期（东财 klt 兼容；分钟线用新浪 scale，120 由 60 聚合）
export const KLT = {
  MIN1: 1,
  MIN5: 5,
  MIN15: 15,
  MIN30: 30,
  MIN60: 60,
  MIN120: 120,
  DAY: 101,
  WEEK: 102,
  MONTH: 103,
  QUARTER: 104
} as const

// 复权方式（东财 fqt）：0 不复权，1 前复权，2 后复权
export const FQT = {
  NONE: 0,
  QIAN: 1,
  HOU: 2
} as const

/** 顶部指数栏固定的指数 secid（上证/深成/创业板/沪深300/科创50） */
export const INDEX_SECIDS = ['1.000001', '0.399001', '0.399006', '1.000300', '1.000688']

// 渲染进程通过 window.api 访问主进程能力（preload contextBridge 暴露）
export interface WindowApi {  market: {
    getQuotes(secids: string[]): Promise<Quote[]>
    getMarketList(params: MarketListParams): Promise<MarketListResult>
    getKline(secid: string, klt: number, fqt: number): Promise<KlineResult>
    getMinute(secid: string, days?: number): Promise<MinuteResult>
    getOrderBook(secid: string): Promise<OrderBook | null>
    search(keyword: string): Promise<SearchResult[]>
    subscribe(secids: string[], interval: number): Promise<{ ok: boolean }>
    onQuotes(cb: (quotes: Quote[]) => void): () => void
  }
  news: {
    list(secid: string, name: string, limit?: number): Promise<{ items: StockNewsItem[]; cached: boolean }>
    range(secid: string, name: string, start: string, end: string): Promise<{ items: StockNewsItem[]; cached: boolean }>
    analyze(secid: string, name: string, start: string, end: string, items: StockNewsItem[]): Promise<{ ok: boolean; analysis?: NewsAnalysis; error?: string }>
  }
  watchlist: {
    list(): Promise<WatchItem[]>
    add(item: WatchItem): Promise<void>
    remove(secid: string): Promise<void>
    reorder(secids: string[]): Promise<void>
  }
  settings: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
  quant: {
    getConfig(): Promise<QuantServiceConfig>
    setConfig(cfg: Partial<QuantServiceConfig>): Promise<QuantServiceConfig>
    testConnection(refresh?: boolean): Promise<QuantServiceStatus>
  }
  marketDb: {
    /** 当前生效的行情库路径、来源与校验结果 */
    getInfo(): Promise<MarketDbInfo>
    /** 校验指定文件（不保存），用于选定前预览 */
    inspect(path: string): Promise<MarketDbInfo>
    /** 弹系统文件选择框；取消返回 null */
    pick(): Promise<{ path: string; info: MarketDbInfo } | null>
    /** 保存并立即生效（传 null 恢复默认解析顺序） */
    setPath(path: string | null): Promise<MarketDbInfo>
    reset(): Promise<MarketDbInfo>
  }
  pa: {
    /** 配置（enabled / 手工覆盖地址 / 超时） */
    getConfig(): Promise<PaServiceConfig>
    setConfig(cfg: Partial<PaServiceConfig>): Promise<PaServiceConfig>
    /** 托管服务的进程状态（含最近日志），界面据此提示与恢复 */
    getServerStatus(): Promise<PaServerStatus>
    /** 手动重启托管服务（会重置依赖探测） */
    restartServer(): Promise<PaServerStatus>
    /** 创建独立 venv 并安装依赖（首次使用或依赖缺失时） */
    installDeps(): Promise<{ ok: boolean; error?: string }>
    onDepsProgress(cb: (evt: PaDepsProgressEvent) => void): () => void
    onServerStatus(cb: (status: PaServerStatus) => void): () => void
    testConnection(): Promise<PaServiceStatus>
    searchSymbols(keyword: string, limit?: number): Promise<PaSymbol[]>
    getKline(symbol: string, timeframe: PaTimeframe, bars: number): Promise<PaKlineResult>
    /** 导出无需 API Key 的两阶段本地 TXT 分析包 */
    exportOffline(req: PaOfflineExportRequest): Promise<PaOfflineExportResult>
    readClipboardText(): Promise<string>
    pickImportText(): Promise<{ path: string; text: string } | null>
    pickOfflinePack(): Promise<{ path: string; text: string } | null>
    latestOfflinePack(): Promise<{ path: string; text: string } | null>
    archiveImportedRecord(record: PaAnalysisRecord): Promise<string>
    /** 两套随程序分发、彼此独立的策略知识库清单 */
    listKnowledgeLibraries(): Promise<PaKnowledgeLibrary[]>
    /** 提交价格行为分析；结果通过 onEvent 流式推送 */
    analyze(req: PaAnalyzeRequest): Promise<{ ok: boolean; error?: string }>
    cancel(): Promise<{ ok: boolean }>
    onEvent(cb: (evt: PaStreamEvent) => void): () => void
  }
  backtest: {
    getDataStatus(): Promise<BacktestDataStatus>
    downloadData(): Promise<{ started: boolean; reason?: string }>
    onDownloadProgress(cb: (msg: DownloadProgressMsg) => void): () => void
    run(args: BacktestRunArgs): Promise<BacktestResult>
    listTemplates(): Promise<BacktestTemplate[]>
  }
  drawings: {
    get(secid: string): Promise<{ current: Drawing[]; history: DrawingVersion[] }>
    save(secid: string, drawings: Drawing[]): Promise<void>
    restore(secid: string, version: number): Promise<Drawing[] | null>
    clear(secid: string): Promise<void>
    runAlgo(
      secid: string,
      code: string,
      kline: KlineResult
    ): Promise<{ ok: boolean; drawings?: Drawing[]; error?: string }>
    /** 算法画线 · AI 生成/调优代码（单次 LLM 调用，返回完整 Python 代码） */
    aiCode(
      intent: string,
      oldCode: string | undefined,
      kline: KlineResult
    ): Promise<{ ok: boolean; code?: string; note?: string; error?: string }>
  }
  alerts: {
    list(): Promise<AlertRule[]>
    add(rule: AlertRule): Promise<AlertRule[]>
    remove(id: string): Promise<AlertRule[]>
    toggle(id: string, enabled: boolean): Promise<AlertRule[]>
    scanNow(): Promise<{ scanned: number; fired: number }>
  }
  ai: {
    /** 发送用户消息并运行 agent（单会话；重复调用在同一会话内续聊） */
    send(text: string, ctx?: AiContext): Promise<{ ok: boolean; error?: string }>
    /** 清空当前会话 */
    reset(): Promise<void>
    /** 取消当前运行 */
    cancel(): Promise<void>
    getConfig(): Promise<AiConfig>
    setConfig(cfg: Partial<AiConfig>): Promise<AiConfig>
    getAudit(): Promise<AiAuditEntry[]>
    rollback(auditId: string): Promise<{ ok: boolean; error?: string }>
    onChunk(cb: (chunk: string) => void): () => void
    onTool(cb: (call: AiToolCall) => void): () => void
    /** AI 写操作完成（策略/画线）后触发，渲染层刷新对应 store */
    onRefresh(cb: () => void): () => void
    onDone(cb: () => void): () => void
    onError(cb: (error: string) => void): () => void
  }
  selection: {
    listRules(): Promise<SelectionRule[]>
    saveRule(rule: Partial<SelectionRule>): Promise<SelectionRule[]>
    deleteRule(id: string): Promise<SelectionRule[]>
    /** 运行一次选股扫描（rule 可传已保存规则或临时规则），结果落库返回 */
    runScan(rule: SelectionRule): Promise<SelectionResult>
    getResults(): Promise<SelectionResult[]>
    onProgress(cb: (p: SelectionProgress) => void): () => void
  }
  monitor: {
    getState(): Promise<MonitorState>
    setConfig(cfg: Partial<MonitorConfig>): Promise<MonitorConfig>
    addStock(item: WatchItem): Promise<void>
    removeStock(secid: string): Promise<void>
    /** 打开/聚焦独立监盘窗口（单例） */
    openWindow(): Promise<void>
    /** 置顶开关 */
    setPinned(v: boolean): Promise<void>
    /** 窗口不透明度 0.3~1（半透明） */
    setOpacity(v: number): Promise<void>
    /** 大屏/看板模式（最大化 + 隐藏控制条） */
    setLarge(v: boolean): Promise<void>
    /** AI 预测命中率统计 */
    getPredictionStats(): Promise<MonitorPredictionStats>
    /** 命中率按股票细分 */
    getPredictionStatsByStock(): Promise<PerStockStat[]>
    /** 命中率按小时统计 */
    getPredictionStatsByHour(): Promise<PerHourStat[]>
    onQuotes(cb: (stocks: MonitorQuote[]) => void): () => void
    onEvents(cb: (ev: MonitorEvent) => void): () => void
    onConfig(cb: (cfg: MonitorConfig) => void): () => void
    /** 命中率统计更新 */
    onStats(cb: (s: MonitorPredictionStats) => void): () => void
  }
  minute: {
    /** AI 分析当日分时并生成预测标注（intent 如 "预测收盘"/"支撑压力"/"剩余走势"/"次日" 或自然语言） */
    analyze(secid: string, intent: string, minute: MinuteResult): Promise<MinuteAiResult>
    /** 取该股当前会话内的预测标注 */
    get(secid: string): Promise<MinuteAiResult | null>
    /** 清空该股预测标注 */
    clear(secid: string): Promise<void>
    /** AI 工具写入标注后推送 */
    onAnnotations(cb: (payload: { secid: string; annotations: MinuteAnnotation[]; opinion: string }) => void): () => void
  }
  float: {
    /** 打开/聚焦某视图浮窗（独立系统窗口，可自由缩放/移动/隐藏） */
    open(view: FloatViewId, params?: FloatViewParams): Promise<void>
    /** 显示/隐藏切换 */
    toggle(view: FloatViewId): Promise<void>
    close(view: FloatViewId): Promise<void>
    getAll(): Promise<Array<{ view: FloatViewId; visible: boolean }>>
    /** 浮窗打开/关闭/显隐变化时通知（窗口菜单刷新用） */
    onChanged(cb: () => void): () => void
  }
  win: {
    /** 自绘标题栏：最小化当前窗口 */
    minimize(): Promise<void>
    /** 自绘标题栏：最大化/还原切换 */
    maximizeToggle(): Promise<void>
    /** 自绘标题栏：关闭当前窗口 */
    close(): Promise<void>
  }
}

export interface BacktestDataStatus {
  exists: boolean
  stocksCount?: number
  dailyRows?: number
  dateFrom?: string | null
  dateTo?: string | null
  /** 行情库数据版本（sync_meta，download_full_data.py 写入） */
  dbVersion?: string
  /** 最后全量同步时间（sync_meta） */
  lastSync?: string
  error?: string
}

export interface QuantServiceConfig {
  enabled: boolean
  baseUrl: string
  timeoutSec: number
  maxRows: number
}

// ── 行情库位置（软件主体与数据库分开存放时由用户指定）─────────────────────────

/** 当前生效行情库的来源 */
export type MarketDbSource = 'setting' | 'env' | 'portable' | 'exe' | 'userData'

export interface MarketDbInfo {
  path: string
  source: MarketDbSource
  /** 是否来自用户在设置里的显式选定 */
  configured: boolean
  exists: boolean
  /** 库结构完整（含 stocks / stock_daily / trade_calendar） */
  valid: boolean
  sizeMb?: number
  stocksCount?: number
  dateFrom?: string | null
  dateTo?: string | null
  /** 不可用时的可操作说明 */
  error?: string
  /** 用户选定后文件却不存在：提示但保留其选择 */
  missingConfigured?: boolean
}

export interface QuantServiceStatus {
  connected: boolean
  baseUrl: string
  checkedAt: number
  latencyMs?: number
  dateFrom?: string | null
  dateTo?: string | null
  stocksCount?: number
  factorsCount?: number
  engineApiCount?: number
  error?: string
}

// ── 价格行为 AI（pa-agent 服务）──────────────────────────────────────────────

/** 本地行情库支持的周期：日 / 周 / 月 */
export type PaTimeframe = '1d' | '1w' | '1M'

/** 分析过程模式：original=完整二阶段上下文（可追溯）；optimized=精简提速 */
export type PaAnalysisMode = 'original' | 'optimized'

export interface PaServiceConfig {
  enabled: boolean
  /** stable=稳定版 PA_Agent_616；aggressive=激进版 PA_Agent_624 */
  profile: 'stable' | 'aggressive'
  /** 手工覆盖服务地址；留空 = 使用桌面端托管的 pa-agent 进程 */
  baseUrl: string
  timeoutSec: number
}

/** 托管服务进程状态 */
export type PaServerState = 'stopped' | 'starting' | 'ready' | 'error' | 'no-deps'

export interface PaServerStatus {
  state: PaServerState
  /** 就绪时的实际地址（端口由系统分配） */
  baseUrl: string | null
  port: number | null
  error: string | null
  /** 最近的服务输出，用于排查 */
  log: string[]
  /** 当前使用的解释器 */
  python: string | null
  /** 服务源码目录（随程序分发） */
  serviceDir: string
  /** 自举的虚拟环境目录 */
  venvDir: string
  /** 服务日志文件（完整日志；界面只显示最近若干行） */
  logFile: string
}

/** setup_env.py 的 JSONL 进度事件 */
export interface PaDepsProgressEvent {
  type: 'progress' | 'log' | 'done' | 'error'
  stage?: string
  message?: string
  venv?: string
  python?: string
  version?: string
}

export interface PaServiceStatus {
  connected: boolean
  baseUrl: string
  checkedAt: number
  latencyMs?: number
  dbPath?: string
  symbolCount?: number
  timeframes?: string[]
  error?: string
}

export interface PaSymbol {
  symbol: string
  name: string
}

export interface PaKlineBar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface PaKlineResult {
  symbol: string
  name: string
  timeframe: PaTimeframe
  bars: PaKlineBar[]
}

export interface PaAnalyzeRequest {
  symbol: string
  timeframe: PaTimeframe
  barCount: number
  analysisMode: PaAnalysisMode
}

/** 本地离线 TXT 包使用与在线分析一致的行情参数，但不会调用大模型。 */
export interface PaOfflineExportRequest {
  symbol: string
  timeframe: PaTimeframe
  barCount: number
  analysisMode: PaAnalysisMode
}

export interface PaOfflineExportResult {
  directory: string
  files: string[]
}

export interface PaKnowledgeFile {
  path: string
  size: number
}

export interface PaKnowledgeLibrary {
  profile: PaServiceConfig['profile']
  label: string
  root: string
  files: PaKnowledgeFile[]
}

/** 阶段一诊断（市场诊断框架 schema 的展示子集） */
export interface PaStage1Diagnosis {
  cycle_position?: string
  direction?: string
  diagnosis_confidence?: number
  market_phase?: string
  detected_patterns?: unknown[]
  key_signals?: unknown[]
  htf_context?: string
  entry_setup?: string
  risk_warning?: string
  strategy_files_needed?: string[]
  gate_result?: string
  [key: string]: unknown
}

/** 阶段二交易决策 */
export interface PaTradeDecision {
  order_direction?: string | null
  order_type?: string
  entry_price?: number | null
  entry_basis_bar?: string | null
  entry_rule?: string | null
  take_profit_price?: number | null
  stop_loss_price?: number | null
  reasoning?: string
  diagnosis_confidence?: number
  trade_confidence?: number
  estimated_win_rate?: number | null
  key_factors?: unknown[]
  watch_points?: unknown[]
  risk_assessment?: string
  invalidation_condition?: string | null
  [key: string]: unknown
}

export interface PaAnalysisRecord {
  meta?: {
    timestamp_local_iso?: string
    symbol?: string
    timeframe?: string
    bar_count?: number
    decision_stance?: string
    [key: string]: unknown
  }
  stage1_diagnosis?: PaStage1Diagnosis | null
  stage2_decision?: {
    decision?: PaTradeDecision
    diagnosis_summary?: unknown
    decision_trace?: unknown[]
    terminal?: unknown
    next_bar_prediction?: unknown
    next_cycle_prediction?: unknown
    [key: string]: unknown
  } | null
  strategy_files_used?: string[]
  exception?: { type?: string; message?: string; stage?: string; [key: string]: unknown } | null
  usage_total?: Record<string, unknown>
  [key: string]: unknown
}

/** pa-agent SSE 事件（主进程解析后转发到渲染层） */
export type PaStreamEvent =
  | { type: 'started'; jobId: string }
  | {
      type: 'frame_ready'
      symbol: string
      name: string
      timeframe: string
      barCount: number
      lastClose: number | null
    }
  | { type: 'stage_event'; event: string }
  | { type: 'stage1_reasoning'; text: string }
  | { type: 'stage1_content'; text: string }
  | { type: 'stage2_reasoning'; text: string }
  | { type: 'stage2_content'; text: string }
  | { type: 'prompt'; stage: string; text: string }
  | { type: 'stage2_files'; files: string[] }
  | { type: 'token_update'; totals: Record<string, unknown> }
  | { type: 'done'; record: PaAnalysisRecord }
  | { type: 'error'; message: string; errorType?: string }
  | { type: 'closed' }

export type DownloadProgressMsg =
  | { type: 'progress'; done: number; total: number; rows: number; failed: number; skipped: number }
  | { type: 'log'; message: string }
  | { type: 'done'; stocks: number; rows: number; skipped: number; failed: number[]; elapsed_sec: number }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string }

export interface BacktestRunArgs {
  code: string
  startDate: string
  endDate: string
  capital: number
}

export interface BacktestDailyRecord {
  date: string
  daily_return: number
  cumulative_return: number
  total_assets: number
  available_cash: number
  position_value: number
}

export interface BacktestTrade {
  date: string
  time: string
  stock: string
  stockName: string
  direction: 'buy' | 'sell'
  price: number
  volume: number
  amount: number
  commission: number
  tax: number
  profit: number
}

export interface BacktestLogEntry {
  level: string
  message: string
}

export interface BacktestResult {
  code: number
  message?: string
  data?: Record<string, number>
  dailyRecords?: BacktestDailyRecord[]
  trades?: BacktestTrade[]
  positions?: Array<Record<string, unknown>>
  benchmark?: {
    dates: string[]
    dailyReturns: number[]
    excessReturns: number[]
  }
  logs?: BacktestLogEntry[]
  error?: string
  stderr?: string
  raw?: string
}

export interface BacktestTemplate {
  name: string
  code: string
}

// ---------- K线画线 ----------

export type DrawingType = 'segment' | 'ray' | 'hline' | 'rect' | 'fib' | 'channel'

export interface DrawingPoint {
  x: number // K线索引
  y: number // 价格
  /** 所在 bar 的时间（"YYYY-MM-DD" 或 "YYYY-MM-DD HH:MM"），跨周期对齐用；旧数据无此字段 */
  t?: string
}

export type AlertRuleType = 'ma_cross' | 'price_above' | 'price_below' | 'volume_spike'

/** 预警规则 */
export interface AlertRule {
  id: string
  secid: string
  name: string
  type: AlertRuleType
  /** ma_cross：快线周期；volume_spike：均量窗口 */
  fast?: number
  /** ma_cross：慢线周期 */
  slow?: number
  /** price_above/below：价格阈值；volume_spike：量比 */
  threshold?: number
  enabled: boolean
}

/** 已触发的预警事件 */
export interface AlertEvent {
  id: string
  ruleId: string
  secid: string
  signal: string
  message: string
  firedAt: number
}

export interface Drawing {
  id: string
  type: DrawingType
  points: DrawingPoint[]
  color: string
  label?: string
  source: 'manual' | 'algo'
  createdAt: number
  updatedAt: number
  /** 画线所属图表周期；旧数据缺省按 kline:day 处理 */
  scope?: string
  /** 是否显示（false = 隐藏但仍保留；缺省视为显示） */
  visible?: boolean
  /** 是否在回收站（soft delete，可从回收站恢复） */
  deleted?: boolean
}

export interface DrawingVersion {
  version: number
  data: Drawing[]
  created_at: number
}

// ---------- AI 助手 ----------

export type AiProviderId = 'anthropic' | 'openai'

export interface AiConfig {
  /** 大模型后端：anthropic（Claude）或 openai（OpenAI 兼容，含本地 Ollama） */
  provider: AiProviderId
  apiKey: string
  model: string
  /** OpenAI 兼容 baseURL（Ollama 本地：http://localhost:11434/v1） */
  baseUrl: string
  /** 写操作控制：auto=直接执行 / confirm=弹确认 */
  writeMode: 'auto' | 'confirm'
  /** 是否允许 AI 把选股结果写入自选股（默认关闭） */
  allowWatchlistWrite: boolean
}

/** 每次 send 附带的当前视图上下文（详情页个股 / 回测页代码等） */
export interface AiContext {
  viewType?: string
  secid?: string
  name?: string
  extra?: string
}

/** 一次工具调用（流式推送 + 渲染层时间线展示） */
export interface AiToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  isError?: boolean
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt?: number
}

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AiToolCall[]
  error?: string
  finished?: boolean
}

export interface AiAuditEntry {
  id: string
  ts: number
  tool: string
  secid?: string
  summary: string
  status: 'applied' | 'denied' | 'rolled_back'
}

// ---------- 自动选股 ----------

export type SelectionMode = 'rule' | 'ai'

/** 选股筛选条件（全部 AND）。技术面走本地行情库，基本面走市场快照 */
export type SelectionFilter =
  | { kind: 'ma_cross'; fast: number; slow: number; within?: number }
  | { kind: 'ma_align'; shorts?: number[]; longs?: number[] }
  | { kind: 'price_breakout'; lookback: number; pct?: number }
  | { kind: 'volume_surge'; ratio: number }
  | { kind: 'volume_shrink'; ratio: number }
  | { kind: 'macd_cross'; fast: number; slow: number; signal: number }
  | { kind: 'rsi_range'; period: number; min?: number; max?: number }
  | { kind: 'change_pct_range'; min?: number; max?: number }
  | { kind: 'amount_range'; min?: number; max?: number }
  | { kind: 'turnover_range'; min?: number; max?: number }
  | { kind: 'pe_range'; min?: number; max?: number }
  | { kind: 'pb_range'; min?: number; max?: number }
  | { kind: 'mv_range'; min?: number; max?: number }
  | { kind: 'industry_in'; list: string[] }

export interface SelectionRule {
  id: string
  name: string
  mode: SelectionMode
  enabled: boolean
  filters: SelectionFilter[]
  sort?: { field: string; order: 'asc' | 'desc' }
  top?: number
  scheduleMinutes?: number | null
  createdAt: number
}

export interface SelectionHit {
  secid: string
  code: string
  name: string
  price?: number
  changePercent?: number
  amount?: number
  reasons: string[]
}

export interface SelectionResult {
  id: string
  ruleId: string
  ruleName: string
  mode: SelectionMode
  scannedAt: number
  total: number
  hits: SelectionHit[]
  error?: string
}

export interface SelectionProgress {
  done: number
  total: number
  hits: number
}

// ---------- 实时监盘 / AI 预测 ----------

export type MonitorScope = 'monitor' | 'watchlist' | 'market'

export interface MonitorConfig {
  /** 总开关（关闭时不做实时入库/监盘/AI 预测） */
  enabled: boolean
  /** 实时入库/监控范围：monitor=监控列表 / watchlist=自选 / market=全市场 */
  scope: MonitorScope
  /** 扫描间隔（秒）：5/10/15/20/30/60/120/180/300 */
  interval: number
  /** AI 实时预测开关 */
  aiEnabled: boolean
  /** AI 触发方式：scheduled=定时 / anomaly=异动 / both=结合 */
  aiTrigger: 'scheduled' | 'anomaly' | 'both'
  /** 定时 AI 预测间隔（秒，默认 300） */
  aiIntervalSec: number
  /** 异动阈值 %：相对上次预测价格涨跌幅超过它立即触发 AI */
  anomalyPct: number
  /** 实时预警阈值 %：单次涨跌幅超过它发提醒 */
  alertPct: number
  /** 预测判定周期（分钟）：超过该时长后按实际走势判定命中/落空 */
  predictionHorizonMin: number
  /** 每只股票 quote_history 保留条数 */
  retention: number
}

export interface StockPrediction {
  secid: string
  code: string
  name: string
  /** 短期方向判断 */
  direction: 'up' | 'down' | 'flat'
  /** 置信度 0-1 */
  confidence: number
  targetPrice?: number
  support?: number
  resistance?: number
  /** 一句话理由 */
  reason: string
  predictedAt: number
}

export interface MonitorQuote extends Quote {
  prediction?: StockPrediction | null
}

export interface MonitorEvent {
  id: string
  ts: number
  secid: string
  name: string
  type: 'alert' | 'prediction' | 'info'
  content: string
}

export interface MonitorState {
  config: MonitorConfig
  stocks: MonitorQuote[]
  events: MonitorEvent[]
}

/** AI 预测命中率统计 */
export interface MonitorPredictionStats {
  total: number
  pending: number
  hit: number
  miss: number
  /** 命中率 = hit / (hit + miss)，无已判定样本为 0 */
  accuracy: number
  byDirection: Record<'up' | 'down' | 'flat', { total: number; hit: number; accuracy: number }>
  avgConfidenceHit: number
  avgConfidenceMiss: number
}

/** 命中率按股票细分 */
export interface PerStockStat {
  secid: string
  name: string
  code: string
  total: number
  hit: number
  miss: number
  accuracy: number
}

/** 命中率按小时（预测发起时刻）统计 */
export interface PerHourStat {
  hour: number
  total: number
  hit: number
  miss: number
  accuracy: number
}

// ---------- 分时 AI 预测/画线 ----------

export type MinuteAnnotationType = 'hline' | 'segment' | 'ray' | 'markArea' | 'markPoint'

/** 分时图上的 AI 预测标注（x=每日分钟序号 0..239，可超出当前数据=未来；y=价格） */
export interface MinuteAnnotation {
  id: string
  type: MinuteAnnotationType
  x1: number
  y1: number
  x2?: number
  y2?: number
  color: string
  label?: string
}

export interface MinuteAiResult {
  annotations: MinuteAnnotation[]
  /** AI 一句话观点 */
  opinion: string
}

// ---------- 视图浮窗（独立系统窗口自由排布） ----------

export type FloatViewId =
  | 'watchlist'
  | 'market'
  | 'detail'
  | 'backtest'
  | 'alerts'
  | 'selection'
  | 'ai'
  | 'monitor'
  | 'settings'

export interface FloatViewParams {
  secid?: string
  name?: string
}
