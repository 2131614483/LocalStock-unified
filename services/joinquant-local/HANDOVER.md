# 项目交接文档

> 本文档供其他 AI 或开发者快速接手本项目。阅读本文档后应能独立完成：环境搭建、启动服务、修改策略、调试回测、扩展功能。

---

## 1. 项目概述

**量化回测平台** —— 全本地运行的量化回测系统，无任何外部网络依赖。

- 用户在网页上编写 Python 策略代码
- 后端 Node.js 调用 Python 回测引擎执行策略
- 引擎使用本地 CSMAR 真实 A 股行情数据
- 回测结果存入本地 SQLite，前端图表展示

**核心约束**（不可违反）：
- 所有回测必须完全本地运行，所有数据存储在本地机器
- 不依赖任何云端 API 或在线数据源

---

## 2. 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | 原生 HTML + CSS + JS | 无框架，`index.html` / `pages/edit.html` / `pages/algorithm-list.html` / `pages/api-doc.html` |
| 图表 | Chart.js 4 + chartjs-plugin-zoom | CDN 引入，支持滚轮缩放/拖拽平移/十字光标 |
| 后端 | Node.js + Express | `server/index.js`，端口 3000 |
| 数据库 | SQLite (better-sqlite3) | 两个库：`backtest.db`（业务）+ `stock_data.db`（行情） |
| 回测引擎 | Python 3 | `engine/backtest_engine.py`，纯标准库实现 |
| 多因子引擎 | Python 3 | `engine/factor_calc_stdlib.py`，纯标准库；研究管线 pandas 双轨，共用 `factor_registry.json` |
| 每日选股 | Python 3 | `scripts/daily_stock_pick.py` + 画图/基本面/诊断，产出图文报告到 Obsidian |
| 数据源 | CSMAR 全量 + **腾讯/新浪（每日主）** + baostock（备） | 个股日线/周线/月线、指数、市场回报率、无风险利率、三大财务报表 |

---

## 3. 目录结构

```
聚宽-local/
├── server/                    # Node.js 后端
│   ├── index.js              # Express 服务入口，定义所有 API 路由
│   ├── db.js                 # backtest.db 操作模块（建表、种子数据、查询、保存结果）
│   └── stock-db.js           # stock_data.db 操作模块（行情查询、日历、搜索）
├── engine/
│   ├── backtest_engine.py    # Python 回测引擎（实现平台 API 子集 + 策略执行）
│   └── factor_calc_stdlib.py # 多因子截面计算（纯标准库，与 pandas 研究管线双轨一致）
├── assets/
│   ├── css/style.css         # 全局样式
│   └── js/
│       ├── api.js            # 前端 API 客户端封装
│       └── main.js           # 主页逻辑（图表渲染、Tab 切换、回测触发）
├── pages/
│   ├── edit.html             # 编辑策略页（代码编辑器 + 日历选日期 + 运行回测）
│   ├── algorithm-list.html   # 策略列表页（?backtest_id= 切换）
│   └── api-doc.html          # API 接口文档页
├── data/
│   ├── backtest.db           # 回测业务数据库（策略、回测记录、交易、持仓、日志）
│   └── stock_data.db         # 股票行情数据库（日线、股票信息、交易日历）[gitignored]
├── scripts/
│   ├── import-csmar-py.py    # CSMAR 日个股数据导入脚本（Python，推荐）
│   ├── import-csmar-full.py  # CSMAR 全量数据导入脚本（指数/市场/无风险利率/财务报表）
│   ├── import-csmar.js       # CSMAR 数据导入脚本（Node，备用）
│   ├── backfill_daily_tx_sina.py  # 每日增量（主）：腾讯/新浪回填 stock_daily
│   ├── update-daily-baostock.py   # 每日增量（备）：baostock
│   ├── sync_gui.py / baostock_sync.py / sync_quick.py / check_data_fresh.py  # 同步工具
│   ├── daily_stock_pick.py / fetch_fundamental.py / chart_strategies.py / optimize_factors.py  # 每日选股
│   ├── factor_research.py / validate_daily_schemes.py / multi_factor_backtest.py  # 因子研究
│   ├── test-full.js          # 全量 API + 页面测试脚本（32 项用例）
│   └── ...                   # 其他调试脚本
├── docs/
│   ├── strategy-code-standard.md  # 策略代码写作标准
│   └── project-docs/              # 项目文档源（修改后 sync-docs-obsidian.py 镜像 Obsidian）
│       ├── 项目总览 / 架构与启动 / 数据源与同步 / 多因子研究总结
│       ├── 数据同步排错经验 / GitHub同步排错经验
│       └── 每日选股/               # 每日选股报告（含 images/）
├── index.html                # 主页（回测详情页）
├── package.json              # npm 配置（包名: local_lianghua）
└── HANDOVER.md               # 本文档
```

