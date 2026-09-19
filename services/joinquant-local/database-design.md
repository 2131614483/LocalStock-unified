# 后端数据库设计文档

> 版本: v1.0  
> 数据库: SQLite（本地开发）/ MySQL（生产部署）  
> ORM: better-sqlite3（本地）/ sequelize（可选）

---

## 目录

1. [数据库选型说明](#1-数据库选型说明)
2. [ER 关系图（文字版）](#2-er-关系图文字版)
3. [表结构详述](#3-表结构详述)
4. [索引设计](#4-索引设计)
5. [SQL 建表脚本](#5-sql-建表脚本)
6. [数据初始化脚本](#6-数据初始化脚本)
7. [API 与数据库映射](#7-api-与数据库映射)
8. [性能与容量预估](#8-性能与容量预估)

---

## 1. 数据库选型说明

### 本地开发环境（当前）

| 项目 | 选型 | 原因 |
|------|------|------|
| 数据库 | **SQLite 3** | 零配置、单文件、适合本地开发 |
| Node.js 驱动 | **better-sqlite3** | 同步API、性能优秀、无需安装服务 |
| 数据库文件 | `data/backtest.db` | 存放于项目data目录 |

### 生产部署环境（未来可升级）

| 项目 | 选型 | 原因 |
|------|------|------|
| 数据库 | **MySQL 8.0+** / **PostgreSQL 15+** | 支持高并发、主从架构 |
| Node.js ORM | **Sequelize** | 支持多数据库方言、模型定义清晰 |

> 本文设计遵循 SQL 标准，兼容 SQLite / MySQL / PostgreSQL。

---

## 2. ER 关系图（文字版）

```
┌───────────┐       ┌──────────────┐
│   users   │──1:N──│  algorithms  │
└───────────┘       └──────┬───────┘
                           │ 1:N
                           │
                    ┌──────▼────────┐
                    │   backtests   │────1:1────┌──────────────────┐
                    └──────┬────────┘           │  backtest_code   │
                           │                    └──────────────────┘
              ┌────────────┼────────────┬───────────────┐
              │ 1:N        │ 1:N        │ 1:N           │ 1:N
              ▼             ▼            ▼               ▼
     ┌────────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐
     │  trades    │ │ positions │ │  logs    │ │ daily_records│
     └────────────┘ └───────────┘ └──────────┘ └──────┬───────┘
                                                       │ 1:1
                                                       ▼
                                              ┌────────────────┐
                                              │ benchmark_      │
                                              │ daily_records  │
                                              └────────────────┘
```

### 核心关系说明

| 关系 | 类型 | 说明 |
|------|------|------|
| users → algorithms | 1:N | 一个用户可以有多个策略 |
| algorithms → backtests | 1:N | 一个策略可以有多次回测 |
| backtests → backtest_code | 1:1 | 一次回测对应一份策略代码 |
| backtests → trades | 1:N | 一次回测有多条交易记录 |
| backtests → positions | 1:N | 一次回测有多条持仓记录 |
| backtests → logs | 1:N | 一次回测有多条日志 |
| backtests → daily_records | 1:N | 一次回测有N天每日收益 |
| daily_records → benchmark_daily_records | 1:1 | 同日期的基准数据 |

---

## 3. 表结构详述

### 3.1 `users` — 用户表

存储平台用户信息。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTO_INCREMENT | 用户ID |
| `username` | VARCHAR(64) | NOT NULL, UNIQUE | 用户名 |
| `email` | VARCHAR(128) | UNIQUE | 邮箱 |
| `password_hash` | VARCHAR(256) | NOT NULL | 密码哈希 |
| `avatar` | VARCHAR(256) | DEFAULT NULL | 头像URL |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 创建时间 |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() | 更新时间 |

```json
// 示例数据
{
  "id": 1,
  "username": "trader001",
  "email": "trader@example.com",
  "created_at": "2023-01-01T00:00:00Z"
}
```

---

### 3.2 `algorithms` — 策略表

用户创建的量化策略。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTO_INCREMENT | 策略ID |
| `algorithm_id` | VARCHAR(64) | NOT NULL, UNIQUE | 对外暴露的策略ID（UUID/MD5） |
| `user_id` | INTEGER | FK → users.id, NOT NULL | 所属用户ID |
| `name` | VARCHAR(128) | NOT NULL | 策略名称 |
| `description` | TEXT | DEFAULT NULL | 策略描述 |
| `status` | VARCHAR(16) | NOT NULL, DEFAULT 'active' | 状态: active / inactive |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 创建时间 |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() | 更新时间 |

**索引**: `idx_algorithms_user_id` ON (`user_id`)  
**索引**: `idx_algorithms_algorithm_id` ON (`algorithm_id`)

```json
{
  "id": 1,
  "algorithm_id": "4e5d0fa0f1dc303f9de6377e53c2064d",
  "user_id": 1,
  "name": "价值投资策略",
  "description": "低市盈率+高ROE选股",
  "status": "active"
}
```

---

### 3.3 `backtests` — 回测表

每次回测运行的主记录。**这是核心表**，关联了所有回测数据。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTO_INCREMENT | 自增主键 |
| `backtest_id` | VARCHAR(64) | NOT NULL, UNIQUE | 对外回测ID（UUID/MD5） |
| `algorithm_id` | VARCHAR(64) | FK → algorithms.algorithm_id, NOT NULL | 关联策略ID |
| `algorithm_name` | VARCHAR(128) | NOT NULL | 策略名称（冗余，避免JOIN） |
| `start_date` | DATE | NOT NULL | 回测开始日期 |
| `end_date` | DATE | NOT NULL | 回测结束日期 |
| `capital_base` | DECIMAL(16,2) | NOT NULL | 初始资金（元） |
| `frequency` | VARCHAR(8) | NOT NULL, DEFAULT 'day' | day(日线) / minute(分钟) |
| `status` | VARCHAR(16) | NOT NULL, DEFAULT 'pending' | pending(等待) / running(运行中) / done(完成) / failed(失败) |
| `progress` | TINYINT | NOT NULL, DEFAULT 0 | 执行进度 0-100 |
| `total_returns` | DECIMAL(10,6) | DEFAULT NULL | 总收益率 |
| `annual_returns` | DECIMAL(10,6) | DEFAULT NULL | 年化收益率 |
| `max_drawdown` | DECIMAL(10,6) | DEFAULT NULL | 最大回撤 |
| `sharpe` | DECIMAL(8,4) | DEFAULT NULL | 夏普比率 |
| `volatility` | DECIMAL(10,6) | DEFAULT NULL | 波动率 |
| `alpha` | DECIMAL(8,4) | DEFAULT NULL | Alpha |
| `beta` | DECIMAL(8,4) | DEFAULT NULL | Beta |
| `information_ratio` | DECIMAL(8,4) | DEFAULT NULL | 信息比率 |
| `win_rate` | DECIMAL(8,4) | DEFAULT NULL | 胜率 |
| `trading_days` | INTEGER | DEFAULT 0 | 实际交易天数 |
| `benchmark_name` | VARCHAR(64) | DEFAULT '沪深300指数' | 基准名称 |
| `benchmark_code` | VARCHAR(16) | DEFAULT '000300.XSHG' | 基准代码 |
| `benchmark_total_returns` | DECIMAL(10,6) | DEFAULT NULL | 基准总收益率 |
| `benchmark_annual_returns` | DECIMAL(10,6) | DEFAULT NULL | 基准年化收益率 |
| `benchmark_max_drawdown` | DECIMAL(10,6) | DEFAULT NULL | 基准最大回撤 |
| `benchmark_volatility` | DECIMAL(10,6) | DEFAULT NULL | 基准波动率 |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 回测创建时间 |
| `started_at` | DATETIME | DEFAULT NULL | 回测开始执行时间 |
| `finished_at` | DATETIME | DEFAULT NULL | 回测完成时间 |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() | 更新时间 |

**索引**: `idx_backtests_backtest_id` ON (`backtest_id`)  
**索引**: `idx_backtests_algorithm_id` ON (`algorithm_id`)  
**索引**: `idx_backtests_status` ON (`status`)

```json
{
  "backtest_id": "886dc04e9fe1547dac9b4b43d647ae9d",
  "algorithm_id": "4e5d0fa0f1dc303f9de6377e53c2064d",
  "algorithm_name": "价值投资策略",
  "start_date": "2023-01-01",
  "end_date": "2023-12-31",
  "capital_base": 1000000.00,
  "frequency": "day",
  "status": "done",
  "total_returns": 0.2568,
  "annual_returns": 0.1234,
  "max_drawdown": -0.1532,
  "sharpe": 1.2800,
  "trading_days": 242
}
```

---

### 3.4 `daily_records` — 每日收益记录表

存储回测期间每个交易日的收益数据。**数据量最大的表**。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 自增主键 |
| `backtest_id` | VARCHAR(64) | FK → backtests.backtest_id, NOT NULL | 关联回测ID |
| `trade_date` | DATE | NOT NULL | 交易日 |
| `daily_return` | DECIMAL(10,6) | NOT NULL | 当日收益率 |
| `cumulative_return` | DECIMAL(10,6) | NOT NULL | 累计至当日收益率 |
| `total_assets` | DECIMAL(16,2) | DEFAULT NULL | 当日总资产（元） |
| `available_cash` | DECIMAL(16,2) | DEFAULT NULL | 当日可用现金（元） |
| `position_value` | DECIMAL(16,2) | DEFAULT NULL | 当日持仓市值（元） |

**复合唯一约束**: `uk_daily_records` ON (`backtest_id`, `trade_date`)  
**索引**: `idx_daily_records_backtest_id` ON (`backtest_id`)  
**索引**: `idx_daily_records_trade_date` ON (`trade_date`)

```json
{
  "backtest_id": "886dc04e9fe1547dac9b4b43d647ae9d",
  "trade_date": "2023-01-02",
  "daily_return": 0.0052,
  "cumulative_return": 0.0052,
  "total_assets": 1005200.00,
  "available_cash": 500000.00,
  "position_value": 505200.00
}
```

---

### 3.5 `trades` — 交易记录表

存储回测中的每一笔买卖交易。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 自增主键 |
| `backtest_id` | VARCHAR(64) | FK → backtests.backtest_id, NOT NULL | 关联回测ID |
| `trade_date` | DATE | NOT NULL | 交易日期 |
| `trade_time` | TIME | DEFAULT NULL | 交易时间（分钟级回测） |
| `stock_code` | VARCHAR(16) | NOT NULL | 股票代码（含后缀） |
| `stock_name` | VARCHAR(32) | NOT NULL | 股票名称 |
| `direction` | VARCHAR(4) | NOT NULL | buy(买入) / sell(卖出) |
| `price` | DECIMAL(10,3) | NOT NULL | 成交价（元） |
| `volume` | INTEGER | NOT NULL | 成交量（股） |
| `amount` | DECIMAL(16,2) | NOT NULL | 成交金额（元） |
| `commission` | DECIMAL(10,2) | NOT NULL, DEFAULT 0 | 手续费（元） |
| `tax` | DECIMAL(10,2) | NOT NULL, DEFAULT 0 | 印花税（元） |
| `profit` | DECIMAL(10,2) | NOT NULL, DEFAULT 0 | 盈亏（元，卖出记录） |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 记录创建时间 |

**索引**: `idx_trades_backtest_id` ON (`backtest_id`)  
**索引**: `idx_trades_trade_date` ON (`trade_date`)  
**索引**: `idx_trades_stock_code` ON (`stock_code`)

```json
{
  "backtest_id": "886dc04e9fe1547dac9b4b43d647ae9d",
  "trade_date": "2023-01-05",
  "stock_code": "000001.XSHE",
  "stock_name": "平安银行",
  "direction": "buy",
  "price": 14.250,
  "volume": 1000,
  "amount": 14250.00,
  "commission": 14.25,
  "tax": 0,
  "profit": 0
}
```

---

### 3.6 `positions` — 每日持仓表

存储回测期间每个交易日收盘后的持仓明细。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 自增主键 |
| `backtest_id` | VARCHAR(64) | FK → backtests.backtest_id, NOT NULL | 关联回测ID |
| `trade_date` | DATE | NOT NULL | 日期 |
| `stock_code` | VARCHAR(16) | NOT NULL | 股票代码 |
| `stock_name` | VARCHAR(32) | NOT NULL | 股票名称 |
| `volume` | INTEGER | NOT NULL | 持仓数量（股） |
| `current_price` | DECIMAL(10,3) | NOT NULL | 当日收盘价/当前价 |
| `cost_price` | DECIMAL(10,3) | NOT NULL | 持仓平均成本价 |
| `market_value` | DECIMAL(16,2) | NOT NULL | 市值（= volume × current_price） |
| `profit` | DECIMAL(10,2) | NOT NULL | 盈亏（= market_value - cost） |
| `profit_rate` | DECIMAL(10,6) | NOT NULL | 盈亏比例 |
| `weight` | DECIMAL(6,4) | NOT NULL | 持仓权重（占总资产比例） |

**复合唯一约束**: `uk_positions` ON (`backtest_id`, `trade_date`, `stock_code`)  
**索引**: `idx_positions_backtest_id` ON (`backtest_id`)

```json
{
  "backtest_id": "886dc04e9fe1547dac9b4b43d647ae9d",
  "trade_date": "2023-01-05",
  "stock_code": "000001.XSHE",
  "stock_name": "平安银行",
  "volume": 1000,
  "current_price": 15.800,
  "cost_price": 14.250,
  "market_value": 15800.00,
  "profit": 1550.00,
  "profit_rate": 0.1088,
  "weight": 0.1500
}
```

---

### 3.7 `logs` — 日志表

存储回测运行过程中的日志信息。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 自增主键 |
| `backtest_id` | VARCHAR(64) | FK → backtests.backtest_id, NOT NULL | 关联回测ID |
| `log_date` | DATE | NOT NULL | 日志日期 |
| `log_time` | TIME | NOT NULL | 日志时间 |
| `level` | VARCHAR(8) | NOT NULL | info / warning / error / debug |
| `message` | TEXT | NOT NULL | 日志内容 |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 记录创建时间 |

**索引**: `idx_logs_backtest_id` ON (`backtest_id`)  
**索引**: `idx_logs_level` ON (`level`)

```json
{
  "backtest_id": "886dc04e9fe1547dac9b4b43d647ae9d",
  "log_date": "2023-01-02",
  "log_time": "09:30:00",
  "level": "info",
  "message": "策略初始化完成，初始资金: ¥1,000,000"
}
```

---

### 3.8 `backtest_code` — 策略代码表

存储每次回测对应的策略源代码。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | INTEGER | PK, AUTO_INCREMENT | 自增主键 |
| `backtest_id` | VARCHAR(64) | FK → backtests.backtest_id, NOT NULL, UNIQUE | 关联回测ID（1:1） |
| `language` | VARCHAR(16) | NOT NULL, DEFAULT 'python' | 代码语言 |
| `code` | TEXT | NOT NULL | 策略源代码 |
| `code_hash` | VARCHAR(64) | NOT NULL | 代码SHA256哈希（用于去重） |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 创建时间 |
| `updated_at` | DATETIME | NOT NULL, DEFAULT NOW() | 更新时间 |

**索引**: `idx_code_hash` ON (`code_hash`)

```json
{
  "backtest_id": "886dc04e9fe1547dac9b4b43d647ae9d",
  "language": "python",
  "code": "def initialize(context):\n    set_benchmark('000300.XSHG')\n    ..."
}
```

---

### 3.9 `benchmark_daily_records` — 基准每日数据表

存储基准指数每个交易日的行情数据。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 自增主键 |
| `backtest_id` | VARCHAR(64) | FK → backtests.backtest_id, NOT NULL | 关联回测ID |
| `trade_date` | DATE | NOT NULL | 交易日 |
| `daily_return` | DECIMAL(10,6) | NOT NULL | 基准当日收益率 |
| `cumulative_return` | DECIMAL(10,6) | NOT NULL | 基准累计收益率 |
| `excess_return` | DECIMAL(10,6) | NOT NULL | 超额收益 = 策略收益 - 基准收益 |
| `close_price` | DECIMAL(10,3) | DEFAULT NULL | 基准收盘价 |

**复合唯一约束**: `uk_benchmark_daily` ON (`backtest_id`, `trade_date`)  
**索引**: `idx_benchmark_backtest_id` ON (`backtest_id`)

```json
{
  "backtest_id": "886dc04e9fe1547dac9b4b43d647ae9d",
  "trade_date": "2023-01-02",
  "daily_return": 0.0012,
  "cumulative_return": 0.0012,
  "excess_return": 0.0040,
  "close_price": 3856.500
}
```

---

## 4. 索引设计

### 4.1 索引总览

| 表名 | 索引名 | 列 | 类型 | 说明 |
|------|--------|----|------|------|
| algorithms | PK | id | PRIMARY | 主键 |
| algorithms | `idx_algorithms_algorithm_id` | algorithm_id | UNIQUE | 业务ID快速查找 |
| algorithms | `idx_algorithms_user_id` | user_id | INDEX | 按用户查询策略 |
| backtests | PK | id | PRIMARY | 主键 |
| backtests | `idx_backtests_backtest_id` | backtest_id | UNIQUE | 回测ID快速查找 |
| backtests | `idx_backtests_algorithm_id` | algorithm_id | INDEX | 按策略查回测列表 |
| backtests | `idx_backtests_status` | status | INDEX | 按状态筛选 |
| daily_records | PK | id | PRIMARY | 主键 |
| daily_records | `uk_daily_records` | (backtest_id, trade_date) | UNIQUE | 防止重复插入 |
| daily_records | `idx_daily_records_backtest_id` | backtest_id | INDEX | 批量查询某回测所有记录 |
| trades | `idx_trades_backtest_id` | backtest_id | INDEX | 按回测查交易 |
| trades | `idx_trades_trade_date` | trade_date | INDEX | 按日期查交易 |
| positions | `uk_positions` | (backtest_id, trade_date, stock_code) | UNIQUE | 唯一约束 |
| positions | `idx_positions_backtest_id` | backtest_id | INDEX | 批量查询 |
| logs | `idx_logs_backtest_id` | backtest_id | INDEX | 按回测查日志 |
| logs | `idx_logs_level` | level | INDEX | 按级别过滤 |
| benchmark_daily_records | `uk_benchmark_daily` | (backtest_id, trade_date) | UNIQUE | 唯一约束 |

### 4.2 复合索引说明

```
daily_records 表查询模式:
  SELECT * FROM daily_records 
  WHERE backtest_id = ? ORDER BY trade_date ASC
  
  → (backtest_id, trade_date) 的 UNIQUE 索引可以直接覆盖这个查询

positions 表查询模式:
  SELECT * FROM positions 
  WHERE backtest_id = ? AND trade_date = ?
  
  → (backtest_id, trade_date, stock_code) 的 UNIQUE 索引最优
```

---

## 5. SQL 建表脚本

```sql
-- ========================================
-- 数据库: backtest (SQLite 版本)
-- 创建脚本
-- ========================================

-- 开启外键约束
PRAGMA foreign_keys = ON;

-- 5.1 用户表
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        VARCHAR(64)  NOT NULL UNIQUE,
    email           VARCHAR(128) UNIQUE,
    password_hash   VARCHAR(256) NOT NULL,
    avatar          VARCHAR(256) DEFAULT NULL,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now')),
    updated_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);

-- 5.2 策略表
CREATE TABLE IF NOT EXISTS algorithms (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    algorithm_id    VARCHAR(64)  NOT NULL UNIQUE,
    user_id         INTEGER      NOT NULL REFERENCES users(id),
    name            VARCHAR(128) NOT NULL,
    description     TEXT         DEFAULT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now')),
    updated_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_algorithms_user_id 
    ON algorithms(user_id);

-- 5.3 回测主表（核心表）
CREATE TABLE IF NOT EXISTS backtests (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    backtest_id                 VARCHAR(64)  NOT NULL UNIQUE,
    algorithm_id                VARCHAR(64)  NOT NULL REFERENCES algorithms(algorithm_id),
    algorithm_name              VARCHAR(128) NOT NULL,
    start_date                  DATE         NOT NULL,
    end_date                    DATE         NOT NULL,
    capital_base                DECIMAL(16,2) NOT NULL,
    frequency                   VARCHAR(8)   NOT NULL DEFAULT 'day'
                                    CHECK (frequency IN ('day', 'minute')),
    status                      VARCHAR(16)  NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'running', 'done', 'failed')),
    progress                    TINYINT      NOT NULL DEFAULT 0
                                    CHECK (progress >= 0 AND progress <= 100),
    -- 风险指标（回测完成后填写）
    total_returns               DECIMAL(10,6) DEFAULT NULL,
    annual_returns              DECIMAL(10,6) DEFAULT NULL,
    max_drawdown                DECIMAL(10,6) DEFAULT NULL,
    sharpe                      DECIMAL(8,4)  DEFAULT NULL,
    volatility                  DECIMAL(10,6) DEFAULT NULL,
    alpha                       DECIMAL(8,4)  DEFAULT NULL,
    beta                        DECIMAL(8,4)  DEFAULT NULL,
    information_ratio           DECIMAL(8,4)  DEFAULT NULL,
    win_rate                    DECIMAL(8,4)  DEFAULT NULL,
    trading_days                INTEGER       DEFAULT 0,
    -- 基准信息
    benchmark_name              VARCHAR(64)   DEFAULT '沪深300指数',
    benchmark_code              VARCHAR(16)   DEFAULT '000300.XSHG',
    benchmark_total_returns     DECIMAL(10,6) DEFAULT NULL,
    benchmark_annual_returns    DECIMAL(10,6) DEFAULT NULL,
    benchmark_max_drawdown      DECIMAL(10,6) DEFAULT NULL,
    benchmark_volatility        DECIMAL(10,6) DEFAULT NULL,
    -- 时间戳
    created_at                  DATETIME     NOT NULL DEFAULT (datetime('now')),
    started_at                  DATETIME     DEFAULT NULL,
    finished_at                 DATETIME     DEFAULT NULL,
    updated_at                  DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_backtests_algorithm_id 
    ON backtests(algorithm_id);
CREATE INDEX IF NOT EXISTS idx_backtests_status 
    ON backtests(status);

-- 5.4 每日收益记录表（数据量最大）
CREATE TABLE IF NOT EXISTS daily_records (
    id                  BIGINT       PRIMARY KEY AUTOINCREMENT,
    backtest_id         VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date          DATE         NOT NULL,
    daily_return        DECIMAL(10,6) NOT NULL,
    cumulative_return   DECIMAL(10,6) NOT NULL,
    total_assets        DECIMAL(16,2) DEFAULT NULL,
    available_cash      DECIMAL(16,2) DEFAULT NULL,
    position_value      DECIMAL(16,2) DEFAULT NULL,
    UNIQUE(backtest_id, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_records_backtest_id 
    ON daily_records(backtest_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_trade_date 
    ON daily_records(trade_date);

-- 5.5 交易记录表
CREATE TABLE IF NOT EXISTS trades (
    id              BIGINT       PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date      DATE         NOT NULL,
    trade_time      TIME         DEFAULT NULL,
    stock_code      VARCHAR(16)  NOT NULL,
    stock_name      VARCHAR(32)  NOT NULL,
    direction       VARCHAR(4)   NOT NULL CHECK (direction IN ('buy', 'sell')),
    price           DECIMAL(10,3) NOT NULL,
    volume          INTEGER      NOT NULL,
    amount          DECIMAL(16,2) NOT NULL,
    commission      DECIMAL(10,2) NOT NULL DEFAULT 0,
    tax             DECIMAL(10,2) NOT NULL DEFAULT 0,
    profit          DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trades_backtest_id 
    ON trades(backtest_id);
CREATE INDEX IF NOT EXISTS idx_trades_trade_date 
    ON trades(trade_date);
CREATE INDEX IF NOT EXISTS idx_trades_stock_code 
    ON trades(stock_code);

-- 5.6 每日持仓表
CREATE TABLE IF NOT EXISTS positions (
    id              BIGINT       PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date      DATE         NOT NULL,
    stock_code      VARCHAR(16)  NOT NULL,
    stock_name      VARCHAR(32)  NOT NULL,
    volume          INTEGER      NOT NULL,
    current_price   DECIMAL(10,3) NOT NULL,
    cost_price      DECIMAL(10,3) NOT NULL,
    market_value    DECIMAL(16,2) NOT NULL,
    profit          DECIMAL(10,2) NOT NULL,
    profit_rate     DECIMAL(10,6) NOT NULL,
    weight          DECIMAL(6,4) NOT NULL,
    UNIQUE(backtest_id, trade_date, stock_code)
);
CREATE INDEX IF NOT EXISTS idx_positions_backtest_id 
    ON positions(backtest_id);

-- 5.7 日志表
CREATE TABLE IF NOT EXISTS logs (
    id              BIGINT       PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    log_date        DATE         NOT NULL,
    log_time        TIME         NOT NULL,
    level           VARCHAR(8)   NOT NULL 
                        CHECK (level IN ('info', 'warning', 'error', 'debug')),
    message         TEXT         NOT NULL,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_backtest_id 
    ON logs(backtest_id);
CREATE INDEX IF NOT EXISTS idx_logs_level 
    ON logs(level);

-- 5.8 策略代码表（1:1 with backtests）
CREATE TABLE IF NOT EXISTS backtest_code (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL UNIQUE REFERENCES backtests(backtest_id),
    language        VARCHAR(16)  NOT NULL DEFAULT 'python',
    code            TEXT         NOT NULL,
    code_hash       VARCHAR(64)  NOT NULL,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now')),
    updated_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_hash 
    ON backtest_code(code_hash);

-- 5.9 基准每日数据表
CREATE TABLE IF NOT EXISTS benchmark_daily_records (
    id                  BIGINT       PRIMARY KEY AUTOINCREMENT,
    backtest_id         VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date          DATE         NOT NULL,
    daily_return        DECIMAL(10,6) NOT NULL,
    cumulative_return   DECIMAL(10,6) NOT NULL,
    excess_return       DECIMAL(10,6) NOT NULL,
    close_price         DECIMAL(10,3) DEFAULT NULL,
    UNIQUE(backtest_id, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_backtest_id 
    ON benchmark_daily_records(backtest_id);
```

---

## 6. 数据初始化脚本

```sql
-- 插入示例用户
INSERT INTO users (username, email, password_hash) VALUES
('trader001', 'trader@example.com', 'hash_placeholder');

-- 插入示例策略
INSERT INTO algorithms (algorithm_id, user_id, name, description) VALUES
('4e5d0fa0f1dc303f9de6377e53c2064d', 1, '价值投资策略',  '低市盈率+高ROE选股'),
('9587ef3ae77e63836b79ddbbb903980c', 1, '动量策略',      '趋势跟踪+动量因子'),
('cdfabeb2fdbd3e2a4289b70e3818445e', 1, '均值回归策略',  '布林带均值回归');

-- 插入示例回测
INSERT INTO backtests (
    backtest_id, algorithm_id, algorithm_name,
    start_date, end_date, capital_base, frequency, status, progress,
    total_returns, annual_returns, max_drawdown, sharpe, volatility,
    alpha, beta, information_ratio, win_rate, trading_days
) VALUES (
    '886dc04e9fe1547dac9b4b43d647ae9d',
    '4e5d0fa0f1dc303f9de6377e53c2064d',
    '价值投资策略',
    '2023-01-01', '2023-12-31', 1000000, 'day', 'done', 100,
    0.2568, 0.1234, -0.1532, 1.28, 0.2156,
    0.0645, 0.8923, 0.45, 0.523, 242
);

-- 插入示例每日收益（前3天）
INSERT INTO daily_records (backtest_id, trade_date, daily_return, cumulative_return, total_assets, available_cash, position_value) VALUES
('886dc04e9fe1547dac9b4b43d647ae9d', '2023-01-02',  0.005200, 0.005200, 1005200, 500000, 505200),
('886dc04e9fe1547dac9b4b43d647ae9d', '2023-01-03', -0.003100, 0.002090, 1002090, 480000, 522090),
('886dc04e9fe1547dac9b4b43d647ae9d', '2023-01-04',  0.001800, 0.003890, 1003890, 450000, 553890);
```

---

## 7. API 与数据库映射

### 7.1 查询映射

| API 路由 | 数据库操作 | 涉及表 |
|----------|-----------|--------|
| `GET /api/algorithm/list` | `SELECT * FROM algorithms WHERE user_id = ?` | algorithms |
| `GET /api/backtest/:id/summary` | `SELECT * FROM backtests WHERE backtest_id = ?` | backtests |
| `GET /api/backtest/:id/returns` | `SELECT * FROM backtests WHERE backtest_id = ?` | backtests（指标） |
| | + `SELECT * FROM daily_records WHERE backtest_id = ? ORDER BY trade_date` | daily_records（时间序列） |
| `GET /api/backtest/:id/trades` | `SELECT * FROM trades WHERE backtest_id = ? ORDER BY trade_date, trade_time` | trades |
| `GET /api/backtest/:id/positions` | `SELECT * FROM positions WHERE backtest_id = ? ORDER BY trade_date, stock_code` | positions |
| `GET /api/backtest/:id/benchmark` | `SELECT * FROM backtests WHERE backtest_id = ?` | backtests（基准指标） |
| | + `SELECT * FROM benchmark_daily_records WHERE backtest_id = ? ORDER BY trade_date` | benchmark_daily_records |
| `GET /api/backtest/:id/logs` | `SELECT * FROM logs WHERE backtest_id = ? ORDER BY log_date, log_time` | logs |
| `GET /api/backtest/:id/code` | `SELECT * FROM backtest_code WHERE backtest_id = ?` | backtest_code |

### 7.2 数据组装逻辑

一个典型的回测详情页 API 调用，需要组装的数据流：

```
/algorithm/list
  └→ 从 algorithms 表查询用户策略列表

/backtest/:id/summary (合并了概要+指标+基准信息)
  ├→ backtests 表：查询回测配置+风险指标+基准指标
  └→ 直接返回单行记录的JSON

/backtest/:id/returns (时间序列数据组装)
  ├→ 从 backtests 查询 risk_metrics
  ├→ 从 daily_records 查询时间序列数组
  └→ 组装成 { totalReturns, annualReturns, ..., dates[], dailyReturns[], cumulativeReturns[] }

/backtest/:id/trades
  └→ 直接从 trades 表查询，日期排序后返回数组
```

### 7.3 批量写入场景（回测运行时）

```sql
-- 一次回测完成后的写入事务
BEGIN TRANSACTION;

-- 1. 更新回测主表
UPDATE backtests SET status = 'done', progress = 100, ... WHERE backtest_id = ?;

-- 2. 批量插入每日收益（242行）
INSERT INTO daily_records (backtest_id, trade_date, daily_return, ...) VALUES ...;

-- 3. 批量插入交易记录（13行）
INSERT INTO trades (backtest_id, trade_date, stock_code, ...) VALUES ...;

-- 4. 批量插入持仓记录（3行）
INSERT INTO positions (backtest_id, trade_date, stock_code, ...) VALUES ...;

-- 5. 批量插入基准数据（242行）
INSERT INTO benchmark_daily_records (backtest_id, trade_date, ...) VALUES ...;

-- 6. 批量插入日志（12行）
INSERT INTO logs (backtest_id, log_date, log_time, level, message) VALUES ...;

-- 7. 插入策略代码
INSERT INTO backtest_code (backtest_id, language, code, code_hash) VALUES ...;

COMMIT;
```

---

## 8. 性能与容量预估

### 8.1 数据量估算

| 表 | 单次回测行数 | 100次回测总行数 | 年数据增长 |
|----|-------------|----------------|-----------|
| algorithms | 3 | 300 | ~50 |
| backtests | 1 | 100 | ~50 |
| daily_records | 242 | 24,200 | 12,100 |
| trades | 13 | 1,300 | 650 |
| positions | 3 | 300 | 150 |
| logs | 12 | 1,200 | 600 |
| benchmark_daily_records | 242 | 24,200 | 12,100 |
| backtest_code | 1 | 100 | 50 |
| **合计** | **~517** | **~51,700** | **~25,100** |

### 8.2 SQLite 性能边界

| 指标 | SQLite 上限 | 本项目预计 | 结论 |
|------|------------|-----------|------|
| 单表最大行数 | ~10^12 | ~24,200/年 | 远低于上限 |
| 单次写入 | ~1000 rows/s | ~500 rows | 可毫秒级完成 |
| 查询响应 | <100ms | <10ms | 极快 |
| 数据库文件大小 | ~140TB | ~50MB/年 | 无需分库 |

### 8.3 升级到 MySQL 的时机

当满足以下任意条件时，建议从 SQLite 迁移到 MySQL：

1. 回测记录数超过 **10 万次**
2. 日活用户超过 **100**
3. 需要多用户并发写入回测数据
4. 需要部署到服务器提供在线服务