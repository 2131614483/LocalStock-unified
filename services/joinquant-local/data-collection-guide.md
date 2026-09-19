# 数据搜集清单

本文档列出项目中所有需要搜集的数据，按 **API 接口** 分类，标明每个字段的名称、类型、说明和数据来源建议。

---

## 目录

1. [回测概要数据](#1-回测概要数据)
2. [策略收益数据](#2-策略收益数据)
3. [交易详情数据](#3-交易详情数据)
4. [每日持仓收益数据](#4-每日持仓收益数据)
5. [基准收益数据](#5-基准收益数据)
6. [日志输出数据](#6-日志输出数据)
7. [策略代码数据](#7-策略代码数据)
8. [策略列表数据](#8-策略列表数据)
9. [页面配置数据](#9-页面配置数据)
10. [数据来源建议汇总](#10-数据来源建议汇总)

---

## 1. 回测概要数据

**接口**: `GET /api/backtest/:id/summary`
**用途**: 页面顶部 8 个摘要卡片

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 | 数据来源 |
|---|--------|--------|------|--------|------|----------|
| 1 | `backtestId` | 回测ID | string | `886dc04e9fe1547dac9b4b43d647ae9d` | 回测唯一标识 | 平台回测结果页URL参数 |
| 2 | `algorithmId` | 策略ID | string | `4e5d0fa0f1dc303f9de6377e53c2064d` | 关联的策略ID | 平台策略页URL参数 |
| 3 | `algorithmName` | 策略名称 | string | `价值投资策略` | 策略的名称 | 用户在平台创建策略时命名 |
| 4 | `startDate` | 回测开始日期 | string (date) | `2023-01-01` | 回测起止日期 | 回测参数配置 |
| 5 | `endDate` | 回测结束日期 | string (date) | `2023-12-31` | 回测起止日期 | 回测参数配置 |
| 6 | `capitalBase` | 初始资金 | number | `1000000` | 回测初始资金，单位元 | 回测参数配置 |
| 7 | `frequency` | 运行频率 | string | `日线` | 回测频率: `日线` 或 `分钟` | 回测参数配置 |
| 8 | `status` | 回测状态 | string | `done` | 回测状态: `running`(运行中) / `done`(已完成) / `failed`(失败) | 回测执行结果 |
| 9 | `progress` | 执行进度 | number | `100` | 0-100，百分比 | 回测执行过程记录 |
| 10 | `totalReturns` | 总收益率 | number | `0.2568` | 策略总收益率，小数形式(25.68%) | 回测计算结果 |
| 11 | `annualReturns` | 年化收益率 | number | `0.1234` | 年化收益率(12.34%) | 回测计算结果 |
| 12 | `maxDrawdown` | 最大回撤 | number | `-0.1532` | 最大回撤(-15.32%) | 回测计算结果 |
| 13 | `sharpe` | 夏普比率 | number | `1.28` | 夏普比率 | 回测计算结果 |
| 14 | `volatility` | 波动率 | number | `0.2156` | 年化波动率(21.56%) | 回测计算结果 |
| 15 | `alpha` | Alpha | number | `0.0645` | 阿尔法 | 回测计算结果 |
| 16 | `beta` | Beta | number | `0.8923` | 贝塔 | 回测计算结果 |
| 17 | `informationRatio` | 信息比率 | number | `0.45` | 信息比率 | 回测计算结果 |
| 18 | `winRate` | 胜率 | number | `0.523` | 交易胜率(52.3%) | 回测计算结果 |
| 19 | `tradingDays` | 交易天数 | number | `242` | 实际交易天数 | 回测计算结果 |

**需要搜集的数据量**: 每一条回测记录对应 1 行数据，包含上述 19 个字段。

---

## 2. 策略收益数据

**接口**: `GET /api/backtest/:id/returns`
**用途**: 累计收益率曲线图、每日收益率柱状图

### 2.1 基础指标

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 |
|---|--------|--------|------|--------|------|
| 1 | `totalReturns` | 总收益率 | number | `0.2568` | (同概要) |
| 2 | `annualReturns` | 年化收益率 | number | `0.1234` | (同概要) |
| 3 | `maxDrawdown` | 最大回撤 | number | `-0.1532` | (同概要) |
| 4 | `sharpe` | 夏普比率 | number | `1.28` | (同概要) |
| 5 | `volatility` | 波动率 | number | `0.2156` | (同概要) |
| 6 | `alpha` | Alpha | number | `0.0645` | (同概要) |
| 7 | `beta` | Beta | number | `0.8923` | (同概要) |
| 8 | `winRate` | 胜率 | number | `0.523` | (同概要) |
| 9 | `tradingDays` | 交易天数 | number | `242` | (同概要) |

### 2.2 时间序列数据（核心）

| # | 字段名 | 中文名 | 类型 | 示例值 | 数据量 | 说明 |
|---|--------|--------|------|--------|--------|------|
| 10 | `dates` | 交易日期序列 | string[] | `["2023-01-02", "2023-01-03", ...]` | 每日1条，约242条/年 | 时间轴X轴标签 |
| 11 | `dailyReturns` | 每日收益率序列 | number[] | `[0.0052, -0.0031, 0.0018, ...]` | 与dates等长 | 每日收益率，用于柱状图 |
| 12 | `cumulativeReturns` | 累计收益率序列 | number[] | `[0.0052, 0.0021, 0.0039, ...]` | 与dates等长 | 累计收益率曲线 |
| 13 | `benchmarkReturns` | 基准每日收益率 | number[] | `[0.0012, -0.0008, 0.0021, ...]` | 与dates等长 | 用于与策略收益对比 |

**数据关系说明**:
- `cumulativeReturns[i]` = (1 + cumulativeReturns[i-1]) * (1 + dailyReturns[i]) - 1
- 通常初始值 `cumulativeReturns[0]` = `dailyReturns[0]`

**需要搜集的数据量**:
- 时间序列数据是 **最大量的数据**
- 以沪深300为例，年交易天数 ≈ 242-250 天
- 例如 5 年的每日数据 = 约 1210 个交易日
- 每个交易日需要 4 个值 (date, dailyReturn, cumulativeReturn, benchmarkReturn)

---

## 3. 交易详情数据

**接口**: `GET /api/backtest/:id/trades`
**用途**: 交易记录表格

### 每条交易记录字段

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 |
|---|--------|--------|------|--------|------|
| 1 | `date` | 交易日期 | string | `2023-01-05` | 交易发生日期 |
| 2 | `stock` | 股票代码 | string | `000001.XSHE` | 平台格式，后缀.XSHE=深交所 .XSHG=上交所 |
| 3 | `stockName` | 股票名称 | string | `平安银行` | 股票的中文名称 |
| 4 | `direction` | 买卖方向 | string | `buy` | `buy`(买入) 或 `sell`(卖出) |
| 5 | `price` | 成交价格 | number | `14.25` | 每股成交价，单位元 |
| 6 | `volume` | 成交量 | number | `1000` | 成交股数 |
| 7 | `amount` | 成交金额 | number | `14250` | `price * volume`，单位元 |
| 8 | `commission` | 手续费 | number | `14.25` | 交易佣金，单位元 |
| 9 | `tax` | 税费 | number | `0` | 印花税等(卖出时征收) |
| 10 | `profit` | 盈亏 | number | `1540` | 平仓盈亏(卖出记录)，单位元；买入记录为0 |

**需要搜集的数据量**:
- 每条交易记录包含 10 个字段
- 交易次数取决于策略换手率：高频策略几千上万条，低频策略几十到几百条
- 示例中约 13 条交易记录

---

## 4. 每日持仓收益数据

**接口**: `GET /api/backtest/:id/positions`
**用途**: 每日持仓明细表格

### 每条持仓记录字段

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 |
|---|--------|--------|------|--------|------|
| 1 | `date` | 日期 | string | `2023-01-05` | 持仓估值日期 |
| 2 | `stock` | 股票代码 | string | `000001.XSHE` | 股票代码，同交易记录格式 |
| 3 | `stockName` | 股票名称 | string | `平安银行` | 股票中文名称 |
| 4 | `volume` | 持仓数量 | number | `1000` | 持有股数 |
| 5 | `price` | 当前价格 | number | `15.80` | 当日收盘价/市价 |
| 6 | `cost` | 成本价 | number | `14.25` | 持仓平均成本价 |
| 7 | `marketValue` | 市值 | number | `15800` | `volume * price` |
| 8 | `profit` | 盈亏 | number | `1550` | `marketValue - cost * volume` |
| 9 | `profitRate` | 盈亏比例 | number | `0.1088` | `(price - cost) / cost` |
| 10 | `weight` | 权重 | number | `0.15` | 该持仓市值占总资产比例 |

**需要搜集的数据量**:
- 每个交易日每条持仓股一条记录
- 例如5只股票×50个交易日 = 250条记录
- 每条记录包含 10 个字段

---

## 5. 基准收益数据

**接口**: `GET /api/backtest/:id/benchmark`
**用途**: 基准收益对比图、超额收益图、基准摘要卡片

### 5.1 基准信息

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 |
|---|--------|--------|------|--------|------|
| 1 | `benchmarkName` | 基准名称 | string | `沪深300指数` | 基准的名称 |
| 2 | `benchmarkCode` | 基准代码 | string | `000300.XSHG` | 平台格式的指数代码 |
| 3 | `totalReturns` | 基准总收益率 | number | `0.0892` | 基准在回测期间总收益 |
| 4 | `annualReturns` | 基准年化收益率 | number | `0.0580` | 基准年化收益率 |
| 5 | `maxDrawdown` | 基准最大回撤 | number | `-0.1280` | 基准最大回撤 |

### 5.2 基准时间序列数据

| # | 字段名 | 中文名 | 类型 | 数据量 | 说明 |
|---|--------|--------|------|--------|------|
| 6 | `dates` | 日期序列 | string[] | 与策略dates对齐 | 同策略收益的dates |
| 7 | `dailyReturns` | 基准每日收益率 | number[] | 与dates对齐 | 基准指数每日涨跌幅 |
| 8 | `cumulativeReturns` | 基准累计收益率 | number[] | 与dates对齐 | 基准累计收益曲线 |
| 9 | `excessReturns` | 超额收益序列 | number[] | 与dates对齐 | 策略dailyReturns - 基准dailyReturns |

**需要搜集的数据量**:
- 与策略收益数据量一致
- 每个交易日约 4 个值

---

## 6. 日志输出数据

**接口**: `GET /api/backtest/:id/logs`
**用途**: 日志输出面板，支持按级别过滤

### 每条日志字段

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 |
|---|--------|--------|------|--------|------|
| 1 | `date` | 日志日期 | string | `2023-01-02` | 日志发生的日期 |
| 2 | `time` | 日志时间 | string | `09:30:00` | 日志发生的具体时间 |
| 3 | `level` | 日志级别 | string | `info` | 可选: `info`(信息) / `warning`(警告) / `error`(错误) / `debug`(调试) |
| 4 | `message` | 日志内容 | string | `策略初始化完成，初始资金: ¥1,000,000` | 日志的文本内容 |

**日志级别说明**:
- `info` - 常规信息（初始化、调仓、买卖等）
- `warning` - 警告信息（异常波动、回撤预警等）
- `error` - 错误信息（下单失败、资金不足等）
- `debug` - 调试信息（可选）

**需要搜集的数据量**:
- 取决于策略运行时长和日志详细程度
- 日均约 5-20 条日志
- 242个交易日 × 10条 ≈ 2420条日志

---

## 7. 策略代码数据

**接口**: `GET /api/backtest/:id/code`
**用途**: 代码展示面板

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 |
|---|--------|--------|------|--------|------|
| 1 | `language` | 代码语言 | string | `python` | 目前固定为python |
| 2 | `code` | 策略代码 | string (多行) | `def initialize(context):...` | 完整的策略Python源代码 |

**需要搜集的数据量**:
- 每个策略 1 份 Python 源代码文件
- 长度不定，通常 50-500 行

---

## 8. 策略列表数据

**接口**: `GET /api/algorithm/list`
**用途**: 策略管理（当前在导航/编辑按钮中使用）

| # | 字段名 | 中文名 | 类型 | 示例值 | 说明 |
|---|--------|--------|------|--------|------|
| 1 | `algorithmId` | 策略ID | string | `4e5d0fa0f1dc303f9de6377e53c2064d` | 策略唯一标识 |
| 2 | `name` | 策略名称 | string | `价值投资策略` | 策略的中文名称 |
| 3 | `created` | 创建日期 | string | `2023-01-01` | 策略创建日期 |
| 4 | `status` | 策略状态 | string | `active` | `active`(启用) / `inactive`(停用) |

---

## 9. 页面配置数据

这些数据在页面中静态展示，不属于 API 数据，但作为回测参数配置需要提供。

| # | 字段名 | 对应页面元素 | 类型 | 示例值 | 说明 |
|---|--------|-------------|------|--------|------|
| 1 | 策略名称 | 页面标题 `#strategyName` | string | `价值投资策略` | 同概要数据 `algorithmName` |
| 2 | 回测期间 | `#backtestPeriod` | string | `2023-01-01 ~ 2023-12-31` | 同概要数据 |
| 3 | 初始资金 | `#initialCapital` | string | `¥1,000,000` | 同概要数据 `capitalBase` |
| 4 | 运行频率 | `#frequency` | string | `日线` | 同概要数据 `frequency` |

---

## 10. 数据来源建议汇总

### 数据集总览

| 数据类别 | 字段数/条 | 数据量估算 | 主要来源 |
|----------|----------|-----------|----------|
| 回测概要 | 19 字段 | 每次回测1条 | 平台回测结果 |
| 收益时间序列 | 4 数组 × 242 点 | 968 个数值/年 | 平台回测结果 / 自行计算 |
| 交易记录 | 10 字段/条 | 10-5000条 | 平台回测结果 |
| 持仓记录 | 10 字段/条 | 10-1000条 | 平台回测结果 |
| 基准数据 | 9 字段 + 3数组 | 与收益数据量相同 | 平台 / 公开指数数据 |
| 日志 | 4 字段/条 | 100-5000条 | 平台回测结果 |
| 策略代码 | 1 份代码 | 50-500行 | 用户编写的策略 |
| 策略列表 | 4 字段/条 | 1-20条 | 用户创建的策略 |

### 数据获取途径

| 数据类型 | 推荐获取方式 |
|----------|-------------|
| **回测结果数据**（收益、交易、持仓、日志） | 由本地回测引擎生成，可在回测详情页"导出CSV" |
| **股票行情数据** | 本地 CSMAR 数据库（`stock_data.db`）、Tushare、AKShare 等 |
| **指数基准数据** | 本地数据库 `get_price('000300.XSHG')`、中证指数官网 |
| **财务数据** | 东方财富、Wind 等 |
| **策略代码** | 用户在平台策略编辑器中编写 |
| **风险指标**（夏普、回撤等） | 平台回测结果自带，也可用Python计算（`numpy`/`pandas`） |

### 快速获取示例（Python）

```python
# 方式1: 从本地数据库获取
import sqlite3

# 获取沪深300每日行情作为基准
conn = sqlite3.connect('data/stock_data.db')
df = pd.read_sql("SELECT trade_date, close_price FROM stock_daily "
                 "WHERE stock_code='000300' ORDER BY trade_date", conn)
# 计算基准每日收益率
df['daily_return'] = df['close_price'].pct_change()
# 计算基准累计收益率
df['cum_return'] = (1 + df['daily_return']).cumprod() - 1

# 方式2: 从平台回测结果导出
# 在回测详情页 -> 点击"导出" -> 选择类型(交易/持仓/日志)
# 导出的CSV文件可直接用作数据源

# 方式3: 自行计算风险指标
import numpy as np

def calculate_metrics(daily_returns, rf=0.03):
    """计算策略风险指标"""
    total_return = (1 + daily_returns).prod() - 1
    annual_return = (1 + total_return) ** (252 / len(daily_returns)) - 1
    volatility = daily_returns.std() * np.sqrt(252)
    sharpe = (annual_return - rf) / volatility if volatility != 0 else 0
    max_drawdown = (1 + daily_returns).cumprod().div(
        (1 + daily_returns).cumprod().cummax()).min() - 1
    
    return {
        'totalReturns': total_return,
        'annualReturns': annual_return,
        'volatility': volatility,
        'sharpe': sharpe,
        'maxDrawdown': max_drawdown,
    }
```

### 数据文件建议格式

建议将搜集到的数据整理为 JSON 文件，放在 `mock/` 目录下，例如：

```
mock/
├── backtest-summary.json      # 回测概要
├── backtest-returns.json      # 策略收益（含时间序列）
├── backtest-trades.json       # 交易详情
├── backtest-positions.json    # 每日持仓收益
├── backtest-benchmark.json    # 基准收益
├── backtest-logs.json         # 日志输出
├── backtest-code.json         # 策略代码
└── algorithm-list.json        # 策略列表
```

每个 JSON 文件的结构参照 `server/index.js` 中对应路由的响应格式（`{ code: 0, data: {...}, message: 'success' }`）。