# LocalStock AI 全面数据接入方案

> 依据：`D:\pythonpro\聚宽-local\docs\AI接口文档.md`（2026-08-27 v1）  
> 目标：让桌面端 AI 在受控、可审计、低 token 消耗的前提下，统一访问实时行情、历史行情、因子与基本面、策略引擎、完整回测结果、选股、监盘、画线和应用状态，并完成“研究 → 写策略 → 回测 → 诊断 → 迭代 → 展示”的闭环。

## 实施状态（2026-08-27）

P0 已实现：

- 新增仅允许本机地址的聚宽 HTTP 客户端、统一响应校验、超时处理和 10 分钟能力缓存。
- 新增 AI 工具 `get_quant_capabilities`、`get_historical_market_data`、`get_backtest_result`、`get_data_catalog`。
- 历史行情支持股票/指数/日历、代码规范化、摘要计算和分页；回测结果支持 7 个 section、对齐时间序列分页。
- `query_db` 禁止 AI 读取 `settings.value`；超长工具结果改为合法 JSON 摘要，不再产生半截 JSON。
- 设置页新增“AI 数据与量化服务”卡片；AI 面板新增历史库/因子连接状态徽标。
- 真实服务联调结果：5973 只股票、25 个因子、24 个策略 API，实际交易日范围为 `1991-06-01 ～ 2026-08-07`。文档中的 `2026-08-25` 晚于当前实际库，因此运行时始终以接口返回日期为准。
- 既有回测 `4b091338c82863ae5fa98986a2f2e62d` 实测可读取：242 个净值日、39 笔成交、660 条持仓、6 条日志。
- TypeScript 检查通过；Vitest 16 个文件、93/93 测试通过；真实桌面连接验证通过。

## 1. 结论与核心决策

采用“双数据平面 + 一个 AI 工具网关”：

1. **桌面实时数据平面**继续负责实时快照、盘口、分时、分钟 K、自选、预警、监盘、画线和 LocalStock 应用数据。
2. **聚宽本地研究平面**通过 `http://127.0.0.1:3000/api/*` 负责策略 API 说明、因子库、交易日历、股票/指数长历史、完整回测与持久化结果。
3. **AI 工具网关**对模型提供少量领域级工具，不把几十个 HTTP 路由原样暴露给模型。网关负责连接检测、参数规范化、分页、汇总、token 限流、权限门控和审计。
4. 聚宽 HTTP API 作为新的**权威研究/回测后端**；桌面端现有 Python `run_backtest` 暂时保留为兼容回退，待结果页迁移完成后再决定是否移除。
5. “全面接入”不等于一次把全库塞给模型。默认返回摘要、尾部样本和分页游标；只有 AI 明确需要时才继续读取明细。

## 2. 当前能力盘点

### 2.1 已有能力

桌面端现有 AI 已提供：

- 实时行情、股票搜索、日/周/月/季及分钟 K、分时、五档盘口、市场列表。
- 自选股、预警规则、画线及画线历史、选股规则和选股结果。
- 本地行情库与应用库的只读 SQL `query_db`。
- 策略代码读取/写入、旧版 Python 回测执行。
- 分时 AI 分析与标注、算法画线、选股写入、自选写入。
- 写操作门控、审计记录和部分操作回滚。

### 2.2 关键缺口

| 缺口 | 当前影响 |
|---|---|
| 未调用 `/api/ai/engine-docs` | AI 靠静态提示猜策略 API，容易写错函数、字段和数据口径 |
| 未调用 `/api/factors` | AI 不知道 25 个可用因子、方向、参数和数据来源 |
| 回测仍走桌面旧 `runBacktest` | 无 `backtestId`，无法持续读取完整净值、成交、持仓、基准和日志 |
| 无回测结果读取工具 | AI 不能做交易归因、持仓集中度、拒单诊断和多策略比较 |
| 未接入日历/指数/批量历史接口 | AI 需要频繁写 SQL，调用成本高且字段容易猜错 |
| `query_db` 目录描述不完整 | `fund_daily`、财务三表、因子相关字段等资产没有被可靠发现 |
| 工具结果统一硬截断 20,000 字符 | 大结果可能在 JSON 中间截断，模型拿到不可用数据 |
| 只有 read/write 两类权限 | “运行但不持久化”的计算与真正写入混在一起 |
| `confirm` 模式实际是拒绝，不是真正确认 | 无法在 UI 中批准一次高成本或持久化回测 |
| 会话上下文较薄 | 只传视图和股票，未传当前周期、复权、日期范围、选中策略/回测等 |