---

## 4. 快速启动

### 前置条件
- Node.js >= 18
- Python 3.8+（需在 PATH 中，命令名 `python`）
- CSMAR 全量 CSV 数据（位于 `C:\Users\he\Downloads\数据下载解压`，含日个股/指数/市场/无风险利率/财务报表等）

### 步骤

```bash
# 1. 安装依赖
cd d:\pythonpro\聚宽-local
npm install

# 2.（首次）导入 CSMAR 日个股数据到 stock_data.db
python scripts/import-csmar-py.py

# 3.（首次）导入 CSMAR 全量数据（指数/市场/无风险利率/财务报表）
python scripts/import-csmar-full.py

# 4. 启动服务
npm start
# 或: node server/index.js

# 5. 浏览器访问
# 主页:        http://localhost:3000/
# 编辑策略:    http://localhost:3000/pages/edit.html?id=886dc04e9fe1547dac9b4b43d647ae9d
# API 文档:    http://localhost:3000/pages/api-doc.html

# 6.（可选）运行全量测试
node scripts/test-full.js
```

服务启动时会自动建表并插入种子数据（3 个策略 + 1 个示例回测）。

---

## 5. 两个数据库详解

### 5.1 backtest.db（回测业务库）

由 `server/db.js` 管理，启动时自动建表。

| 表 | 说明 | 关键字段 |
|----|------|----------|
| `users` | 用户 | id, username |
| `algorithms` | 策略 | algorithm_id, name, user_id |
| `backtests` | 回测主表 | backtest_id, algorithm_id, start_date, end_date, status, total_returns, sharpe, ... |
| `daily_records` | 每日收益（数据量最大） | backtest_id, trade_date, daily_return, cumulative_return, total_assets |
| `trades` | 交易记录 | backtest_id, trade_date, stock_code, direction, price, volume, amount |
| `positions` | 持仓快照（季度） | backtest_id, trade_date, stock_code, volume, market_value, weight |
| `logs` | 日志 | backtest_id, log_date, level, message |
| `backtest_code` | 策略代码（1:1 关联回测） | backtest_id, code, code_hash |
| `benchmark_daily_records` | 基准每日数据 | backtest_id, trade_date, daily_return, cumulative_return, excess_return |

**种子数据**：`BACKTEST_ID = '886dc04e9fe1547dac9b4b43d647ae9d'`，关联策略 `'4e5d0fa0f1dc303f9de6377e53c2064d'`（价值投资策略）。

### 5.2 stock_data.db（行情数据库）

由 `server/stock-db.js` 管理，数据来自 CSMAR 全量数据集。

| 表 | 说明 | 行数 | 关键字段 |
|----|------|------|----------|
| `stocks` | 股票基本信息 | 5,973 | stock_code（6位数字）, market_type, name |
| `stock_daily` | 日线行情（核心表） | 18,720,104 | stock_code, trade_date, open/high/low/close_price, volume, dretwd, adj_close_wd |
| `trade_calendar` | 交易日历 | 8,590 | trade_date, is_trading_day, year, month |
| `index_daily` | 指数日线 | 96,948 | index_code, trade_date, open/high/low/close_index, return_index |
| `index_info` | 指数基本信息 | 5,549 | index_code, index_name, start_date, base_date |
| `market_daily` | 日市场回报率 | 41,070 | market_type, trade_date, ret_wd_tl, ret_md_tl |
| `risk_free_rate` | 无风险利率 | 12,960 | nrr_type, end_date, rate, daily_rate |
| `stock_weekly` | 周个股回报率 | 3,929,160 | stock_code, trade_week, week_close, ret_wd |
| `stock_monthly` | 月个股回报率 | 931,391 | stock_code, trade_month, month_close, ret_wd |
| `fs_combas` | 资产负债表 | 691,492 | stock_code, acc_period, 报表科目列... |
| `fs_comins` | 利润表 | 693,188 | stock_code, acc_period, 报表科目列... |
| `fs_comscfd` | 现金流量表（直接法） | 668,774 | stock_code, acc_period, 报表科目列... |

