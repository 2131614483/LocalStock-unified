# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

全本地量化回测平台：Node.js (Express) + SQLite 提供 REST API，Python 引擎执行用户策略代码，前端原生 HTML/JS + Chart.js。所有数据本地存储，无外部网络依赖。

**最权威文档是 `HANDOVER.md`（交接文档，含最新架构）与 `README.md`，改动架构前先读它们。**

## 常用命令

```bash
npm start
npm run dev
node scripts/test-full.js # 全量 API + 页面测试（32 项用例）
python scripts/import-csmar-py.py # 导入日个股数据（推荐，比 Node 版快 3-5 倍）
python scripts/import-csmar-full.py # 导入指数/市场/无风险利率/财务报表
node scripts/import-csmar.js # Node 备用导入版
python scripts/update-daily-baostock.py # 增量更新 baostock 日线（须用系统 Python311 运行）
python scripts/backfill_daily_tx_sina.py # 腾讯/新浪日线回填（默认数据源，baostock 故障兜底）
python scripts/sync_gui.py # 同步 GUI（默认腾讯/新浪，--source baostock 可切回；--silent 供计划任务 / --register 注册每日任务）
python scripts/sync-docs-obsidian.py # 项目文档镜像到本地 Obsidian（修改 docs/project-docs/ 后运行）
python scripts/inspect-db.py # 检查 stock_data.db
# —— 多因子量化管线（研究用系统 Python311，有 pandas）——
python scripts/factor_research.py      # 因子研究：IC/分层/相关性 → docs/project-docs/factor_report_*.md
python scripts/multi_factor_backtest.py # 多因子组合回测横向对比（参数迭代）
python scripts/verify_factor_consistency.py # 研究管线(pandas) vs web引擎(stdlib) 因子一致性
python scripts/seed_strategies.py     # 策略库入库（读取 scripts/strategies/*.py 写入 backtest.db）
python scripts/validate_daily_schemes.py # 每日选股候选方案历史验证（2018-2026 面板）
python scripts/daily_stock_pick.py    # 每日选股：多因子打分 top-N → 图文报告（docs+Obsidian），自动联动画图与因子诊断
python scripts/chart_strategies.py    # 技术面图：布林带/海龟通道/当日表现/组合净值（daily_stock_pick 自动调用，报告第八节）
python scripts/optimize_factors.py    # 因子诊断与优化：历史名单追踪/IC/月度权重校验（daily_stock_pick 自动调用，报告第九节）
python scripts/fetch_fundamental.py   # 基本面与估值快照：腾讯实时 PE/PB/市值 + CSMAR 财务（daily_stock_pick 自动调用，报告第七节）
```

无 lint / build / 单元测试。Windows 可用 `启动.bat` 启动（隔离系统 Node.js、日志写 server.log）。引擎可单独调试：`python engine/backtest_engine.py --code "..." --start ... --end ... --capital 1000000`。

**同步脚本必须用系统 Python311 运行**（baostock 只装在那里；PATH 里的 `python` 是 hermes venv，无 baostock）：
`C:\Users\he\AppData\Local\Programs\Python\Python311\python.exe scripts/sync_gui.py`。
- `sync_gui.py`：Tkinter GUI（状态/进度/日志，可注册每日计划任务）；**默认数据源 = 腾讯/新浪**（`scripts/backfill_daily_tx_sina.py`，与 daily-stock-pick skill 一致、稳定免登录），`--source baostock` 可切回 baostock；`--silent` 转到 `unified_data_sync.py`，统一补齐股票日线、交易日历与 AI 数据状态；`--register` 注册每日 18:00 任务 QuantBacktestDataSync。
- **`数据同步.exe`**（项目根目录）：启动器，双击即用系统 Python311 打开同步 GUI。**重新打包**（改 sync_gui.py 后 exe 需重打包才生效）：`Python311\python.exe -m PyInstaller --onefile --noconsole --name 数据同步 launcher.py`。
- 核心逻辑两轨：**腾讯/新浪** `scripts/backfill_daily_tx_sina.py`（urllib、bfq 不复权、volume 手×100、amount=vol×close 估算、pre_close 逐 K 线更新、只补 stock_daily）为默认；**baostock** `scripts/baostock_sync.py`（INSERT OR IGNORE 不清库、断点续传、并发锁 data/sync.lock、socket 30s 超时防挂起、补 trade_calendar/index_daily）为备选。baostock 服务端间歇性故障（`query_trade_dates` 行迭代无超时挂起、WinError 10057、login 10002007），排错见 `docs/project-docs/数据同步排错经验.md`。

## 架构

### 回测链路（核心，需跨文件理解）

前端（main.js）→ `POST /api/backtest/:id/run` → `server/index.js` 用 `execFile('python', [engine/backtest_engine.py, '--code', ...])` 起 Python 子进程 → 引擎读 stock_data.db 执行策略 → 输出 JSON 到 **stdout** → `server/db.js` 的 `queries.saveBacktestResult()` 写入 backtest.db → 前端刷新。

关键约束：
- 引擎 stdout 必须是**纯 JSON**，任何多余 print 都会导致 `server/index.js` 的 `JSON.parse` 失败（常见 bug 源）。
- Python 3.8+ 需在 PATH，命令名必须是 `python`。
- `/run` 超时 120s、maxBuffer 50MB。

### 两个数据库

| 库 | 管理模块 | 作用 | 数据量 |
|----|---------|------|--------|
| `data/backtest.db` | `server/db.js` | 业务库：users / algorithms / backtests / daily_records / trades / positions / logs / backtest_code / benchmark_daily_records，启动时自动建表+种子数据 | 小（百级） |
| `data/stock_data.db` | `server/stock-db.js` | 行情库：stocks / stock_daily（1850 万行核心表）/ trade_calendar / index_daily / index_info / market_daily / risk_free_rate / stock_weekly / stock_monthly / 财务报表 | 大（千万级） |