## 3. 总体架构

```text
AI 模型
  │
  ▼
AI Agent（意图规划、20 轮上限）
  │
  ▼
Quant Tool Gateway
  ├─ 能力目录与缓存
  ├─ 参数/证券代码/日期规范化
  ├─ 分页、聚合、token 预算
  ├─ read / execute / write 权限
  ├─ 超时、取消、重试、错误自诊断
  └─ 审计与结果引用
       │
       ├──────── Desktop Data Adapter
       │          实时、盘口、分时、分钟K、自选、预警、监盘、画线、应用库
       │
       └──────── JoinQuant HTTP Adapter
                  engine-docs、factors、calendar、stock/index daily、stats、AI backtest、结果明细
```

### 新增模块建议

```text
electron/quant/
  client.ts              # 统一 HTTP 客户端、响应校验、超时、取消
  config.ts              # baseUrl、权限、超时、返回上限
  capabilities.ts        # engine-docs/factors/stats/calendar 缓存
  normalize.ts           # secid ↔ 6位代码 ↔ .XSHG/.XSHE
  result-shaper.ts       # 摘要、分页、字段选择、token 预算
  service-manager.ts     # 可选：检测/启动/停止本地服务
electron/ai/
  tools-quant.ts         # 面向模型的领域级量化工具
```

## 4. 面向 AI 的工具设计

不建议把文档中的每条路由直接变成一个工具。首期提供以下 7 个领域工具即可覆盖完整数据面，并减少模型选择错误。

### 4.1 `get_quant_capabilities`

一次返回连接状态、数据范围、数据库规模、策略 API 摘要和因子目录。

```ts
input:  { include?: ('engine'|'factors'|'stats'|'calendar')[]; refresh?: boolean }
output: {
  connected, baseUrl, dataRange, stats,
  engineVersionHash, strategyApi, conventions,
  factors: [{name,direction,source,params,desc}],
  limitations: ['日线收盘撮合','无分钟回测','幸存者偏差',...]
}
```

对应 `/api/ai/engine-docs`、`/api/factors`、`/api/stats`、`/api/calendar/range`；默认缓存 10 分钟，文档和因子用内容哈希长期缓存。

### 4.2 `run_quant_backtest`

替代 AI 当前使用的旧 `run_backtest`，直接调用 `POST /api/ai/backtest`。

```ts
input: {
  code, name?, startDate?, endDate?, capitalBase?,
  persist?: boolean, saveAlgorithmId?, dailyRecordsLimit?: number
}
output: {
  backtestId, persisted, metrics,
  dailyRecordsTail, tradesRecent, warnings, logsTail,
  resultRef: { backtestId, availableSections: [...] }
}
```

行为要求：

- 首次写策略前，若当前会话没有引擎文档版本，Agent 应先调用 `get_quant_capabilities`。
- 默认 `persist=false` 做快速试验；用户认可或进入正式比较时再 `persist=true`。
- 解析接口 `message` 和 `logsTail`，把可修正错误原样返回给模型。
- 超时使用接口上限 600 秒；支持取消，并在 UI 展示运行秒数。
- 同一时间只运行一个聚宽回测；后续请求进入显式队列，而不是并发启动。

### 4.3 `get_backtest_result`

统一读取一个回测的全部结果，避免模型记忆多个路由。

```ts
input: {
  backtestId,
  sections: ('summary'|'returns'|'trades'|'positions'|'benchmark'|'logs'|'code')[],
  offset?: number, limit?: number,
  level?: 'info'|'warning'|'error',
  fields?: string[], tail?: boolean
}
output: { backtestId, sections: {...}, page: {offset,limit,total,hasMore} }
```

适配 `/summary`、`/returns`、`/trades`、`/positions`、`/benchmark`、`/logs`、`/code`。默认只取 summary；数组默认 100 条，最大 1000 条。

### 4.4 `analyze_backtest`

在主进程确定性计算常用诊断，避免把数千行明细交给 LLM：

- 月度/年度收益、滚动波动、最大回撤区间与修复天数。
- 收益/亏损交易分布、盈亏比、换手、费用占比、连续亏损。
- 最大持仓权重、持仓数量、集中度、单股贡献。
- 基准超额、跟踪误差、不同市场阶段表现。
- warning/error 日志分类和拒单计数。

