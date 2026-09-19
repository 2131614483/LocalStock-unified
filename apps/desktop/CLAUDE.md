# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在 `apps/desktop` 桌面版子项目中工作时提供指引。仓库根目录的 `CLAUDE.md` 规定统一工作区边界；本文件补充桌面端专属架构、契约和测试要求。

> **接手前必读**：完整的架构/数据流/IPC 契约/AI 子系统/坑/交接指引见 **`apps/desktop/docs/项目交接文档.md`**（本 CLAUDE.md 是其精简版）。

## 项目简介

LocalStock 桌面便携版是本地自用的 A 股行情 + 量化回测 Electron 应用（同花顺风格）：指数栏、自选股、K线/分时、盘口五档、搜索、K线画线（手动画线 + Python 算法画线 + 版本历史）、量化回测。免登录、无外部数据库服务，数据全部存本地 SQLite。

技术栈：Electron 37 + electron-vite 3 + React 19 + Zustand 5 + ECharts 5 + better-sqlite3。回测引擎、全量数据下载、算法画线由本机 Python（3.9+，需 `pip install akshare pandas`）通过子进程完成。

## 常用命令

```bash
npm install          # postinstall 自动 electron-builder install-app-deps 重编译 better-sqlite3
npm run dev          # electron-vite dev（开发运行）
npm run build        # 构建到 out/
npm run start        # electron-vite preview
npm run typecheck    # tsc --noEmit 分别检查 main(node) 与 renderer(web)
npm test             # vitest 单测（electron/、src/、shared/ 下的 *.test.ts）
npm run build:win    # electron-vite build + electron-builder --win portable
npm run build:all    # typecheck + build:win 一条龙（白名单命令，可避开分类器）
npm run gen-icon     # 重新生成应用图标（scripts/generate-icon.mjs）
```

**视觉测试**（改任何 UI 后必须启动应用截图验证，见全局 skill `~/.claude/skills/visual-test/SKILL.md`）：

```bash
cd desktop
npm run build:win    # 先构建出 dist/win-unpacked/LocalStock.exe（测试启动的是打包产物，不是 dev server）
npx playwright test scripts/visual-test.spec.js --reporter=list
```

截图输出到 `test-results/`，断言针对 `src/components/` 里的全局类选择器（如 `.stock-table`、`.chart-box canvas`）。界面图像识别（尤其 canvas 图表语义验证）用智谱云端 `~/.claude/skills/zhipu-vision`，完整界面清单与识图要点见 `docs/视觉识别测试清单.md`。

## 架构总览

### 进程结构（electron-vite 标准三段式）

- **主进程** `electron/`（入口 `main.ts`，CJS 产物 `out/main/index.js`）：建窗口（1360x860、深色、`sandbox:false`）、初始化 SQLite、注册全部 IPC、管理行情轮询。主→渲染推送统一经 `getWindow()` 访问器取当前窗口，模块不持有过期引用。**新增模块**：`ai/`（Agent 工具循环 + 工具注册表 + 审计回滚）、`monitor/`（实时行情入库 + AI 预测 + 命中率统计）、`selection/`（自动选股）、`minute-ai.ts`（分时 AI 画线预测）、`windows.ts`+`float-ipc.ts`（视图浮窗管理器）、`market/sqlite-worker.ts`（选股扫描）。
- **预加载** `electron/preload.ts`：`contextBridge.exposeInMainWorld('api', api)`。每个调用包装成 `ipcRenderer.invoke` Promise；`on*` 订阅返回取消订阅闭包。
- **渲染层** `src/`：React 19 + Zustand 5 + ECharts 5，入口 `src/main.tsx` → `App.tsx`。

### 渲染层 ↔ 主进程桥（shared/types.ts 是唯一真相源）

`shared/types.ts` 定义 `WindowApi`（`window.api` 完整契约）与全部数据形状，主/渲染两进程都 import（`src/lib/api.d.ts` 仅声明全局 `window.api: WindowApi`）。约定：