**重要约定**：
- `stock_code` 在数据库中是 **纯 6 位数字**（如 `000001`、`600519`），不带后缀
- 策略代码中使用带后缀格式（如 `000001.XSHE`、`600519.XSHG`），引擎内部用 `.split('.')[0]` 提取数字部分
- `dretwd` 字段 = 考虑现金红利再投资的日个股回报率
- 个股数据范围：1991-06-01 ~ 2026-08-07，约 8629 个交易日
- 指数数据范围：1990-12-19 ~ 2026-08-07（沪深300从2005-04-08起）
- `index_code` 同样为纯 6 位数字（如 `000300` 沪深300、`000001` 上证综指）
- 财务报表表结构为动态列（前6列固定：stock_code/short_name/acc_period/report_type/if_correct/declare_date，其余为科目代码列）

**增量更新说明**（2026-08-12 起双轨）：
- 历史数据来自 CSMAR；06-13 之后的新数据每日增量补充。
- **主源（腾讯/新浪）**：`scripts/backfill_daily_tx_sina.py`（纯 urllib，无需 baostock）——腾讯 `fqkline`（**bfq 不复权**）+ 新浪 `getKLineData` 兜底，`INSERT OR IGNORE` 补 `stock_daily` 缺失日，全市场 ~6 分钟。口径：volume 手×100=股、amount=vol×close 估算、pre_close 逐 K 线链式更新。**只补 stock_daily，不写 trade_calendar/index_daily**（报告 1.1 指数表为空，用腾讯指数替代）。
- **备源（baostock）**：`scripts/update-daily-baostock.py` 补 `trade_calendar`/`index_daily`/股票名称口径（须系统 Python311）。baostock 服务端间歇性故障（`query_trade_dates` 行迭代无超时挂起/WinError 10057/login 10002007）——故障时跳过不阻塞，用腾讯/新浪。排错详见 `docs/project-docs/数据同步排错经验.md`。
- baostock 段字段近似：`dretwd/dretnd` = close/preclose-1，`adj_close_wd/nd` = close，`mkt_cap_total` = NULL；腾讯回填段同近似。
- **覆盖限制**：baostock 无 B 股（200/900）与北交所（8/4/920）数据（约 383 只止于 06-12）；腾讯回填对 920xxx 等失败自动跳过；停牌股数据止于停牌日。
- **GUI 工具**：`scripts/sync_gui.py`（Tkinter，**默认数据源=腾讯/新浪**，`--source baostock` 可切回；含进度/日志/注册计划任务）；`--silent` 供计划任务，`--register` 注册每日 18:00 任务 QuantBacktestDataSync。`数据同步.exe` 是启动器，改 sync_gui.py 后需 PyInstaller 重打包。

---

## 6. 回测流程（核心链路）

```
用户点击"运行回测"
    │
    ▼
前端 main.js / edit.html
    │  POST /api/backtest/:id/run  { startDate, endDate, capitalBase }
    ▼
server/index.js（路由处理）
    │  1. 校验日期范围（从 stock_data.db 的 trade_calendar 获取）
    │  2. 从 backtest.db 取策略代码
    │  3. execFile('python', [enginePath, '--code', code, '--start', ...])
    ▼
engine/backtest_engine.py（Python 子进程）
    │  1. 连接 stock_data.db
    │  2. 执行策略代码中的 initialize(context)
    │  3. 遍历交易日，按 run_daily 调度 rebalance 等函数
    │  4. 模拟下单（计算手续费、滑点）
    │  5. 记录每日收益、交易、持仓、基准
    │  6. 计算风险指标（总收益、年化、夏普、最大回撤、波动率）
    │  7. 输出 JSON 到 stdout
    ▼
server/index.js（接收结果）
    │  queries.saveBacktestResult(backtestId, result)
    │  → 写入 daily_records, trades, positions, logs, benchmark_daily_records
    │  → 更新 backtests 表的指标字段
    ▼
前端接收响应，刷新页面展示结果
```

### 引擎命令行用法

```bash
python engine/backtest_engine.py \
  --code "def initialize(context): ..." \
  --start 2023-01-01 \
  --end 2023-12-31 \
  --capital 1000000
```

输出为 JSON，结构见引擎文件末尾 `_calculate_metrics` 方法的 return。