模型默认读取诊断摘要，需要核实时再调用 `get_backtest_result` 获取原始样本。

### 4.5 `compare_backtests`

```ts
input: { backtestIds: string[]; metrics?: string[]; normalizePeriod?: boolean }
output: { ranking, metricTable, comparable, warnings, paretoFront }
```

一次比较 2～20 个回测，默认按收益、回撤、夏普、波动、超额、胜率、交易次数输出表格；日期区间不同则明确标记不可直接比较。

### 4.6 `get_historical_market_data`

统一包装交易日历、股票、指数与批量行情：

```ts
input: {
  assetType: 'stock'|'index'|'calendar',
  codes?: string[], start?: string, end?: string,
  fields?: string[], mode?: 'rows'|'summary'|'correlation',
  offset?: number, limit?: number
}
```

- 单股 → `/api/stock/:code/daily`
- 多股 → `/api/stock/batch/daily`
- 指数 → `/api/index/:code/daily`
- 日历 → `/api/calendar` 与 `/api/calendar/range`
- `summary` 在本地计算区间收益、波动、回撤、相关性等，减少 token。

### 4.7 `get_data_catalog` / `query_db`

保留 `query_db` 作为专家级只读后门，但新增动态 `get_data_catalog`：从 SQLite `sqlite_master` 和 `PRAGMA table_info` 读取真实表/列、行数估计、日期覆盖和示例值，避免在工具描述中维护过时 schema。

目录至少覆盖：

- 行情：`stocks`、`stock_daily`、`fund_daily`、`index_daily`、`trade_calendar`、分钟缓存表。
- 财务：`fs_combas`、`fs_comins`、`fs_comscfd`。
- 应用：自选、设置、画线、预警、选股、监盘、行情历史、预测历史、AI 审计。
- 聚宽结果：算法、回测、每日净值、成交、持仓、基准、日志、策略代码（通过 HTTP 读取，不跨库直连）。

`query_db` 继续限制单条 SELECT、只读连接、禁止 ATTACH/PRAGMA 写操作，并新增 `offset/limit`、执行超时、最大扫描行数及敏感设置列遮蔽。

## 5. 数据路由规则

| 用户问题 | 首选数据源 | 回退 |
|---|---|---|
| 当前价格、涨跌、盘口 | Desktop 实时行情 | 最近 quote_history，并标注时间 |
| 当日/五日分时、分钟 K | Desktop 分时/分钟缓存 | 在线行情接口 |
| 长周期股票/ETF/指数历史 | JoinQuant historical API | Desktop stock_data 只读查询 |
| 因子与基本面策略 | JoinQuant engine + factors | 不回退到简化旧引擎 |
| 新策略回测 | `/api/ai/backtest` | Desktop 旧引擎，仅用户明确允许降级 |
| 已持久化回测诊断 | JoinQuant result APIs | 无；返回服务不可用 |
| 自选、画线、预警、监盘、选股 | Desktop application DB | 无 |

AI 回答必须附带数据时间、来源和是否为缓存/回退；实时与历史数据冲突时不得静默混用。

## 6. 代码与标识规范化

网关内部统一 `SecurityId`：

```ts
{
  code: '600519',
  exchange: 'XSHG',
  secid: '1.600519',
  jqCode: '600519.XSHG',
  assetType: 'stock'
}
```

- `6/68` 开头通常映射 XSHG；`0/3` 映射 XSHE；ETF/LOF按市场规则处理。
- 外部接口历史查询使用 6 位代码；策略源码使用 `.XSHG/.XSHE`；桌面实时接口使用 `市场.代码`。
- 所有日期在网关验证为 `YYYY-MM-DD`，并先与 `/api/calendar/range` 对齐。
- 比例口径明确区分：回测收益为小数（0.1=10%）；基本面指标按引擎文档为百分数（roe=10.47 即 10.47%）。

## 7. 设置界面

在“设置 → AI 数据与量化服务”新增：

