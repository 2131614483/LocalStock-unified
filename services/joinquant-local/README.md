# 量化回测平台 (Quant Backtest Platform)

> 全本地运行的量化回测数据管理与展示系统
> 本地数据存储 | 回测结果可视化 | 全市场股票日线数据

---

## 目录

1. [项目概述](#项目概述)
2. [技术栈](#技术栈)
3. [项目结构](#项目结构)
4. [快速开始](#快速开始)
5. [核心功能](#核心功能)
6. [架构设计](#架构设计)
7. [API 接口](#api-接口)
8. [数据库设计](#数据库设计)
9. [数据导入](#数据导入)
10. [已有文档索引](#已有文档索引)

---

## 项目概述

本项目是一个本地化的量化交易数据管理与展示平台，提供以下核心能力：

- **回测结果可视化**：展示平台回测的收益曲线、交易明细、持仓记录、基准对比等
- **多因子量化体系**：研究管线（IC/分层/相关性）→ 因子注册表 → 生产引擎双轨，每日选股打分
- **每日选股图文报告**：多因子 top-N → 一~十节报告（因子公式/基本面快照/技术面图/因子诊断/名单追踪）→ Obsidian
- **本地股票数据存储**：导入 CSMAR 日个股回报率数据（约 1870 万条），支持本地查询
- **每日数据同步**：腾讯/新浪为主（免登录、快）、baostock 备选，支持计划任务自动同步
- **RESTful API**：提供统一的 HTTP 接口，供前端或其他客户端调用
- **前端展示页面**：基于 Chart.js 的图表展示，支持策略收益、基准对比、日志查看等

### 适用场景

- 量化策略开发者：本地查看回测结果，分析策略表现
- 数据研究者：本地存储全市场 A 股日线数据，免去重复请求云端
- **每日选股**：本地全市场多因子截面打分 → 图文报告，附基本面/技术面/因子诊断
- 离线环境：无需联网即可查询历史股票数据和回测结果

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **后端框架** | Express.js (Node.js) | HTTP 服务端 |
| **数据库** | SQLite 3 | 本地文件存储，零配置 |
| **数据库驱动** | better-sqlite3 | 同步 API，性能优秀 |
| **前端页面** | HTML + CSS + JavaScript | 原生实现 |
| **图表库** | Chart.js | 策略收益曲线、柱状图等 |
| **回测引擎** | Python 3（纯标准库） | 执行策略代码，读本地行情 |
| **多因子引擎** | Python `factor_calc_stdlib.py` | 全市场因子截面计算（纯标准库） |
| **研究管线** | Python pandas + matplotlib | 因子研究、每日选股画图（系统 Python311） |
| **数据导入** | Node.js + CSV 流式读取 | 支持千万级数据逐批写入 |

---

## 项目结构

```
聚宽-local/
│
├── server/                       # 后端服务
│   ├── index.js                  # Express 服务入口，定义所有 API 路由
│   ├── db.js                     # 回测数据库模块 (backtest.db)
│   └── stock-db.js               # 股票日线数据库模块 (stock_data.db)
│
├── engine/                       # Python 引擎
│   ├── backtest_engine.py        # 回测引擎（纯标准库，注入平台 API）
│   └── factor_calc_stdlib.py     # 多因子截面计算（纯标准库，与 pandas 双轨一致）
│
├── assets/                       # 前端资源
│   ├── css/style.css             # 全局样式
│   └── js/
│       ├── api.js                # 前端 API 客户端 (ApiClient)
│       └── main.js               # 回测详情页脚本 (Tab 切换、数据渲染、图表)
│
├── scripts/                      # 工具脚本
│   ├── import-csmar-py.py        # CSMAR 日个股导入（Python，推荐）
│   ├── import-csmar-full.py      # CSMAR 全量导入（指数/市场/无风险利率/财报）
│   ├── backfill_daily_tx_sina.py # 每日增量（主）：腾讯/新浪回填 stock_daily
│   ├── update-daily-baostock.py  # 每日增量（备）：baostock
│   ├── sync_gui.py / baostock_sync.py / sync_quick.py / check_data_fresh.py  # 同步工具
│   ├── daily_stock_pick.py       # 每日选股：打分 top-N → 图文报告
│   ├── fetch_fundamental.py      # 基本面与估值快照（腾讯 PE/PB/市值 + CSMAR 财务）
│   ├── chart_strategies.py       # 技术面图（布林带/海龟/组合净值）
│   ├── optimize_factors.py       # 因子诊断（名单追踪/IC/月度校验）
│   ├── factor_research.py / multi_factor_backtest.py / validate_daily_schemes.py  # 因子研究
│   ├── seed_strategies.py        # 策略库入库
│   └── test-full.js              # 全量 API + 页面测试
│
├── pages/                        # 前端页面
│   ├── edit.html                 # 编辑策略页
│   ├── algorithm-list.html       # 策略列表页
│   └── api-doc.html              # API 文档页面
│
├── docs/
│   ├── strategy-code-standard.md # 策略代码写作标准
│   └── project-docs/             # 项目文档源（同步到 Obsidian）
│       ├── 项目总览 / 架构与启动 / 数据源与同步 / 多因子研究总结
│       ├── 数据同步排错经验 / GitHub同步排错经验
│       └── 每日选股/             # 每日选股报告（含 images/）
│
├── index.html                    # 主页面 - 回测详情展示
├── data/                         # 数据库目录（运行时生成，gitignored）
│   ├── backtest.db              # 回测数据库
│   └── stock_data.db            # 股票日线数据库 (~6GB)
│
├── CLAUDE.md                     # AI 协作指南（最常用）
├── HANDOVER.md                   # 交接文档（最完整）
├── README.md                     # 本文档
├── database-design.md            # 回测数据库设计文档
├── data-collection-guide.md      # 数据收集指南
└── data-migration-guide.md       # CSMAR 数据迁移方案
```

---

## 快速开始

### 前置要求

- Node.js >= 18
- npm >= 9

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 导入 CSMAR 股票日线数据（可选，约 1850 万行）
#    数据源: D:\pythonpro\股票日数据\*.csv
node scripts/import-csmar.js

# 3. 验证数据导入（可选）
node scripts/query-test.js

# 4. 启动服务
npm start
# 服务启动在 http://localhost:3000
```

### 访问页面

- **主页面（回测详情）**：http://localhost:3000/
- **API 文档页**：http://localhost:3000/pages/api-doc.html

---

## 核心功能

### 1. 回测结果展示

主页面提供 6 个 Tab 页展示回测数据：

| Tab | 内容 | 展示形式 |
|-----|------|---------|
| **策略收益** | 累计收益率曲线 + 每日收益率分布 | 折线图 + 柱状图 |
| **交易详情** | 所有买卖交易记录 | 表格 |
| **每日持仓收益** | 每日持仓明细 | 表格 |
| **基准收益** | 策略 vs 基准对比 + 超额收益 | 折线图 + 柱状图 |
| **日志输出** | 运行日志，支持按级别过滤 | 控制台风格 |
| **策略代码** | 策略 Python 源代码 | 代码高亮 |

### 2. 股票数据查询

提供 RESTful API 查询本地 CSMAR 数据：

- 单只股票日线查询
- 多只股票批量查询
- 全市场某日快照
- 股票搜索
- 收益率计算
- 交易日历

### 3. 数据导入

支持从 CSMAR 原始 CSV 文件导入全部 A 股日线数据，自动：
- 解析 25 个字段的原始数据
- 分批写入 SQLite（每批 10,000 条，事务包装）
- 提取股票基本信息表
- 提取交易日历

### 4. 每日增量同步

```bash
# 腾讯/新浪回填（主，免登录，~6 分钟）——补本地最新之后的缺失交易日
C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/backfill_daily_tx_sina.py
# baostock 增量（备，补 trade_calendar/index_daily 口径）
C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/update-daily-baostock.py
# 或 Tkinter GUI（默认腾讯/新浪）：scripts/sync_gui.py
```

### 5. 多因子量化体系

- **因子注册表** `scripts/factor_registry.json`：约 20 个因子的唯一权威定义（动量/反转/波动/流动性/技术/规模/价值/质量/成长）
- **双轨实现**：研究管线（pandas）发现迭代 + 生产引擎（纯标准库）网页复现，`verify_factor_consistency.py` 校验两轨偏差 ≤0.001
- **无未来函数三铁律**：基本面「报告期+4 个月滞后」、动量 skip 最近 20 交易日、股票池剔除 ST/涨跌停/次新/B股/北交所/金融股
- **策略库**：`scripts/strategies/` 6 个方向，`seed_strategies.py` 入库

### 6. 每日选股图文报告

```bash
C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/daily_stock_pick.py --strategy smallcap
```
生成 `docs/project-docs/每日选股/` + Obsidian「量化回测平台/每日选股/」**一~十节**图文报告：
因子公式（2.1）→ top-50 名单 → 组合画像 → **七基本面快照**（腾讯 PE/PB/市值+CSMAR 财务）→ **八技术面图**（布林带/海龟/组合净值）→ **九因子诊断**（名单追踪/IC/月度校验）→ 十 Claude 点评。

---

## 架构设计

### 数据流

```
┌─────────────────────────────────────────────────────┐
│                    前端页面                           │
│  index.html  →  main.js  →  ApiClient (api.js)      │
│                         │                            │
│                    HTTP /api/*                        │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│                  Express 服务 (server/index.js)       │
│                                                      │
│  ┌──────────────────┐    ┌──────────────────────┐   │
│  │  db.js            │    │  stock-db.js         │   │
│  │  (回测数据库)      │    │  (股票日线数据库)      │   │
│  └───────┬──────────┘    └──────────┬───────────┘   │
│          │                          │                │
│  ┌───────▼──────────┐    ┌──────────▼───────────┐   │
│  │ backtest.db      │    │ stock_data.db        │   │
│  │ (回测+策略+用户)   │    │ (1850万条日线数据)    │   │
│  └──────────────────┘    └──────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 两个数据库

| 数据库文件 | 用途 | 表数量 | 数据量 |
|-----------|------|--------|--------|
| `backtest.db` | 回测结果、用户、策略、交易、持仓、日志 | 9 张表 | 小（百级） |
| `stock_data.db` | 全市场 A 股日线数据、交易日历 | 3 张表 | 大（千万级） |

---

## API 接口

### 回测数据接口 (server/index.js)

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/algorithm/list` | 策略列表 |
| GET | `/api/backtest/:id/summary` | 回测概要（含风险指标） |
| GET | `/api/backtest/:id/returns` | 策略收益（含时间序列） |
| GET | `/api/backtest/:id/trades` | 交易详情 |
| GET | `/api/backtest/:id/positions` | 每日持仓收益 |
| GET | `/api/backtest/:id/benchmark` | 基准收益（含对比） |
| GET | `/api/backtest/:id/logs` | 日志输出（支持 `?level=` 过滤） |
| GET | `/api/backtest/:id/code` | 策略代码 |

### 股票数据接口 (server/index.js)

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/stock/:code/daily` | 单只股票日线数据 |
| POST | `/api/stock/batch/daily` | 多只股票批量查询 |
| GET | `/api/stock/market/:date` | 全市场某日数据 |
| GET | `/api/stock/search?q=` | 搜索股票 |
| GET | `/api/stock/:code/return` | 股票收益率计算 |
| GET | `/api/calendar?year=` | 交易日历 |
| GET | `/api/stats` | 数据库统计 |

### 统一响应格式

```json
{
    "code": 0,
    "data": { ... },
    "message": "success"
}
```

---

## 数据库设计

### backtest.db (回测数据库)

9 张表，遵循 3NF 设计：

```
users ──1:N── algorithms ──1:N── backtests ──1:N── daily_records
                                        │──1:N── trades
                                        │──1:N── positions
                                        │──1:N── logs
                                        │──1:1── backtest_code
                                        │──1:N── benchmark_daily_records
```

详细设计见 [database-design.md](database-design.md)。

### stock_data.db (日线数据库)

3 张表：

```
stocks ──1:N── stock_daily (核心表，1850万行)
trade_calendar (独立，交易日历)
```

详细设计见 [data-migration-guide.md](data-migration-guide.md)。

---

## 数据导入

### CSMAR 数据导入

```bash
node scripts/import-csmar.js
```

导入流程：
1. 扫描 `D:\pythonpro\股票日数据` 目录下的 CSV 文件
2. 流式读取，每 10,000 条一批写入 SQLite
3. 自动提取 `stocks` 表（股票基本信息）
4. 自动提取 `trade_calendar` 表（交易日历）

### 数据验证

```bash
node scripts/query-test.js
```

输出示例：
- 数据库统计（股票数、记录数、日期范围、文件大小）
- 平安银行 / 贵州茅台查询示例
- 年化收益率计算示例
- 完整性检查（预期 vs 实际行数匹配度）

---

## 已有文档索引

| 文档 | 路径 | 内容 |
|------|------|------|
| **项目总览** | `README.md` | 本文档 |
| **AI 协作指南** | `CLAUDE.md` | 最常用，含常用命令/架构/关键约定 |
| **交接文档** | `HANDOVER.md` | 最完整（回测流程/API 清单/关键 ID/陷阱） |
| **架构与启动** | `docs/project-docs/架构与启动.md` | 回测链路/两库/引擎/多因子体系 |
| **数据源与同步** | `docs/project-docs/数据源与同步.md` | 腾讯新浪+baostock 双轨 |
| **多因子研究** | `docs/project-docs/多因子研究总结.md` | 因子研究结论 |
| **数据同步排错** | `docs/project-docs/数据同步排错经验.md` | baostock 故障/回填口径 |
| **GitHub 同步排错** | `docs/project-docs/GitHub同步排错经验.md` | 代理 7897/非沙箱推送 |
| **API 文档** | [api/README.md](api/README.md) | 平台 API 接口文档 |
| **数据库设计** | [database-design.md](database-design.md) | backtest.db 完整表结构、索引、ER 图 |
| **数据收集指南** | [data-collection-guide.md](data-collection-guide.md) | 各 API 接口数据字段说明与获取方式 |
| **数据迁移方案** | [data-migration-guide.md](data-migration-guide.md) | CSMAR 数据导入方案、表结构、性能优化 |

---

## 开发说明

### 启动开发模式

```bash
npm run dev
```

### 添加新 API

1. 在 `server/stock-db.js` 或 `server/db.js` 中添加查询方法
2. 在 `server/index.js` 中添加路由
3. 在 `assets/js/api.js` 中添加前端调用方法
4. 在 `assets/js/main.js` 中添加渲染逻辑

### 数据库迁移到 MySQL

当需要多用户并发或部署到服务器时，可参考 `data-migration-guide.md` 中的迁移方案。

---

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

Copyright (c) 2026 2131614483

允许任意使用、修改、分发和商用，仅需在副本中保留版权声明和许可声明。