---

## 7. 回测引擎支持的 API

引擎在 `backtest_engine.py` 的 `run()` 方法中构造 `env` 字典，注入以下函数供策略代码调用：

| API | 说明 |
|-----|------|
| `set_benchmark(code)` | 设置基准（如 `000300.XSHG`） |
| `set_slippage(slippage)` | 设置滑点（`FixedSlippage(0.002)`） |
| `set_order_cost(cost, type)` | 设置手续费（`OrderCost(close_tax=0.001, ...)`） |
| `run_daily(fn, time)` | 每日定时调度 |
| `run_weekly(fn, weekday, time)` | 每周调度 |
| `run_monthly(fn, monthday, time)` | 每月调度 |
| `attribute_history(stock, count, unit, fields)` | 获取历史行情（返回 SeriesDict） |
| `get_price(security, end_date, count, frequency, fields)` | 获取历史价格 |
| `order_target_value(stock, value)` | 调整至目标金额 |
| `order_target(stock, amount)` | 调整至目标股数 |
| `order(stock, amount)` | 按股数下单 |
| `log.info/warn/error(msg)` | 日志记录 |
| `g` | 全局参数对象（策略在 initialize 中设置，如 `g.short_window = 5`） |
| `context.portfolio` | 投资组合（`total_value`, `available_cash`, `positions`, `current_dt`） |
| `context.portfolio.positions` | 持仓字典，键为股票代码 |

**策略必须包含 `initialize(context)` 函数**，可选 `handle_data`、`before_trading_start`、`after_trading_end`。

### 引擎命名约定（重要）

引擎从 `g` 对象提取策略参数，**命名必须遵守**：
- `g.stocks` — 股票池列表
- `g.short_window` / `g.long_window` — 均线周期
- 其他自定义参数可自由命名

### 基准数据获取逻辑（重要）

引擎基准价格获取优先级（`backtest_engine.py` `get_index_price_on_date` + 基准循环逻辑）：
1. **优先查 `index_daily` 表**（真实指数数据，如沪深300）
2. 若指数表无此基准 → 尝试 `stock_daily` 表（把基准代码当个股查，兼容 `.XSHG`/`.XSHE`）
3. 若仍无数据 → 回退到其他指数 `000016`（上证50）→ `000905`（中证500）
4. 若全无指数数据 → 回退到策略股票池 `g.stocks[0]`

回退时会输出 warning 日志。`_bench_fallback` 和 `_bench_use_index` 标记后续交易日继续使用回退标的。

### 已知限制

- 不支持期货、期权、可转债
- 不支持分钟级回测（仅日线 `day`）
- 不支持融资融券
- `attribute_history` 的 high/low 字段用 close 近似（CSMAR 核心字段无高低价映射）

---

## 8. API 接口清单

### 回测业务接口（backtest.db）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/algorithm/list` | 策略列表 |
| GET | `/api/backtest/:id/summary` | 回测概要（指标卡片） |
| GET | `/api/backtest/:id/returns` | 策略收益时序 |
| GET | `/api/backtest/:id/trades` | 交易详情 |
| GET | `/api/backtest/:id/positions` | 每日持仓 |
| GET | `/api/backtest/:id/benchmark` | 基准收益 + 超额收益 |
| GET | `/api/backtest/:id/logs?level=info` | 日志（可按级别过滤） |
| GET | `/api/backtest/:id/code` | 策略代码 |
| POST | `/api/backtest/:id/code` | 保存策略代码 |
| POST | `/api/backtest/:id/run` | 运行回测 |
| GET | `/api/backtest/:id/export?type=transaction` | 导出 CSV（transaction/positions/returns） |

### 行情数据接口（stock_data.db）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stock/:code/daily?start=&end=` | 单股日线 |
| POST | `/api/stock/batch/daily` | 批量查询 |
| GET | `/api/stock/market/:date` | 全市场快照 |
| GET | `/api/stock/search?q=` | 搜索股票 |
| GET | `/api/stock/:code/return?start=&end=` | 收益率计算 |
| GET | `/api/calendar?year=` | 交易日历 |
| GET | `/api/calendar/range` | 日历范围（最早/最晚交易日） |
| GET | `/api/calendar/month?year=&month=` | 某月交易日（日历组件用） |
| GET | `/api/stats` | 数据库统计 |