- 所有调用为 Promise；**IPC 频道命名 `domain:method`**：`market:*`、`watchlist:*`、`settings:*`、`backtest:*`、`drawings:*`、`alerts:*`、`ai:*`、`selection:*`、`monitor:*`、`minute:*`、`float:*`、`quant:*`、`pa:*`。
- **主→渲染推送**：`market:quotes`（行情快照，**广播给所有窗口**，按 webContents.id 订阅并集）、`backtest:downloadProgress`、`ai:chunk/tool/refresh/error/done`、`minute:annotations`、`monitor:quotes/event/config/stats`、`float:changed`。
- **新增 IPC 要改三处**：`shared/types.ts` 的 `WindowApi`、`electron/preload.ts`、`electron/ipc.ts` 的 handler。
- 路径别名 `@` → `src`（渲染层）、`@main` → `electron`（仅 tsc 用）。代码里实际全部走相对路径（如 `../../shared/types`）。

### 无路由的视图切换（src/）

没有 router。`App.tsx` 用 `useApp` store 的 `view` 判别联合（`watchlist | market | detail{secid,name} | backtest`）条件渲染页面；自选/市场页就定义在 `App.tsx` 内。五个 zustand store（无中间件）：

- `store/app.ts`（useApp）— 中枢：view、自选、quotes 快照、市场列表、刷新间隔（1000/3000/5000）、回测跳转目标。
- `store/backtest.ts`（useBacktest）— 回测页状态：数据状态、下载进度、模板、策略代码（自动保存）、参数、结果。
- `store/drawings.ts`（useDrawings）— 按 secid 的画线状态与历史版本。
- `store/ai.ts`（useAi）— AI 助手：会话消息、流式运行、工具调用、配置、写操作审计与一键回滚。
- `store/selection.ts`（useSelection）— 自动选股：规则、扫描结果、运行状态。

行情数据流：`App.tsx` 订阅 `market.onQuotes` → `setQuotes`；订阅范围（`INDEX_SECIDS` + 当前自选/详情 secid）在 view/自选/刷新间隔变化时重新 `window.api.market.subscribe(secids, interval)`。

### 图表（src/lib/useEChart.ts + components/）

`useEChart` 封装 ECharts（mount/dispose、resize、notMerge setOption，StrictMode 安全）。`KLineChart`：蜡烛 + MA5/10/20/60 + 成交量，双 grid 联动、dataZoom；画线叠加为 ECharts **custom series**（`renderDrawingItem` 把 `(index, price)` 转像素），工具交互经 `zr.on('mousedown'/'mouseup')` + `chart.convertFromPixel`。`MinuteChart`：价格线 + 均价线 + preClose markLine。回测结果图复用同一 hook。

### 数据层（SQLite，同步、阻塞主进程）

better-sqlite3 全同步，读写直接在主进程 IPC handler 里做（主进程是唯一 DB 客户端）。两个库：

- **`localstock.db`**（`app.getPath('userData')`，`db.ts` 单例，迁移现 v7）：基础 `watchlist`、`settings`、`kline_cache`（通用在线数据缓存）、`drawings`、`drawing_history`（每股票保留最近 100 版）；预警 `alert_rules`、`alert_events`；AI 写审计 `ai_audit`；自动选股 `selection_rules`、`selection_results`；实时监盘 `monitor_list`、`quote_history`、`monitor_events`、`ai_predictions`、`prediction_history`、`monitor_state`（预警去重跨重启）。
- **`stock_data.db`**（行情库）：路径由 `resolveMarketDb()`/`stockDataPath()`（`electron/backtest.ts`，被 kline-local / market-list-local / minute-local / minute-kline-local 四个模块 import）解析，优先级 **设置 `marketDbPath`（用户在界面显式选定）→ 环境变量 `LOCALSTOCK_MARKET_DB` → 便携包同目录 `data/` → exe 同目录 `data/` → `userData/stock_data.db`**。设置页「行情库位置」可选定/校验/恢复默认（`electron/market/db-config.ts`，IPC 域 `marketDb:*`）；切换时调用 `applyMarketDbPath()` —— 重新注入 `setDbPath`、`resetMarketDbWorker()` 丢弃只读查询 worker、并重启 pa-agent 服务，因此**立即生效、无需重启应用**。校验刻意做得便宜：只看表是否存在 + `stocks` 行数 + `trade_calendar` 日期范围，**不对 `stock_daily` 做 COUNT**（千万级，会卡几十秒）。表：`stock_daily`（日线、**不复权原始价 bfq**）、`stocks`、`trade_calendar`、`index_daily`、`stock_minute`（当日/多日分时持久化，`minute-local.ts`）、`stock_minute_kline`（分钟K线 1/5/15/30/60/120 持久化，`minute-kline-local.ts`，按 股票+klt 整周期替换）。由 Python `download_full_data.py`（AkShare）产出，但 `minute-local.ts`/`minute-kline-local.ts` 会写分时/分钟K线。多个独立连接共享该文件（readonly + writable，WAL 只设在 writable 上）。
- **只读查询 worker**（`sqlite-worker.ts` + `sqlite-worker-client.ts`）：日/周/月/季 K 线、沪深列表的同步 SQLite 查询（实测 getKline 1.6s、getMarketList 冷启动 4.4s）会阻塞主进程，已迁到 `worker_threads`（`sqlite-worker.js`，electron-vite 主进程第二入口）。主进程 `registerIpc` 把行情库路径注入共享 `db-path.ts`（`setDbPath`），查询模块用 `getDbPath()` 打开连接，**不依赖 electron**（worker 里 `require('electron')` 会崩）。IPC 有耗时审计：>100ms 打 `[IPC-SLOW]` 日志（`auditedHandle`，`measure-ipc.js` 可复测）。

