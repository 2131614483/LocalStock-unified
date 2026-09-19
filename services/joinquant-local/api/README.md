# 量化回测平台 API 接口文档

## 目录
1. [策略管理 API](#1-策略管理-api)
2. [回测管理 API](#2-回测管理-api)
3. [回测数据查询 API](#3-回测数据查询-api)
4. [模拟交易 API](#4-模拟交易-api)
5. [数据导出 API](#5-数据导出-api)
6. [jqdata Python SDK API](#6-jqdata-python-sdk-api)
9. [策略编写 API](#9-策略编写-api)
8. [本地服务 API](#8-本地服务-api本项目中实现)

---

## 1. 策略管理 API

### 1.1 获取策略列表
- **URL**: `GET /algorithm/index/list`
- **说明**: 获取用户所有策略列表
- **响应**: 策略列表（含策略ID、名称、创建时间等）

### 1.2 编辑策略
- **URL**: `GET /algorithm/index/edit?algorithmId={algorithmId}`
- **参数**: `algorithmId` - 策略ID
- **说明**: 获取策略编辑页面/数据

### 1.3 获取回测列表
- **URL**: `GET /algorithm/backtest/list?algorithmId={algorithmId}`
- **参数**: `algorithmId` - 策略ID
- **说明**: 获取某个策略的所有回测记录

### 1.4 获取回测构建列表
- **URL**: `GET /algorithm/backtest/buildList?algorithmId={algorithmId}`
- **参数**: `algorithmId` - 策略ID
- **说明**: 获取可构建的回测配置列表

---

## 2. 回测管理 API

### 2.1 获取回测详情
- **URL**: `GET /algorithm/backtest/detail?backtestId={backtestId}`
- **参数**: `backtestId` - 回测ID
- **说明**: 获取回测的完整详情，包含多个Tab页数据
- **Tab页**: 策略收益 | 交易详情 | 每日持仓收益 | 基准收益 | 日志输出 | 策略代码

### 2.2 运行回测
- **URL**: `POST /algorithm/backtest/run`
- **参数**: 
  - `algorithmId` - 策略ID
  - `backtest[code]` - 策略代码
  - `backtest[start_date]` - 开始日期
  - `backtest[end_date]` - 结束日期
  - `backtest[capital_base]` - 初始资金
  - `backtest[frequency]` - 运行频率（day/minute）
- **说明**: 启动新的回测任务

### 2.3 取消回测
- **URL**: `POST /algorithm/backtest/cancel`
- **参数**: `backtestId` - 回测ID
- **说明**: 取消正在运行的回测

---

## 3. 回测数据查询 API

### 3.1 策略收益数据
- **URL**: `GET /api/backtest/{backtestId}/returns`
- **响应字段**:
  - `daily_returns` - 每日收益率数组
  - `cumulative_returns` - 累计收益率数组
  - `total_returns` - 总收益率
  - `annual_returns` - 年化收益率
  - `max_drawdown` - 最大回撤
  - `sharpe` - 夏普比率
  - `volatility` - 波动率
  - `alpha` - Alpha
  - `beta` - Beta
  - `dates` - 交易日期数组
  - `benchmark_returns` - 基准收益率数组

### 3.2 交易详情
- **URL**: `GET /api/backtest/{backtestId}/trades`
- **响应字段**:
  - `date` - 交易日期
  - `stock` - 股票代码
  - `stock_name` - 股票名称
  - `direction` - 买卖方向（buy/sell）
  - `price` - 成交价格
  - `volume` - 成交量
  - `amount` - 成交金额
  - `commission` - 手续费
  - `tax` - 税费
  - `profit` - 盈亏

### 3.3 每日持仓收益
- **URL**: `GET /api/backtest/{backtestId}/positions`
- **响应字段**:
  - `date` - 日期
  - `stock` - 股票代码
  - `stock_name` - 股票名称
  - `volume` - 持仓数量
  - `price` - 当前价格
  - `cost` - 成本价
  - `market_value` - 市值
  - `profit` - 盈亏
  - `profit_rate` - 盈亏比例
  - `weight` - 权重

### 3.4 基准收益
- **URL**: `GET /api/backtest/{backtestId}/benchmark`
- **响应字段**:
  - `benchmark_name` - 基准名称
  - `daily_returns` - 基准每日收益率
  - `cumulative_returns` - 基准累计收益率
  - `excess_returns` - 超额收益

### 3.5 日志输出
- **URL**: `GET /api/backtest/{backtestId}/logs`
- **响应字段**:
  - `date` - 日志日期
  - `time` - 日志时间
  - `level` - 日志级别（info/warning/error）
  - `message` - 日志内容

### 3.6 策略代码
- **URL**: `GET /api/backtest/{backtestId}/code`
- **响应字段**:
  - `code` - 策略 Python 代码
  - `language` - 语言（python）

---

## 4. 模拟交易 API

### 4.1 获取模拟交易列表
- **URL**: `GET /algorithm/trade/list?process=1`
- **说明**: 获取正在运行/已结束的模拟交易列表

### 4.2 启动模拟交易
- **URL**: `POST /algorithm/trade/start`
- **参数**: `backtestId` - 基于某次回测启动模拟交易

---

## 5. 数据导出 API

### 5.1 导出CSV
- **URL**: `GET /algorithm/backtest/export`
- **参数**:
  - `type` - 导出类型: `transaction` | `position` | `log`
  - `backtestId` - 回测ID
- **说明**: 导出回测数据为CSV文件

### 5.2 分享回测
- **URL**: `GET /community/post/edit?backtestId={backtestId}`
- **说明**: 将回测结果分享到社区

---

## 6. jqdata Python SDK API

### 6.1 获取行情数据
```python
from jqdata import *

# 获取价格数据
df = get_price(security, start_date=None, end_date=None, 
               frequency='daily', fields=None, skip_paused=False, 
               fq='pre', count=None, panel=True, fill_paused=True)

# 参数说明：
#   security   - 股票代码或列表
#   start_date - 开始日期
#   end_date   - 结束日期
#   frequency  - 数据频率: daily/minute
#   fields     - 字段: ['open','close','high','low','volume','money']
#   fq         - 复权: pre(前复权)/post(后复权)/None(不复权)
#   count      - 数量（与start_date二选一）
```

### 6.2 获取财务数据
```python
# 获取财务数据
df = get_fundamentals(query_object, date=None, statDate=None)
```

### 6.3 获取交易日
```python
dates = get_trade_dates(start_date=None, end_date=None, count=None)
```

### 6.4 获取证券信息
```python
# 获取所有证券
securities = get_all_securities(types=['stock', 'fund', 'index', 'futures', 'etf', 'lof', 'fja', 'fjb', 'open_fund'], date=None)

# 获取证券详情
info = get_security_info(code)

# 获取指数成分股
stocks = get_index_stocks(index_symbol, date=None)

# 获取行业股票
stocks = get_industry_stocks(industry_code, date=None)
```

### 6.5 获取融资融券数据
```python
df = get_mtss(security_list, start_date, end_date, fields=None)
```

### 6.6 获取额外信息
```python
df = get_extras(info, security_list, start_date=None, end_date=None, df=True, count=None)
# info 可选: is_st, peak_vol, turnover_rate, acc_net_value, unit_net_value, adj_factor
```

---

## 8. 本地服务 API（本项目中实现）

以下 API 由本地 Express 服务提供，用于查询本地数据库中的回测数据和股票数据。

### 8.1 回测数据接口

| 方法 | 路由 | 说明 | 响应字段 |
|------|------|------|---------|
| GET | `/api/algorithm/list` | 策略列表 | `algorithm_id`, `name`, `created_at`, `status` |
| GET | `/api/backtest/:id/summary` | 回测概要 | 风险指标（总收益率、年化、最大回撤、夏普等） |
| GET | `/api/backtest/:id/returns` | 策略收益 | 含时间序列：`dates[]`, `dailyReturns[]`, `cumulativeReturns[]` |
| GET | `/api/backtest/:id/trades` | 交易详情 | `date`, `stock`, `stockName`, `direction`, `price`, `volume` 等 |
| GET | `/api/backtest/:id/positions` | 每日持仓 | `date`, `stock`, `volume`, `price`, `cost`, `marketValue`, `weight` 等 |
| GET | `/api/backtest/:id/benchmark` | 基准收益 | 含对比：`cumulativeReturns[]`, `excessReturns[]` |
| GET | `/api/backtest/:id/logs` | 日志输出 | 支持 `?level=info` 过滤 |
| GET | `/api/backtest/:id/code` | 策略代码 | `language`, `code` |

### 8.2 股票日线数据接口（CSMAR）

| 方法 | 路由 | 说明 | 参数 |
|------|------|------|------|
| GET | `/api/stock/:code/daily` | 单只股票日线数据 | `?start=&end=&fields=` |
| POST | `/api/stock/batch/daily` | 多只股票批量查询 | Body: `{ codes, start, end }` |
| GET | `/api/stock/market/:date` | 全市场某日快照 | 按总市值降序 |
| GET | `/api/stock/search?q=` | 搜索股票 | 支持代码/名称模糊搜索 |
| GET | `/api/stock/:code/return` | 股票收益率计算 | `?start=&end=` |
| GET | `/api/calendar?year=` | 交易日历 | 指定年份 |
| GET | `/api/stats` | 数据库统计 | 股票数、记录数、日期范围、文件大小 |

### 8.3 统一响应格式

```json
{
    "code": 0,
    "data": { ... },
    "message": "success"
}
```

错误时返回：
```json
{
    "code": -1,
    "message": "错误描述"
}
```

---

## 9. 策略编写 API

### 9.1 初始化函数
```python
def initialize(context):
    """策略初始化函数，在回测/实盘开始时调用一次"""
    # 设置股票池
    g.stocks = get_index_stocks('000300.XSHG')
    # 设置运行频率
    run_daily(func, time='9:30')
    run_weekly(func, weekday=1, time='14:00')
    run_monthly(func, monthday=1, time='10:00')
```

### 9.2 定时运行
```python
run_daily(func, time='9:30')     # 每日运行
run_weekly(func, weekday=1, time='14:00')  # 每周运行
run_monthly(func, monthday=1, time='10:00') # 每月运行
```

### 9.3 交易函数
```python
order(security, amount, style=None)                    # 按股数下单
order_target(security, amount, style=None)             # 调整目标股数
order_value(security, value, style=None)               # 按价值下单
order_target_value(security, value, style=None)        # 调整目标价值

# 市价单风格
MarketOrderStyle()      # 市价单
LimitOrderStyle(price)  # 限价单
```

### 9.4 查询函数
```python
get_open_orders()               # 获取未完成订单
cancel_order(order)             # 取消订单
get_orders()                    # 获取所有订单
get_trades()                    # 获取所有成交
get_current_data()              # 获取当前数据
get_history(count, unit='1d', field='close', security_list, fq='pre')  # 获取历史数据
attribute_history(security, count, unit='1d', fields, skip_paused=True, fq='pre', df=True)  # 获取属性历史
```

### 9.5 投资组合对象
```python
context.portfolio                    # 投资组合
context.portfolio.positions          # 持仓字典 {security: Position}
context.portfolio.available_cash     # 可用现金
context.portfolio.total_assets       # 总资产
context.portfolio.total_liabilities  # 总负债
context.portfolio.starting_cash      # 初始资金
context.portfolio.returns            # 组合收益率

# 持仓对象
position = context.portfolio.positions[security]
position.security       # 证券代码
position.total_amount   # 总股数
position.available      # 可用股数
position.price          # 当前价格
position.cost_basis     # 成本价
position.value          # 市值
position.pnl            # 盈亏
```

### 9.6 设置函数
```python
set_benchmark(security)                             # 设置基准
set_commission(PerTrade(buy_cost, sell_cost, min_cost))  # 设置手续费
set_slippage(slippage)                              # 设置滑点
set_option('use_real_price', value=True)            # 设置使用真实价格
log.set_level('order', 'error')                     # 设置日志级别
```