### 指数与宏观数据接口（stock_data.db）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/index/:code/daily?start=&end=` | 指数日线数据（用于基准选择器） |
| GET | `/api/index/search?q=` | 搜索指数（按代码或名称） |
| GET | `/api/risk-free-rate?start=&end=` | 无风险利率时序 |
| GET | `/api/market/daily?start=&end=` | 市场回报率时序 |

**响应格式统一**：`{ code: 0, data: ..., message: 'success' }`，错误时 `code: -1`。

---

## 9. 前端页面说明

### 9.1 主页 `index.html`（回测详情）

- 顶部导航栏（首页 / 量化研究平台 / 量化社区 / API文档）
- 策略信息栏（策略名、回测期间、初始资金、频率）
- 指标卡片（10 张）：
  - 策略指标：总收益率、年化收益率、最大回撤、夏普比率
  - **基准指标卡片**（绿色左边框）：基准收益（带基准名称标签）
  - **超额收益卡片**（橙色左边框）：超额收益 = 策略总收益 - 基准总收益
  - 风险指标：Alpha、Beta、波动率、胜率
- 图表区（4 个 Chart.js 图表，均支持滚轮缩放/拖拽平移/双击重置）：
  - **策略收益 Tab**：累计收益率曲线 + 每日收益率柱状图
  - **基准收益 Tab**：
    - **基准选择器**（下拉框）：可动态切换对比指数，无需改代码重跑
      - 默认"回测原始基准"（策略代码 `set_benchmark` 指定）
      - 常用指数：沪深300、上证综指、深证成指、上证180、深证综合、深证100、中证A100、上证A股
      - 切换后实时调用 `/api/index/:code/daily` 重绘对比图、超额收益图、基准摘要
    - 策略 vs 基准累计收益对比图
    - 超额收益柱状图
    - 基准摘要卡片（基准名称、总收益、年化、最大回撤）
- Tab 切换：策略收益 / 交易详情 / 每日持仓收益 / 基准收益 / 日志输出 / 策略代码
- 操作按钮：编辑策略 / 运行回测 / 模拟交易

### 9.2 编辑策略页 `pages/edit.html`

- 代码编辑器（textarea，显示行号、字符数）
- 回测参数区（开始日期、结束日期、初始资金、频率）
- **日历组件**：点击日期输入框弹出，交易日蓝色可点击，非交易日灰色不可选
- 数据范围提示（从 `/api/calendar/range` 获取）
- 操作按钮：保存代码 / 重置 / 运行回测 / 返回

### 9.3 API 文档页 `pages/api-doc.html`

- 静态展示所有 API 端点、请求参数、响应格式
- 包含 Python SDK 和策略 API 说明

---

## 10. 图表缩放功能

4 个图表均配置了以下交互（同花顺 K 线图风格）：

| 操作 | 效果 |
|------|------|
| 鼠标滚轮 | 以鼠标位置为中心缩放 X 轴 |
| 左键拖拽 | 左右平移查看不同时间段 |
| 鼠标悬停 | 显示十字光标（虚线竖线）+ tooltip |
| 双击图表 | 重置缩放 |
| 点击"重置缩放"按钮 | 重置缩放 |

**实现位置**：
- `main.js` 顶部：`crosshairPlugin`（十字光标）、`ZOOM_OPTIONS`（缩放配置）、`resetZoom()` 函数
- `index.html`：引入 `hammer.js` + `chartjs-plugin-zoom`，每个图表标题旁有重置按钮
- 图表配置 `pointRadius: 0`（默认不显示点，悬停时显示），移除了数据采样显示全部数据点

---

## 11. 常见问题与陷阱

### 11.1 修改策略代码后收益不变

**原因**：确认点击"运行回测"触发了 Python 引擎（`POST /api/backtest/:id/run`），而不是旧的 JS 模拟引擎。

**排查**：查看 `server/index.js` 的 `/run` 路由是否调用 `execFile('python', ...)`。

### 11.2 SeriesDict 报错（`.mean()` 失败）

**历史 Bug**：`attribute_history` 返回的 `hist['close']` 是 list 而非 Series，导致 `.mean()` 报错。

**修复**：`backtest_engine.py` 中 `SeriesDict` 类的 `_data` 必须存为 `pd.Series` 或自定义 Series。查看 `SeriesDict` 类实现确认。

### 11.3 基准/超额收益为空

**原因**：`stock_data.db` 中没有指数数据（如 000300 沪深300）。

