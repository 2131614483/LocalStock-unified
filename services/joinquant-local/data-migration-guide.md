# 本地股票日数据迁移方案

> 将 CSMAR 日个股回报率数据导入本地数据库，替换云端数据源  
> 数据路径: `D:\pythonpro\股票日数据`  
> 数据量: **1850 万条**，覆盖 **1991-06 ~ 2026-06** 共 35 年  
> 设计原则: 本地优先，方便迁移到 MySQL/PostgreSQL

---

## 目录

1. [数据概况](#1-数据概况)
2. [数据库选型](#2-数据库选型)
3. [表结构设计](#3-表结构设计)
4. [ER 关系图](#4-er-关系图)
5. [SQL 建表脚本](#5-sql-建表脚本)
6. [导入流程](#6-导入流程)
7. [查询性能优化](#7-查询性能优化)
8. [迁移到 MySQL 的步骤](#8-迁移到-mysql-的步骤)
9. [API 对接方案](#9-api-对接方案)

---

## 1. 数据概况

### 数据来源

CSMAR（中国股票市场研究数据库）日个股回报率数据，包含沪深 A/B 股、创业板、科创板、北交所的全部交易数据。

### 数据规模

| 统计项 | 数值 |
|--------|------|
| 总记录数 | **18,517,305 条** |
| 时间跨度 | 1991-06-01 ~ 2026-06-12 |
| CSV 文件数 | 22 个 |
| 字段数 | 25 个字段 |
| 股票数量 | 约 5,000+ 只 |
| 日线数据量 | ~1,850 万条 |

### CSMAR 原始字段说明

| # | 字段名 | 中文名 | 单位/格式 | 说明 |
|---|--------|--------|-----------|------|
| 1 | Stkcd | 证券代码 | string(6) | 如 000001 |
| 2 | Trddt | 交易日期 | YYYY-MM-DD | - |
| 3 | Opnprc | 日开盘价 | 元 | A股人民币，B股美元/港币 |
| 4 | Hiprc | 日最高价 | 元 | 同上 |
| 5 | Loprc | 日最低价 | 元 | 同上 |
| 6 | Clsprc | 日收盘价 | 元 | 同上 |
| 7 | Dnshrtrd | 日个股交易股数 | 股 | 0=无交易 |
| 8 | Dnvaltrd | 日个股交易金额 | 元 | 0=无交易 |
| 9 | Dsmvosd | 日个股流通市值 | 千元 | 流通股×收盘价 |
| 10 | Dsmvtll | 日个股总市值 | 千元 | 总股数×收盘价 |
| 11 | Dretwd | 日个股回报率(含现金红利) | 小数 | 复权收益率 |
| 12 | Dretnd | 日个股回报率(不含现金红利) | 小数 | 简单收益率 |
| 13 | Adjprcwd | 复权收盘价(含红利) | 元 | 以上市首日为基准 |
| 14 | Adjprcnd | 复权收盘价(不含红利) | 元 | 以上市首日为基准 |
| 15 | Markettype | 市场类型 | code | 1=上证A, 2=上证B, 4=深证A, 8=深证B, 16=创业板, 32=科创板, 64=北证 |
| 16 | Capchgdt | 最新股本变动日期 | date | - |
| 17 | Trdsta | 交易状态 | code | 1=正常, 2=ST, 3=*ST... |
| 18 | Ahshrtrd_D | 盘后成交量 | 股 | 创业板/科创板 |
| 19 | Ahvaltrd_D | 盘后成交额 | 元 | 创业板/科创板 |
| 20 | PreClosePrice | 昨收盘 | 元 | 交易所除权后价格 |
| 21 | ChangeRatio | 涨跌幅 | 小数 | Clsprc/PreClosePrice-1 |
| 22 | LimitDown | 跌停价 | 元 | - |
| 23 | LimitUp | 涨停价 | 元 | - |
| 24 | LimitStatus | 涨跌停状态 | code | 1=涨停, -1=跌停, 0=无 |

---

## 2. 数据库选型

### 推荐方案：SQLite（本地开发）

| 特性 | 说明 |
|------|------|
| 存储方式 | 单文件 `data/stock_data.db`，纯本地无服务 |
| 驱动 | `better-sqlite3`（同步API，性能极佳） |
| 数据库大小 | 预估 **2~3 GB**（1850万行） |
| 读写性能 | 满足本地回测分析需求 |
| 迁移性 | 文件直接拷贝即可迁移 |

### 迁移方案：MySQL（生产部署）

当以下场景出现时可迁移：
- 需要多用户并发访问
- 部署为 Web 服务
- 数据量超过 5000 万行

**迁移方式**：本文档提供的建表 SQL 兼容 MySQL 语法，仅需修改：
- `INTEGER` → `BIGINT`（不影响）
- `VARCHAR` → `VARCHAR`（兼容）
- 去掉 `PRAGMA` 语句即可

---

## 3. 表结构设计

### 3.1 `stocks` — 股票基本信息表

缓存股票代码对应的基本信息，从 CSMAR 数据中提取。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTOINCREMENT | 自增主键 |
| `stock_code` | VARCHAR(6) | NOT NULL, UNIQUE | 证券代码（6位） |
| `market_type` | TINYINT | NOT NULL | 市场类型（同CSMAR编码）|
| `market_name` | VARCHAR(16) | - | 市场中文名推算 |
| `name` | VARCHAR(32) | - | 股票名称（可手动补充）|
| `first_trade_date` | DATE | - | 首次交易日期 |
| `last_trade_date` | DATE | - | 最后交易日期 |
| `status` | TINYINT | DEFAULT 1 | 1=上市, 0=退市 |
| `created_at` | DATETIME | DEFAULT NOW() | - |

### 3.2 `stock_daily` — 日线数据主表（核心表）

存储全部 CSMAR 原始字段，**1850 万行数据**。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTOINCREMENT | 自增主键 |
| `stock_code` | VARCHAR(6) | NOT NULL | 证券代码 |
| `trade_date` | DATE | NOT NULL | 交易日期 |
| `open_price` | DECIMAL(10,3) | - | 开盘价 |
| `high_price` | DECIMAL(10,3) | - | 最高价 |
| `low_price` | DECIMAL(10,3) | - | 最低价 |
| `close_price` | DECIMAL(10,3) | - | 收盘价 |
| `pre_close_price` | DECIMAL(10,3) | - | 昨收盘（交易所除权后）|
| `change_ratio` | DECIMAL(8,6) | - | 涨跌幅 |
| `volume` | BIGINT | - | 成交量（股）|
| `amount` | DECIMAL(16,2) | - | 成交额（元）|
| `dretwd` | DECIMAL(10,6) | - | 日回报率(含红利) |
| `dretnd` | DECIMAL(10,6) | - | 日回报率(不含红利) |
| `adj_close_wd` | DECIMAL(10,3) | - | 复权收盘价(含红利) |
| `adj_close_nd` | DECIMAL(10,3) | - | 复权收盘价(不含红利) |
| `mkt_cap_float` | DECIMAL(16,2) | - | 流通市值（元）|
| `mkt_cap_total` | DECIMAL(16,2) | - | 总市值（元）|
| `market_type` | TINYINT | - | 市场类型 |
| `trade_status` | TINYINT | - | 交易状态 |
| `limit_up` | DECIMAL(10,3) | - | 涨停价 |
| `limit_down` | DECIMAL(10,3) | - | 跌停价 |
| `limit_status` | TINYINT | - | 涨跌停状态: 1=涨停, -1=跌停, 0=正常 |

### 3.3 `trade_calendar` — 交易日历

快速查询哪些日期是交易日。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTOINCREMENT | - |
| `trade_date` | DATE | NOT NULL, UNIQUE | 交易日 |
| `is_trading_day` | TINYINT | NOT NULL, DEFAULT 1 | 1=交易日, 0=非交易日 |
| `year` | INTEGER | - | 年份（分区用）|
| `month` | INTEGER | - | 月份 |

### 3.4 `backtest_runs` — 回测运行记录

平台回测运行的结果存储，与前端展示对接。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTOINCREMENT | - |
| `backtest_id` | VARCHAR(64) | UNIQUE | 回测ID |
| `algorithm_id` | VARCHAR(64) | - | 策略ID |
| `algorithm_name` | VARCHAR(128) | - | 策略名称 |
| `start_date` | DATE | - | 回测开始 |
| `end_date` | DATE | - | 回测结束 |
| `capital_base` | DECIMAL(16,2) | - | 初始资金 |
| `frequency` | VARCHAR(8) | DEFAULT 'day' | 频率 |
| `status` | VARCHAR(16) | DEFAULT 'pending' | 状态 |
| `total_returns` | DECIMAL(10,6) | - | 总收益率 |
| `annual_returns` | DECIMAL(10,6) | - | 年化收益率 |
| `max_drawdown` | DECIMAL(10,6) | - | 最大回撤 |
| `sharpe` | DECIMAL(8,4) | - | 夏普比率 |
| `created_at` | DATETIME | DEFAULT NOW() | - |

### 3.5 `backtest_daily_returns` — 回测每日收益

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTOINCREMENT | - |
| `backtest_id` | VARCHAR(64) | FK | 回测ID |
| `trade_date` | DATE | - | 日期 |
| `daily_return` | DECIMAL(10,6) | - | 当日策略收益 |
| `cumulative_return` | DECIMAL(10,6) | - | 累计收益 |
| `benchmark_return` | DECIMAL(10,6) | - | 当日基准收益 |
| `total_assets` | DECIMAL(16,2) | - | 总资产 |

### 3.6 `backtest_trades` / `backtest_positions` / `backtest_logs` / `backtest_code`

沿用之前 `server/db.js` 中已定义的 4 个表，此处不再重复。

---

## 4. ER 关系图

```
┌────────────┐       ┌──────────────────┐
│   stocks   │──1:N──│   stock_daily    │ (核心表, 1850万行)
└────────────┘       └──────────────────┘
                             │
                             │ 引用 stock_code + trade_date
                             │
                     ┌───────┴────────┐
                     │ trade_calendar │
                     └────────────────┘

┌──────────────────┐    ┌─────────────────────────┐
│  backtest_runs   │1:N │ backtest_daily_returns  │
│                  │1:N │ backtest_trades          │
│                  │1:N │ backtest_positions       │
│                  │1:N │ backtest_logs            │
│                  │1:1 │ backtest_code            │
└──────────────────┘    └─────────────────────────┘
```

**关键查询路径**:
```
业务查询: 策略回测需要某段时间的股票数据
  └→ SELECT * FROM stock_daily 
     WHERE stock_code IN ('000001','600519')
     AND trade_date BETWEEN '2023-01-01' AND '2023-12-31'
     ORDER BY trade_date
```

---

## 5. SQL 建表脚本（SQLite + 可迁移 MySQL）

```sql
-- ================================================
-- SQLite 建表 + MySQL 兼容
-- 日期: 2026-06-14
-- ================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;      -- 写入性能优化
PRAGMA cache_size = -8000;      -- 8MB 缓存
PRAGMA synchronous = NORMAL;    -- 平衡性能与安全

-- 5.1 股票基本信息表
CREATE TABLE IF NOT EXISTS stocks (
    id                INTEGER      PRIMARY KEY AUTOINCREMENT,
    stock_code        VARCHAR(6)   NOT NULL UNIQUE,
    market_type       TINYINT      NOT NULL,
    market_name       VARCHAR(16)  DEFAULT NULL,
    name              VARCHAR(32)  DEFAULT NULL,
    first_trade_date  DATE         DEFAULT NULL,
    last_trade_date   DATE         DEFAULT NULL,
    status            TINYINT      DEFAULT 1,
    created_at        DATETIME     DEFAULT (datetime('now'))
);

-- 5.2 日线数据主表（核心表）
CREATE TABLE IF NOT EXISTS stock_daily (
    id                INTEGER      PRIMARY KEY AUTOINCREMENT,
    stock_code        VARCHAR(6)   NOT NULL,
    trade_date        DATE         NOT NULL,
    -- 价格数据
    open_price        DECIMAL(10,3) DEFAULT NULL,
    high_price        DECIMAL(10,3) DEFAULT NULL,
    low_price         DECIMAL(10,3) DEFAULT NULL,
    close_price       DECIMAL(10,3) DEFAULT NULL,
    pre_close_price   DECIMAL(10,3) DEFAULT NULL,
    change_ratio      DECIMAL(8,6)  DEFAULT NULL,
    -- 量价数据
    volume            BIGINT        DEFAULT 0,
    amount            DECIMAL(16,2) DEFAULT 0,
    -- 收益率
    dretwd            DECIMAL(10,6) DEFAULT NULL,
    dretnd            DECIMAL(10,6) DEFAULT NULL,
    -- 复权价格
    adj_close_wd      DECIMAL(10,3) DEFAULT NULL,
    adj_close_nd      DECIMAL(10,3) DEFAULT NULL,
    -- 市值
    mkt_cap_float     DECIMAL(16,2) DEFAULT NULL,
    mkt_cap_total     DECIMAL(16,2) DEFAULT NULL,
    -- 状态
    market_type       TINYINT       DEFAULT NULL,
    trade_status      TINYINT       DEFAULT NULL,
    limit_up          DECIMAL(10,3) DEFAULT NULL,
    limit_down        DECIMAL(10,3) DEFAULT NULL,
    limit_status      TINYINT       DEFAULT 0,
    -- 唯一约束: 同一股票同一日期只有一条记录
    UNIQUE(stock_code, trade_date)
);

-- ★ 核心索引：按股票+日期查询（回测最常用）
CREATE INDEX IF NOT EXISTS idx_sd_code_date 
    ON stock_daily(stock_code, trade_date);

-- 按日期查询（查某一天全市场数据）
CREATE INDEX IF NOT EXISTS idx_sd_date 
    ON stock_daily(trade_date);

-- 按股票查询（查单只股票全部历史）
CREATE INDEX IF NOT EXISTS idx_sd_code 
    ON stock_daily(stock_code);

-- 5.3 交易日历
CREATE TABLE IF NOT EXISTS trade_calendar (
    id              INTEGER   PRIMARY KEY AUTOINCREMENT,
    trade_date      DATE      NOT NULL UNIQUE,
    is_trading_day  TINYINT   NOT NULL DEFAULT 1,
    year            INTEGER   DEFAULT NULL,
    month           INTEGER   DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_tc_year ON trade_calendar(year);

-- 5.4 回测运行表
CREATE TABLE IF NOT EXISTS backtest_runs (
    id                INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id       VARCHAR(64)  NOT NULL UNIQUE,
    algorithm_id      VARCHAR(64)  DEFAULT NULL,
    algorithm_name    VARCHAR(128) DEFAULT NULL,
    start_date        DATE         NOT NULL,
    end_date          DATE         NOT NULL,
    capital_base      DECIMAL(16,2) NOT NULL,
    frequency         VARCHAR(8)   DEFAULT 'day',
    status            VARCHAR(16)  DEFAULT 'pending',
    total_returns     DECIMAL(10,6) DEFAULT NULL,
    annual_returns    DECIMAL(10,6) DEFAULT NULL,
    max_drawdown      DECIMAL(10,6) DEFAULT NULL,
    sharpe            DECIMAL(8,4)  DEFAULT NULL,
    created_at        DATETIME     DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_br_backtest_id ON backtest_runs(backtest_id);

-- 5.5 回测每日收益
CREATE TABLE IF NOT EXISTS backtest_daily_returns (
    id                  INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id         VARCHAR(64)  NOT NULL REFERENCES backtest_runs(backtest_id),
    trade_date          DATE         NOT NULL,
    daily_return        DECIMAL(10,6) DEFAULT NULL,
    cumulative_return   DECIMAL(10,6) DEFAULT NULL,
    benchmark_return    DECIMAL(10,6) DEFAULT NULL,
    total_assets        DECIMAL(16,2) DEFAULT NULL,
    UNIQUE(backtest_id, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_bdr_backtest_id ON backtest_daily_returns(backtest_id);
```

---

## 6. 导入流程

### 6.1 整体流程

```
CSMAR CSV 文件 (22个)
       │
       ▼
   清洗去重 (去掉表头行、统一日期格式)
       │
       ▼
   分批插入  (每次 10,000 条)
       │
       ▼
   SQLite 数据库 (data/stock_data.db)
       │
       ▼
   自动分析提取:
   ├── stocks 表 (去重提取股票代码)
   ├── trade_calendar 表 (去重提取交易日)
   └── stock_daily 表 (全部原始数据)
```

### 6.2 导入脚本

详见项目目录下的 `scripts/import-csmar.js`。

### 6.3 导入耗时预估

| 步骤 | 数据量 | 预估时间 |
|------|--------|---------|
| 读取CSV文件 | 1850万行 | ~30 秒 |
| 写入SQLite | 1850万行 | ~2-5 分钟 |
| 创建索引 | 3个索引 | ~1-2 分钟 |
| 提取股票/日历 | 去重 | ~10 秒 |
| **合计** | - | **~5-8 分钟** |

---

## 7. 查询性能优化

### 7.1 索引覆盖

```sql
-- 回测最常用查询: 获取多只股票某段时间的日线数据
EXPLAIN QUERY PLAN
SELECT trade_date, close_price, dretwd, adj_close_wd
FROM stock_daily
WHERE stock_code IN ('000001', '600519', '300750')
  AND trade_date BETWEEN '2023-01-01' AND '2023-12-31'
ORDER BY stock_code, trade_date;

-- 命中索引: idx_sd_code_date (复合索引，完全覆盖)
```

### 7.2 SQLite 配置优化

```sql
PRAGMA journal_mode = WAL;       -- 写入性能 +5x
PRAGMA synchronous = NORMAL;     -- 安全性与速度平衡
PRAGMA cache_size = -16000;      -- 16MB 缓存
PRAGMA temp_store = MEMORY;      -- 临时表放内存
PRAGMA mmap_size = 268435456;    -- 256MB 内存映射
```

### 7.3 大表维护

```sql
-- 数据完整性检查
PRAGMA integrity_check;

-- 重建索引（数据大量变更后执行）
REINDEX;

-- 回收空间（大量删除后执行）
VACUUM;
```

### 7.4 查询示例

```sql
-- 1. 获取单只股票全部历史
SELECT * FROM stock_daily 
WHERE stock_code = '000001' 
ORDER BY trade_date;

-- 2. 获取某段时间范围的数据
SELECT trade_date, close_price, dretwd 
FROM stock_daily 
WHERE stock_code = '600519' 
  AND trade_date BETWEEN '2020-01-01' AND '2023-12-31'
ORDER BY trade_date;

-- 3. 计算某只股票的年化收益率
SELECT 
    stock_code,
    MIN(trade_date) AS start_date,
    MAX(trade_date) AS end_date,
    (SELECT close_price FROM stock_daily 
     WHERE stock_code = s.stock_code 
     ORDER BY trade_date DESC LIMIT 1) / 
    (SELECT close_price FROM stock_daily 
     WHERE stock_code = s.stock_code 
     ORDER BY trade_date ASC LIMIT 1) - 1 AS total_return
FROM stock_daily s
WHERE stock_code = '600519';

-- 4. 查询某个交易日全市场数据
SELECT * FROM stock_daily 
WHERE trade_date = '2024-01-02'
ORDER BY mkt_cap_total DESC;

-- 5. 获取交易日历
SELECT trade_date FROM trade_calendar 
WHERE year = 2023 AND is_trading_day = 1
ORDER BY trade_date;
```

---

## 8. 迁移到 MySQL 的步骤

### 8.1 迁移方式一：SQL → MySQL 直导

```bash
# 1. 从 SQLite 导出 SQL
sqlite3 data/stock_data.db .dump > stock_data_dump.sql

# 2. 替换 SQLite 特有语法
#    - 删除 PRAGMA 语句
#    - AUTOINCREMENT → AUTO_INCREMENT
#    - datetime('now') → NOW()

# 3. 导入 MySQL
mysql -u root -p csmar_db < csmar_dump.sql
```

### 8.2 迁移方式二：Node.js 逐表同步

```javascript
const mysql = require('mysql2/promise');
const betterSqlite3 = require('better-sqlite3');

async function migrateTable(sqliteDb, mysqlConn, tableName) {
    const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
    // 批量插入到 MySQL
    for (const row of rows) {
        await mysqlConn.execute(`INSERT INTO ${tableName} SET ?`, [row]);
    }
}
```

### 8.3 差异对照

| 项目 | SQLite | MySQL |
|------|--------|-------|
| 数据类型 | `INTEGER` | `INT` / `BIGINT` |
| 自增 | `AUTOINCREMENT` | `AUTO_INCREMENT` |
| 时间函数 | `datetime('now')` | `NOW()` |
| 外键 | 需 `PRAGMA foreign_keys=ON` | 默认支持 |
| 事务 | 默认自动 | `START TRANSACTION` |
| 并发 | WAL 模式读并发好 | 原生高并发 |
| 存储 | 单文件 | 服务/目录 |

---

## 9. API 对接方案

### 9.1 数据流向图（替换前 vs 替换后）

```
替换前（Mock 数据）:
  前端页面 → API 路由 → Mock 数据对象 → JSON 返回

替换后（本地数据）:
  前端页面 → API 路由 → stock-db.js 查询 → SQLite JSON 返回
```

### 9.2 新增数据 API

```javascript
// 在 stock-db.js 中提供以下查询方法

// 1. 获取股票日线数据
stockQueries.getDailyData('000001', '2023-01-01', '2023-12-31')
// → [{ trade_date, open, high, low, close, volume, dretwd, ... }]

// 2. 获取多只股票合并数据
stockQueries.getMultiStockData(['000001','600519'], '2023-01-01', '2023-12-31')
// → { '000001': [...], '600519': [...] }

// 3. 获取基准指数数据（用沪深300成分股模拟）
stockQueries.getBenchmarkData('2023-01-01', '2023-12-31')
// → [{ trade_date, daily_return, cumulative_return }]

// 4. 查询交易日历
stockQueries.getTradeCalendar(2023)
// → ['2023-01-02', '2023-01-03', ...]
```

### 9.3 后端路由更新

```javascript
// server/index.js 新增路由

/** 股票日线数据查询 */
app.get('/api/stock/:code/daily', (req, res) => {
    const { code } = req.params;
    const { start, end } = req.query;
    const data = stockQueries.getDailyData(code, start, end);
    res.json({ code: 0, data });
});

/** 多只股票批量查询 */
app.post('/api/stock/batch/daily', (req, res) => {
    const { codes, start, end } = req.body;
    const data = stockQueries.getMultiStockData(codes, start, end);
    res.json({ code: 0, data });
});
```

### 9.4 回测数据替换路径

原有的回测 Mock 数据保持不变，在此基础上**新增**真实数据查询能力：

```
原有:
  /api/backtest/:id/*  →  使用 Mock 数据（用于展示回测结果）

新增:
  /api/stock/:code/daily  →  使用本地数据库（用于实时查询）
  /api/stock/batch/daily  →  批量查询（用于策略回测计算）
```

这样改造的好处：
- 前端展示仍然使用 Mock 回测数据，**不影响现有页面**
- 新增的真实数据接口供**后续策略回测引擎**使用
- 两套数据可以共存，逐步过渡

---

## 附录：快速入门

### 步骤 1: 导入数据

```bash
cd d:\pythonpro\聚宽-local
node scripts/import-csmar.js
```

### 步骤 2: 验证数据

```bash
node scripts/query-test.js
```

### 步骤 3: 启动服务

```bash
npm start
```

### 目录结构

```
聚宽-local/
├── data/
│   ├── stock_data.db      ← 日线数据库 (~2GB)
│   └── backtest.db        ← 回测数据库 (保持不变)
├── scripts/
│   ├── import-csmar.js     ← 数据导入脚本
│   └── query-test.js       ← 数据验证脚本
├── server/
│   ├── index.js            ← API 服务
│   ├── db.js               ← 回测数据库模块
│   └── stock-db.js         ← 日线数据库模块 (新增)
└── database-design.md      ← 本文档
```