### 行情获取（electron/market/，本地优先 + 多源回退）

所有出站请求过全局串行 `Limiter`（250ms 最小间隔，`limiter.ts`，队列超 200 丢最旧）；东财限流严重（返回 HTTP 000）。`http.ts` 用原生 `node:https` 并强制 IPv4（本机 IPv6 到行情源不通）。

| 数据 | 优先级链 |
|---|---|
| 实时快照 | 东财 push2 →（失败/空则 60s 冷却）腾讯 qt.gtimg.cn（GBK）|
| 日/周/月/季 K 线 | 本地 stock_daily（JS 聚合：周 `weekKey` / 月 `YYYY-MM` / 季 `YYYY-Qn`）→ kline_cache（TTL）→ 东财 push2his |
| 分钟K线(1/5/15/30/60/120) | **新浪** `getKLineData?scale=N`（主）→ **腾讯** `mkline mN`（备）；120 由 60 分钟两两聚合（`mergeTo120`）|
| 分时 | 60s 缓存 → 本地 stock_minute（最近交易日）→ 新浪 scale=1（1日/5日，`getMinute(secid, days)`，5日点带日期 `MM-DD HH:MM`）→ 东财 trends2 |
| 盘口五档 | 仅腾讯（GBK，iconv-lite 解码）|
| 搜索 | 东财 searchapi（过滤 AStock）|

> **东财分钟/季K 不可靠**：`stock/kline/get` 对 klt=1/5/15/30/60/104 会忽略 klt 返回日K，故分钟K线走新浪/腾讯，季K走本地日线聚合。`getLocalKline` 对分钟级 klt 返回 null 走在线源。

错误处理风格：几乎不向渲染层抛错，各层返回回退值或 null（如 `getLocalMarketList` 失败返回 null）。

### 回测 / 数据下载 / 算法画线（Python 子进程）

主进程 `backtest.ts` / `drawings.ts` 调本机 Python：

- **回测** `backtest:run`：`execFile(backtest_engine.py, --code <策略> --db ... --start --end --capital)`，maxBuffer 50MB、timeout 120s，stdout 解析为**单个 JSON 对象**。策略 API：`initialize`、`g`、`run_daily/run_weekly/run_monthly`、`order_target_value`、`attribute_history`、`log`；代码经 `exec()` 注入 `env` 执行。
- **下载数据** `backtest:downloadData`：`spawn(download_full_data.py)`，stdout 逐行读、每行 JSONL（`{type: progress|log|done|error}`）转发到 `backtest:downloadProgress`；按已入库 stock_code 断点续传、单实例下载。
- **算法画线** `drawings:runAlgo`：K线先写临时 JSON（`app.getPath('temp')`），`execFile(draw_engine.py, --code --data <file>)`，stdout 单行 JSON `{code, drawings, logs}`；注入 `data`/`n`/`log`/`drawings` 及 `draw_line`/`draw_ray`/`draw_hline`/`draw_rect`/`draw_fib`/`draw_channel`。
- Python 路径：打包 `resources/python`、开发 `app.getPath('app')/python`；解释器取 `settings:pythonPath`，默认 `python`。两处子进程都设 `PYTHONUTF8=1`。
- 策略模板在 `python/scripts/templates/`（买入持有/双均线/布林带/海龟），`backtest:listTemplates` 读取。