**修复**：引擎已添加回退逻辑——基准无数据时依次尝试 000016（上证50）→ 000905（中证500）→ 策略首只股票。回退时会输出 warning 日志。

### 11.4 浏览器显示旧内容（缓存问题）

**原因**：浏览器缓存了旧版 HTML/JS。

**解决**：URL 加时间戳参数 `?_t=Date.now()`，或 fetch 使用 `cache: 'no-store'`。

### 11.5 日期范围校验失败

回测日期必须在 `/api/calendar/range` 返回的范围内（1991-06-01 ~ 2026-08-07），且开始日期不能晚于结束日期。

### 11.6 CSMAR 数据导入

- CSV 文件须位于 `D:\pythonpro\股票日数据`，文件名以 `trd_dalyr` 开头
- 导入脚本：`python scripts/import-csmar-py.py`（Python 版，比 Node 版快 3-5 倍）
- 导入前会清空 `stock_daily` 表

---

## 12. 测试

### 全量测试脚本

```bash
node scripts/test-full.js
```

覆盖 32 项用例：
- 页面静态资源（7 项）
- 回测业务 API（9 项）
- 股票行情 API（8 项）
- 回测链路（2 项）
- 数据更新验证（4 项）
- 异常处理（2 项）

### 手动测试要点

1. 主页"运行回测"按钮 → 应出现遮罩 → 回测完成后指标卡片更新
2. 编辑策略页修改代码 → 运行回测 → 收益应随代码变化
3. 日历组件 → 交易日蓝色可点击，非交易日灰色
4. 图表滚轮缩放、拖拽平移、双击重置
5. 各 Tab 切换正常，数据正确加载
6. 导出 CSV 功能（Excel 可打开，UTF-8 编码）

---

## 13. 扩展指南

### 添加新策略

1. 在 `backtest.db` 的 `algorithms` 表插入新策略记录
2. 在 `backtests` 表插入关联的回测记录
3. 在 `backtest_code` 表插入策略代码
4. 访问 `http://localhost:3000/pages/edit.html?id=<新回测ID>`

### 添加新 API

1. `server/db.js` 或 `server/stock-db.js` 中添加查询函数
2. `server/index.js` 中添加路由
3. `assets/js/api.js` 中添加前端调用方法
4. `pages/api-doc.html` 中补充文档

### 添加新图表

参考 `main.js` 中现有图表的写法：
- 使用 `ZOOM_OPTIONS` 配置缩放
- 添加 `crosshairPlugin` 到 plugins 数组
- HTML 容器加"重置缩放"按钮
- `resetZoom()` 函数中添加新图表的映射

### 引擎添加新 API

在 `backtest_engine.py` 的 `BacktestEngine` 类中：
1. 实现 `api_xxx` 方法
2. 在 `run()` 方法的 `env` 字典中注册
3. 在文件顶部注释中补充说明

---

## 14. 关键 ID 速查

| 名称 | 值 |
|------|-----|
| 示例回测 ID | `886dc04e9fe1547dac9b4b43d647ae9d` |
| 价值投资策略 ID | `4e5d0fa0f1dc303f9de6377e53c2064d` |
| 动量策略 ID | `9587ef3ae77e63836b79ddbbb903980c` |
| 均值回归策略 ID | `cdfabeb2fdbd3e2a4289b70e3818445e` |
| 示例用户 ID | `1`（username: trader001） |

---

## 15. 版本历史要点

1. 最初使用 JS 模拟回测引擎（固定逻辑，修改代码不改变收益）→ 已废弃
2. 改为 Python 真实回测引擎，调用 CSMAR 数据
3. 修复 SeriesDict bug（hist['close'] 返回 list 导致 .mean() 失败）
4. 添加日历组件（交易日可选、非交易日灰色）
5. 品牌替换："聚宽"/"JoinQuant" → "量化回测平台"
6. 数据库重命名：`joinquant.db` → `backtest.db`，`csmar.db` → `stock_data.db`
7. npm 包名：`joinquant-local` → `local_lianghua`
8. 添加图表缩放功能（滚轮缩放 + 拖拽平移 + 十字光标 + 双击重置）
9. 修复基准收益为空问题（000300 无数据，回退到 000016）

---

## 16. 相关文档