- **服务总开关**：启用聚宽本地数据。
- **服务地址**：默认 `http://127.0.0.1:3000`。
- **连接状态**：已连接/不可用、数据日期、股票数、因子数、接口版本哈希。
- **检测连接**按钮：调用 stats + engine-docs，并显示可修复错误。
- **服务模式**：外部手动启动；后续可增加随 LocalStock 启动。
- **项目目录/Node 路径**：仅自动管理模式使用，不写死开发机的 `D:\pythonpro\聚宽-local`。
- **回测权限**：禁止 / 允许临时试跑 / 允许持久化。
- **最大回测时长**、**最大返回明细数**、**默认 persist=false**。
- **允许读取应用隐私数据**：默认不向模型返回 API Key、完整 settings、原始审计快照。
- **清除能力缓存**与**查看最近调用日志**。

AI 面板顶部显示数据状态徽标：`实时 ✓`、`历史库 2026-08-25`、`量化服务 ✓`；离线时直接说明哪些能力不可用。

## 8. 权限、安全与审计

### 8.1 权限三级化

| 权限 | 示例 | 默认 |
|---|---|---|
| read | 行情、因子、历史回测读取 | 允许 |
| execute | `persist=false` 回测、确定性统计 | 需开启“允许试跑” |
| write | `persist=true`、保存策略/结果、画线、选股、自选 | 逐次确认或自动+审计 |

### 8.2 必须修正的安全点

- 客户端默认只允许 `http://127.0.0.1` / `http://localhost`；远程 URL 需显式高级开关，禁止 URL 中携带凭据。
- 聚宽服务当前 `cors()` 全开且 Express 默认可能监听所有网卡。建议改为绑定 `127.0.0.1`，限制 CORS，并增加随机本地 token 或命名管道代理。
- AI 不得通过 `query_db` 读取 `ai.apiKey` 等敏感 settings；返回前按键名遮蔽。
- 记录每次外部调用的工具名、参数摘要、耗时、状态、backtestId 和响应大小；不记录完整策略以外的密钥或敏感值。
- 持久化回测是外部数据库写操作，审计中标记“不可由 LocalStock 自动回滚”；若服务增加删除 API 后再支持回滚。
- 超长查询和回测必须响应 Agent 取消信号，避免用户点“停止”后子任务继续运行。

## 9. Token 与性能控制

1. 所有列表返回 `{items,page,total,hasMore}`，禁止字符串中间硬截断 JSON。
2. 工具结果按结构预算，默认目标 12k 字符、硬上限 40k；超限时保留摘要和 `resultRef`。
3. 净值默认返回尾部 30 条；成交/持仓/日志默认 50/100/100 条。
4. 大数组先由主进程计算统计，再让模型按需取异常区间或代表样本。
5. engine-docs、factors、stats 和 calendar range 缓存；回测结果按 `backtestId + section + page` 缓存。
6. HTTP 使用连接复用；GET 可对网络瞬断重试 1 次，POST 回测不自动重试，防止重复持久化。
7. Agent 工具轮次从固定 20 改为任务预算：普通问答 8，策略闭环 30；每次回测计入单独的执行预算。

## 10. AI 工作流

### 10.1 研究与回测闭环

1. `get_quant_capabilities`：获取引擎 API、因子、日期范围和限制。
2. `get_historical_market_data(mode='summary')`：验证标的和区间。
3. 生成策略并执行 `run_quant_backtest(persist=false)`。
4. 根据 `metrics + logsTail` 修正语法、调度或交易问题；最多自动迭代 3 次，防止无限试参。
5. `analyze_backtest`：检查回撤、交易、持仓、基准和偏差。
6. 多候选使用 `compare_backtests`，不得只按总收益挑选。
7. 用户确认后 `persist=true` 正式运行，返回 backtestId，并同步到桌面回测结果页。
8. 回答中声明数据范围、撮合口径、幸存者偏差和指数近似限制。

### 10.2 当前界面上下文增强

`AiContext` 扩展为：

```ts
{
  viewType, secid, name,
  chartScope, klt, fqt, visibleStart, visibleEnd,
  selectedDrawingIds,
  backtestId, strategyName, strategyCodeHash,
  selectionRuleId,
  monitorScope,
  dataFreshness
}
```

只传标识与摘要，不把完整 K 线或策略代码重复塞入每轮系统提示；需要时由工具读取。

## 11. 分阶段实施

### P0：连接底座与只读能力

- 新增量化服务配置、连接检测、HTTP 客户端、响应校验、错误分类和能力缓存。
- 实现 `get_quant_capabilities`、`get_historical_market_data`、`get_backtest_result`。
- 新增动态数据目录，更新 `query_db` 的敏感字段遮蔽与分页。
- UI 增加服务状态与设置卡片。