## 价格行为 AI 页（`src/views/PaView.tsx`）

侧边栏「价格行为 AI」→ `{type:'pa'}` 视图，移植自 `D:\pythonpro\PA_Agent_616`（Al Brooks 价格行为体系），界面用 React 重写，核心逻辑跑在随程序分发的 Python 服务里。

- **服务源码**：`python/pa-agent/`（打包后 `resources/python/pa-agent`）。只读 `stock_data.db`，**无写权限**。
- **自动启停**：`electron/pa/server.ts` 在应用启动时拉起、`before-quit` 时关闭。端口以
  `PA_AGENT_PORT=0` 由系统分配、经 `PA_AGENT_PORT_FILE` 回报（避免抢端口竞态）；
  `PA_AGENT_PARENT_PID` 让服务在父进程被强杀后自退。
- **运行环境自给（可迁移的关键）**：`electron/pa/runtime.ts` 保证服务**始终跑在自己的 venv**
  （`<userData>/pa-agent-venv`）。顺序：venv 就绪→直接用（零下载）；否则找本机 Python
  （`pythonPath` › 分发 runtime › 官方安装目录 › PATH）建 venv；**都没有**才从 GitHub 下载
  独立 CPython（21MB）。所以拷到没装 Python 的电脑也能跑。
  - **pip 默认清华源**（不依赖本机 pip 配置），可用 `PA_AGENT_PIP_INDEX` 覆盖。
  - **独立 Python 下载走代理优先**：ghproxy.net / gh-proxy.com → 官方兜底
    （实测国内直连 GitHub release 常 HTTP 000）；`PA_AGENT_PY_DOWNLOAD_BASE` 可自定义；
    `LOCALSTOCK_PA_FORCE_DOWNLOAD=1` 可强制走"无 Python"分支做测试。
  - 解压必须用 `%SystemRoot%\System32\tar.exe`：若 PATH 上是 Git 的 GNU tar，它会把
    `C:\...` 当成 `host:path` 去连主机 `C`，直接失败（实测退出码 2）。
- **健康检查失败要能看出原因**：服务端 `_handle_health` 会记日志并返回中文可操作提示（如「行情库缺少必要的数据表」），主进程 `waitForHealth` 把该 message 带进 `error`，界面横幅与日志都能看到 —— 不要退回成「健康检查未通过，请查看日志」这种查不出问题的写法。
- **日志必须落盘**：`server.py` 同时写 stderr 与 `<userData>/pa-agent/logs/pa_agent.log`（滚动 2MB×3）。只写 stderr 的话桌面端一关日志就没了，用户报障无从查证。健康检查被高频轮询，**同一失败原因只记一次**（否则一次启动就刷 40 行同样的 ERROR，把真正的问题挤掉）。
- **SQLite 报错要翻译**：`file is not a database` / `malformed` / `unable to open` 这类底层信息不能原样丢给用户（两侧都要处理：主进程 `market/db-config.ts` 的 `friendlyOpenError`、服务端 `_handle_health` 的 `_friendly_db_error`）。
- **主进程**：`electron/pa/`（`config.ts` 可选手工地址白名单、`server.ts` 进程托管、`client.ts` 请求与事件映射、`sse.ts` 具名 SSE 解析、`ipc.ts` 转发与状态广播）。
- **渲染层**：`store/pa.ts` + `components/pa/*`（工具栏/状态横幅/图表/流式/诊断/决策/原始）。
- **大模型配置不从服务端读**：`electron/pa/ipc.ts` 取 `loadAiConfig()`（设置 → AI 后端），随请求体传给服务端。
- **SSE 事件**：`started`/`frame_ready`/`stage_event`/`stage1_reasoning`/`stage1_content`/`stage2_reasoning`/`stage2_content`/`prompt`/`stage2_files`/`token_update`/`done`/`error`/`closed`。
- **周期仅 `1d`/`1w`/`1M`**（周/月由服务端聚合日线）。
- **坑**：① 图表容器必须**始终挂载** —— `useEChart` 只在 mount 时 init 一次，若数据未到时提前 return 掉容器，ref 为 null 且不再 init，canvas 永远不出现（空态只换文案，不换结构）；② `SplitPane` 的 `direction='horizontal'` 才是上下分栏（见组件注释：vertical 调列宽）；③ 分析流式请求**不设总超时**（本地大模型可能跑数分钟）；④ 服务未就绪时 `loadKline` 要静默跳过 —— 横幅已在说明原因，再抛一次只是重复噪音；⑤ 横幅的文案回退链要用 `||` 不能用 `??`（`installMsg` 初始值是空串，`??` 会吞掉真正的错误）；⑥ `checkDeps` 里 `done()` 引用 `timer` 前必须先声明 `timer`，否则 spawn 同步失败时会撞 TDZ，把真实原因换成 JS 报错。
- **上下文约束**：60 根 K 线 ≈ 35.6k tokens，100 根 ≈ 67.4k tokens；模型上下文不足会被网关直接拒绝（服务端已转成中文可操作提示）。
- **视觉测试**：`scripts/visual-test-pa.spec.js`（默认测 `out/`，`LOCALSTOCK_TEST_EXE=1` 测打包产物，`LOCALSTOCK_TEST_INSTALL=1` 跑联网安装场景）。