- [策略代码写作标准](docs/strategy-code-standard.md) — 编写策略的规范
- [数据库设计](database-design.md) — 表结构详细设计
- [数据采集指南](data-collection-guide.md) — CSMAR 数据获取方式
- [数据迁移指南](data-migration-guide.md) — 数据库迁移说明
- [项目总览 / 架构与启动 / 数据源与同步 / 多因子研究总结](docs/project-docs/) — 项目文档源，修改后运行 `python scripts/sync-docs-obsidian.py` 镜像到 Obsidian
- [数据同步排错经验](docs/project-docs/数据同步排错经验.md) — baostock 故障/腾讯新浪回填口径
- [GitHub 同步排错经验](docs/project-docs/GitHub同步排错经验.md) — 代理 7897/非沙箱推送

---

## 17. 多因子量化与每日选股体系

### 17.1 双轨架构

| 轨 | 位置 | 技术 | 用途 |
|----|------|------|------|
| 研究管线 | `scripts/` | pandas（系统 Python311） | 因子发现/IC/分层/相关性/方案验证 |
| 生产引擎 | `engine/factor_calc_stdlib.py` | 纯标准库 | 网页/每日选股复现 |

**共用 `scripts/factor_registry.json`**（约 20 因子唯一权威定义：动量/反转/波动/流动性/技术/规模/价值/质量/成长），`verify_factor_consistency.py` 校验两轨偏差 ≤0.001。

**无未来函数三铁律**：基本面用「报告期+4 个月滞后」；动量 skip 最近 20 交易日；股票池剔除 ST/涨跌停/停牌/次新(<120日)/B股/北交所/金融股。

**关键数据口径**：`mkt_cap_total` 单位千元（×1000 转元）；归母净利润 = `B002000101`；`high/low` baostock 段全 NULL。

### 17.2 每日选股流水线（图文报告一~十节）

```
1. 数据同步（腾讯/新浪回填，~6 分钟）   → 第 1 步（skill）
2. daily_stock_pick.py 打分 top-N        → 第 2 步
   报告一~六：市场概况 / 方案+2.1因子公式 / top-50 / 组合画像 / 前10理由 / 口径风险
3. fetch_fundamental.py                  → 七 基本面与估值快照（腾讯 PE/PB/市值 + CSMAR 财务）
4. chart_strategies.py                   → 八 技术面图（布林带/海龟/当日表现/组合净值 → images/）
5. optimize_factors.py                   → 九 因子诊断（历史名单追踪 picks_history.json / 周频IC / 月度面板校验）
6. 写 docs/project-docs/每日选股/ + Obsidian「量化回测平台/每日选股/」
7. Claude 追加 十 亮点点评（skill 第 4 步）
```

- 方案：`smallcap`（默认，bp0.3+ep0.2+roe0.15+毛利0.1+现金流0.1+低波0.15+ln_cap0.10，N50，2018-2026 验证 +12.8% 夏普+0.02）；`smallcap30`/`multifactor`/`value` 可选。
- skill：`C:\Users\he\.claude\skills\daily-stock-pick\SKILL.md`（完整流程：同步→报告→实时→点评）。
- 评分：每因子 [1%,99%] 缩尾 → z-score → 乘方向×权重加权求和 → 缺失贡献 0。
- 防过拟合：因子权重**只月度复核、不日更**（`optimize_factors` 仅给建议）。

### 17.3 腾讯行情基本面字段（fetch_fundamental 用）

| 字段 | 含义 |
|------|------|
| f[39] | PE_TTM |
| f[44] | A股市值（亿） |
| f[45] | 总市值含H（亿） |
| f[46] | PB |
| 注意 | 腾讯行情 gbk 编码；财报 JSON 接口不可用，财务指标用 CSMAR 季度 |

### 17.4 关键脚本清单

| 脚本 | 用途 |
|------|------|
| `daily_stock_pick.py` | 每日选股主脚本（纯标准库） |
| `fetch_fundamental.py` / `chart_strategies.py` / `optimize_factors.py` | 报告七/八/九节联动 |
| `backfill_daily_tx_sina.py` / `update-daily-baostock.py` | 数据同步主/备 |
| `check_data_fresh.py` / `sync_quick.py` / `fetch_realtime.py` | 数据新鲜度/探针/实时行情新闻 |
| `factor_research.py` / `validate_daily_schemes.py` / `multi_factor_backtest.py` | 因子研究/方案验证 |
| `seed_strategies.py` / `scripts/strategies/` | 策略库入库 |