**验收**：服务关闭/端口错误/正常三种状态均有明确提示；AI 能回答数据范围、因子清单、某股历史与任一既有回测的完整结构。

### P1：权威回测闭环

- 实现 `run_quant_backtest`、execute/write 权限、任务队列、600 秒超时、取消和调用审计。
- 将引擎文档版本加入 Agent 会话，修正系统提示中的 `log.info()` 规范。
- 桌面回测结果页支持通过 backtestId 读取 summary/returns/trades/positions/benchmark/logs/code。

**验收**：AI 可从一句需求生成策略，临时回测，依据错误自修正，再持久化；重启桌面端后仍可读取结果。

### P2：诊断、比较与可视化

- 实现 `analyze_backtest` 和 `compare_backtests`。
- 回测页增加 AI 诊断卡、策略比较表、回撤区间和交易归因入口。
- 支持把 AI 选定回测的净值、基准、成交和持仓直接展示到现有图表。

**验收**：AI 对至少 3 个策略给出可复核的指标表、风险排序和原始数据引用，不依赖大数组直接入模。

### P3：服务自动管理与任务中心

- 可选自动启动聚宽服务、端口探测、日志查看、异常重启。
- 长回测任务中心：排队、进度、取消、完成通知和结果引用。
- 增加回测配额、自动迭代次数和并发设置。

**验收**：普通用户无需命令行即可完成连接与回测；退出 LocalStock 时不遗留由其启动的服务进程。

## 12. 自动化验收矩阵

| 场景 | 断言 |
|---|---|
| 服务不可用 | 2 秒内返回结构化错误，不影响实时行情工具 |
| 能力发现 | API 数量、25 因子、数据范围与接口响应一致 |
| 代码规范 | 缺 initialize、使用 print、错误函数名均能引导模型修正 |
| 临时回测 | persist=false 不产生可查询 backtestId，指标仍完整 |
| 正式回测 | persist=true 返回 backtestId，7 类结果均可分页读取 |
| 取消 | 用户停止后 HTTP/子进程退出或明确进入取消状态 |
| 大结果 | 返回合法 JSON、摘要与 hasMore，不发生半截 JSON |
| 多策略比较 | 日期不一致时标记不可直接排名 |
| 输入安全 | API Key、敏感 settings、URL 凭据不进入工具结果/日志 |
| 数据口径 | 收益小数、基本面百分数、证券代码三种格式转换正确 |
| 回退 | 聚宽不可用时仅实时功能继续；旧回测降级必须显式提示 |
| 跨会话 | 持久化 backtestId 可在应用重启后恢复并展示 |

## 13. 首批实际改动文件

建议第一批实现集中在：

- `shared/types.ts`：量化服务配置、工具结果、扩展 AiContext。
- `electron/quant/*`：新建 HTTP 适配层。
- `electron/ai/tools-quant.ts`：新建量化领域工具。
- `electron/ai/tools.ts`：注册新工具，保留桌面实时工具。
- `electron/ai/agent.ts`：结构化结果预算、取消信号、能力版本提示。
- `electron/ai/provider.ts`：保存量化服务与权限配置。
- `electron/ai/write-gate.ts`：扩展 read/execute/write 和真正的一次性确认。
- `src/components/settings/SettingsPage.tsx`：AI 数据与量化服务设置卡。
- `src/components/ai/AiChatView.tsx`：数据状态、执行确认、任务进度与结果引用。
- `src/components/backtest/*`：按 backtestId 展示聚宽完整结果。
- `electron/ai/*.test.ts`、`scripts/verify-ai-quant-integration.js`：契约、权限、取消、分页和端到端验证。

## 14. 不建议的做法

- 不直接让模型任意访问 `http://localhost:3000`；必须经过主进程网关。
- 不把聚宽 `backtest.db` 作为第三个 `query_db` 数据库直接暴露；优先使用稳定 API 契约。
- 不用一个巨型 `get_all_data` 返回所有信息；这会超 token、难追溯且无法保证新鲜度。
- 不在每轮系统提示重复塞 6KB engine-docs 和 25 个因子；使用缓存版本和按需工具。
- 不对回测 POST 自动重试；网络超时后先查询已知 backtestId/任务状态，避免重复写入。
- 不默认自动调参到“最好收益”；限制迭代次数并以回撤、稳健性和样本外风险共同评估。