## 关键注意事项（坑）

- **策略/算法里禁用 `print()`，必须用 `log()`**：任何额外 stdout 都会破坏回测的单 JSON 输出，主进程返回错误并提示改用 log()。各模板文件头都有此注释。
- **股票代码归一化**：策略写 `600519.XSHG`，库内键是 6 位 `600519`（引擎 `code.split('.')[0]`）。`market-list-local.ts` / `tencent.ts` 的 secid 映射假设 `6→sh`、其余→sz，无科创/北交所特判。
- **`attribute_history` 的 high/low 用 close 近似**（stock_daily 核心字段无独立高低价）。
- **Windows 管道 stdout 默认 GBK**：主进程设 `PYTHONUTF8=1`，Python 脚本内 `reconfigure(encoding='utf-8')` 双保险；腾讯接口返回 GBK，用 iconv-lite 解码。
- **`docs/设计说明书.md` 描述的是备选 PyQt 方案，不是当前代码**；数据源说明以 `docs/下载数据源.md` 为准。
- **KLineChart 画线 custom series 的两个坑**（`src/components/KLineChart.tsx` 的 `makeRenderDrawingItem`）：① `params.data` 取不到对象数据项 `{value:0, d}` 的自定义字段 `d`（ECharts 处理对象型数据会丢弃），必须用 `drawings[params.dataIndex]` 从闭包数组取值；② `api.coord` 的 x 轴是 category（日期字符串），需传 `times[索引]` 的日期值而非 K 线索引，否则返回 NaN 导致线段/射线/矩形/斐波那契/通道全部不渲染（只有 hline 只用 y 而侥幸渲染）。画线数据坐标统一为 `{x: kline索引, y: 价格}`。
- **K线图底部 dataZoom 滑块会渲染成白条**：滑块 `backgroundColor` 不要用半透明白（如 `rgba(255,255,255,0.03)`），ECharts 会把它当实色渲染成纯白横条；用实色深底（如 `#1a1d22`）即可。画线管理（显示/隐藏勾选 + 删除进回收站）在 `components/drawing/DrawingManage.tsx`，`Drawing` 带 `visible`/`deleted` 标记。
- **行情库存在幸存者偏差**（Sina/AkShare 只有现存股票），长周期回测收益偏高，近 3-5 年影响小。
- **UI 风格**：全部中文文案；深色主题 CSS 变量集中在 `src/styles/globals.css`（红涨绿跌：`--up #f5222d` / `--down #14b143`）；组件复用全局类（`.stock-table`、`.chart-box`、`.detail-*`、`.backtest-*` 等），加组件优先复用而非内联样式。