### 回测引擎（engine/backtest_engine.py，纯 Python 标准库）

- 用 `exec(code_str, env)` 执行用户策略代码，`env` 注入平台 API（set_benchmark / run_daily / attribute_history / order_target_value / get_price / log / g / context 等），见 `run()` 方法。
- 策略必须定义 `initialize(context)`；`run_daily/run_weekly/run_monthly` 注册调度，主循环逐交易日执行。
- `SeriesDict` / `Series` 是 pandas 的极简替代（仅支持切片、`.mean()`、`len()`）。历史 bug：`attribute_history` 的字段必须存为 Series，否则 `.mean()` 报错。
- 指标计算在 `_calculate_metrics()`，返回结构即后端 `saveBacktestResult` 消费的 JSON 格式。

## 关键约定（易踩坑）

- **股票代码格式**：数据库存纯 6 位（`000001`、`600519`）；策略代码用带后缀格式（`000001.XSHE`、`600519.XSHG`）；引擎内部用 `.split('.')[0]` 提取数字。`server/stock-db.js` 的查询也须传纯 6 位。
- **基准数据解析**：引擎优先查 `index_daily` 表；无数据时回退到 `stock_daily`（把基准当个股查）→ 其他指数 `000016`/`000905` → 策略 `g.stocks[0]`。回退标记 `_bench_fallback`/`_bench_use_index` 决定后续取价路径；单日缺失用前一有效值前向填充。
- **策略参数命名**：引擎从 `g` 对象读取 `g.stocks`（股票池）、`g.short_window`/`g.long_window`（均线周期），命名必须一致。
- **`dretwd`** = 考虑现金红利再投资的日个股回报率；`attribute_history` 的 high/low 字段用 close 近似（CSMAR 核心字段无高低价）。
- 引擎不支持期货/期权/可转债、分钟级（仅日线 day）、融资融券。
- 数据导入脚本会**清空 stock_daily 表**后重建；增量脚本 `update-daily-baostock.py`（baostock 源）则只 INSERT OR IGNORE。
- baostock 增量段无 B 股/北交所（约 383 只止于 06-12）、`dretwd` 用涨跌幅近似；主板块 A 股全覆盖到最新。
- 种子数据：示例回测 `886dc04e9fe1547dac9b4b43d647ae9d`，价值投资策略 `4e5d0fa0f1dc303f9de6377e53c2064d`，用户 trader001。
- 历史版本曾用 JS 模拟回测引擎（改代码收益不变），已废弃，勿回归。

### 前端

- 原生 HTML/CSS/JS + Chart.js，无框架。静态资源由 `server/index.js` 的 `express.static(path.join(__dirname, '..'))` 从**项目根目录**提供（页面路径直接是 `/index.html`、`/pages/edit.html`）。
- `assets/js/main.js`：图表用 `crosshairPlugin`（十字光标）+ `ZOOM_OPTIONS`（滚轮缩放/拖拽平移），每个图表带"重置缩放"按钮。
- `assets/js/api.js`：前端 API 客户端（ApiClient），新增 API 时同步加方法。
- 编辑策略页 `pages/edit.html`：日历组件从 `/api/calendar/month` 取交易日，非交易日不可选。

## 添加新 API（四处联动）

1. `server/db.js` 或 `server/stock-db.js` 加查询函数
2. `server/index.js` 加路由
3. `assets/js/api.js` 加前端调用方法
4. `assets/js/main.js` 加渲染逻辑

## 文档索引

## 多因子体系（研究管线 + 生产引擎）

**双轨架构**：研究管线（`scripts/`，pandas，系统 Python311）做因子发现与组合迭代；生产引擎（`engine/factor_calc_stdlib.py` 纯标准库 + `backtest_engine.py` 新增跨截面 API）在网页复现。两轨**共用 `scripts/factor_registry.json` 因子定义**，`scripts/verify_factor_consistency.py` 校验两轨因子值偏差 ≤0.001。

- **因子**：约 20 个（动量/反转/波动/流动性/技术/规模/价值/质量/成长）。无未来函数三铁律：基本面用「报告期+4 个月滞后」、动量 skip 最近 20 交易日、股票池剔除 ST/涨跌停/次新/B股/北交所/金融股。
- **引擎新增 API**：`get_all_stocks` / `get_factors` / `get_factor` / `rank_normalize` / `order_target_percent`（策略代码里可直接全市场打分选股）。
- **策略库**：`scripts/strategies/`（动量/价值/质量/成长/低波/多因子综合 6 个方向），`scripts/seed_strategies.py` 入库 backtest.db。
- **关键数据口径**：`mkt_cap_total` 单位**千元**（×1000 转元）；利润表归母净利润 = `B002000101`（非 B002100000）；`high/low` 全 NULL 不能用振幅类因子。
- **前端策略列表页**：`pages/algorithm-list.html`；`index.html` 用 `?backtest_id=` 切换策略（不再硬编码）。

## 文档索引

- `HANDOVER.md` — 交接文档，最完整（回测流程 / API 清单 / 关键 ID / 常见问题与陷阱）
- `docs/project-docs/` — 项目文档源（项目总览/架构与启动/数据源与同步），**修改后运行 `python scripts/sync-docs-obsidian.py` 镜像到本地 Obsidian「量化回测平台」文件夹**
- `docs/strategy-code-standard.md` — 策略代码写作标准
- `database-design.md` / `data-migration-guide.md` / `data-collection-guide.md` — 库表结构与数据导入
- `prompts/troubleshooting-prompts.md` — 排错提示词
