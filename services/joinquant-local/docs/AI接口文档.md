# AI 自主回测接口文档（/api/ai/*）

> 版本：2026-08-27 v1
> 基础地址：`http://localhost:3000`（默认端口，环境变量 `PORT` 可改）
> 服务启动：项目根目录 `npm start`（或 `node server/index.js`）
>
> 设计目标：AI（LLM Agent）用**最少的调用次数**完成「理解环境 → 写策略 → 跑回测 → 读结果 → 迭代」闭环。
> 所有接口返回统一 JSON：`{code, data, message}`；`code=0` 成功，非 0 失败且 `message` 可直接用于自我修正。

---

## 0. 快速开始（AI 三步跑通）

```bash
# 第一步：拉取策略 API 参考（可选，一次即可，约 6KB）
curl http://localhost:3000/api/ai/engine-docs

# 第二步：一步提交回测（创建+运行+持久化+指标全返回）
curl -X POST http://localhost:3000/api/ai/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "name": "银行等权月调仓",
    "startDate": "2024-01-01",
    "endDate": "2024-12-31",
    "capitalBase": 1000000,
    "code": "def initialize(context):\n    set_benchmark('000300.XSHG')\n    run_monthly(rebal, monthday=1)\n\ndef rebal(context):\n    for s in list(context.portfolio.positions):\n        order_target_value(s, 0)\n    for s in ['601398.XSHG','600036.XSHG']:\n        order_target_percent(s, 0.5)"
  }'

# 第三步：需要完整日线时，用返回的 data.backtestId 查历史结果
curl http://localhost:3000/api/backtest/<backtestId>/returns
```

### Python 调用模板

```python
import json, urllib.request

BASE = 'http://localhost:3000'

def ai_backtest(code, name='AI策略', start='2016-01-04', end='2026-08-25', capital=1_000_000):
    body = json.dumps({'code': code, 'name': name,
                       'startDate': start, 'endDate': end,
                       'capitalBase': capital}).encode('utf-8')
    req = urllib.request.Request(f'{BASE}/api/ai/backtest', data=body,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r:
        resp = json.loads(r.read().decode('utf-8'))
    if resp['code'] != 0:
        raise RuntimeError(resp['message'])   # AI 可捕获后按 message 自我修正
    d = resp['data']
    return {
        'backtestId': d['backtestId'],      # 后续查完整数据用
        'metrics': {k: d['metrics'][k] for k in (
            'totalReturns','annualReturns','maxDrawdown','sharpe','volatility',
            'alpha','beta','informationRatio','winRate','tradesCount',
            'benchmarkTotalReturns','benchmarkAnnualReturns')},
        'equity_curve_tail': [(x['date'], x['total_assets']) for x in d['dailyRecords']],
    }

result = ai_backtest('''
def initialize(context):
    set_benchmark('000300.XSHG')
    g.stocks = get_all_stocks()[:50]
    run_monthly(rebal, monthday=1)

def rebal(context):
    fac = get_factors(g.stocks[:200], ['mom_6m'])
    scored = sorted(((s, f.get('mom_6m')) for s, f in fac.items() if f.get('mom_6m')),
                    key=lambda x: x[1], reverse=True)
    targets = [s for s, _ in scored[:10]]
    held = list(context.portfolio.positions)
    for s in held:
        if s not in targets:
            order_target_value(s, 0)
    for s in targets:
        order_target_percent(s, 0.95 / max(len(targets), 1))
''')
print(result['metrics'])
```

---

## 1. AI 核心接口

### 1.1 `POST /api/ai/backtest` —— 一步完成回测 ⭐ 核心

一次调用 = 存代码 + 执行引擎 + 结果持久化 + 返回全部指标。

**请求体：**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| code | string | ✅ | — | 策略 Python 源码。**必须含 `def initialize(context)`**；末尾函数定义即可 |
| name | string | | `'AI-<时间戳>'` | 策略名（落库 algorithms.name） |
| startDate | string | | `2016-01-04` | 回测起始日 `YYYY-MM-DD` |
| endDate | string | | `2026-08-25` | 回测结束日 |
| capitalBase | number | | `1000000` | 初始资金（元） |
| persist | bool | | `true` | false 时只跑不存（快速试参数） |
| saveAlgorithmId | string | | — | 挂到已有算法下（否则自动新建） |
| dailyRecordsLimit | int | | `30` | 返回日线条数上限 3000（取**尾部** N 条防 token 超限） |

**响应 `data`：**

```jsonc
{
  "backtestId": "4b091338c82863ae5fa98986a2f2e62d",   // 用于后续查询
  "metrics": {          // 与 GET /api/backtest/:id/summary 的 metrics 相同结构（camelCase）
    "tradingDays": 242,         "totalReturns": 0.305872,
    "annualReturns": 0.320352,  "maxDrawdown": -0.132194,
    "sharpe": 1.4275,           "volatility": 0.203393,
    "alpha": 0.2124,            "beta": 0.4712,
    "informationRatio": 0.5884, "winRate": 0.7778,
    "tradesCount": 39,          "positionsCount": 782,
    "benchmarkTotalReturns": 0.161991, "benchmarkAnnualReturns": 0.169222,
    "benchmarkMaxDrawdown": -0.157017, "benchmarkVolatility": 0.213402
  },
  "dailyRecords": [ {"date","daily_return","cumulative_return","total_assets","available_cash","position_value"} ×N ],
  "tradesRecent":  [ 最近50笔 {"date","stock","direction","price","volume","amount","commission","tax","profit"} ],
  "logsTail":      [ 最近100条 {"level","message"} ]   // 引擎警告都在这（涨停拒单/除息分红/资金不足）
}
```

**错误自诊断约定**（AI 收到非 0 就改代码重试）：

| message 特征 | 含义 | 修正方向 |
|---|---|---|
| `code 必填且必须定义 initialize...` | 缺初始化函数 | 补 def initialize(context) |
| `日期超出数据范围...1991 ~ ...` | 区间越界 | 用 /api/calendar/range 查实际范围 |
| `策略输出非纯JSON（可能含 print）` | 策略用了 print | 全部改 log.info |
| `initialize 执行错误: NameError...` | API 拼写错误 | 对照 engine-docs 修正函数名 |
| `调度函数执行错误`（在 logsTail 里） | 业务逻辑 bug | 看 traceback 首行 |

**性能参考**：单股简单策略 1~3 秒；全市场基本面选股 5~130 秒；超过 120 秒考虑降低调仓频率。

### 1.2 `GET /api/ai/engine-docs` —— 策略 API 参考（机器可读）

返回 `{strategyApi: {24个API签名+说明}, conventions:[7条口径铁律], workflow:[...]}`。
**AI 写策略前建议先拉一次并放进上下文**——里面有所有可用函数、字段名、口径（percent 化）、禁止事项。要点摘录：

- 代码格式：`000001.XSHE` / `600519.XSHG`
- `log.info()` 代替 print（stdout 必须纯 JSON）
- 涨跌停拒买/卖、除息分红入账、基金免印花税由引擎自动执行
- 基本面字段 = 报告期 + 4 个月滞后对齐；指标字段为百分数口径（roe=10.47 表示 10.47%）

### 1.3 `GET /api/factors` —— 因子库清单

返回 25 个因子的 `{name, direction(+1越大越好/-1), source(stock_daily/fs_*), params, desc}`：
动量 mom_1m/3m/6m/12m/12m1m、反转 rev_5d/10d、波动 vol_20d/60d、流动性 liq_20d、换手 turnover_20d、RSI rsi_14、均线偏离 ma_dev_20、规模 ln_cap、价值 ep_ttm/ep_annual/bp/sp_ttm、质量 roe_ttm/roe_annual/gross_margin/debt_ratio/op_cf_ratio、成长 rev_growth_yr/profit_growth_yr。

策略内通过 `get_factors(stocks, [factors], date)` 使用；时间序列版用 `get_factor_values(securities, factors, count=N)`。

---

## 2. 结果读取接口（沿用既有路由，AI 直接可用）

以下接口已在 Web 版存在，凭 `/api/ai/backtest` 返回的 `backtestId` 即可使用：

| 接口 | 内容 | AI 典型用途 |
|---|---|---|
| `GET /api/backtest/:id/summary` | 全部指标 + 元信息 | 对比多策略排名 |
| `GET /api/backtest/:id/returns` | 完整每日净值序列 | 画净值/算自定义指标 |
| `GET /api/backtest/:id/trades` | 全部成交记录 | 分析交易行为/胜率归因 |
| `GET /api/backtest/:id/positions` | 每日持仓快照 | 持仓集中度/行业暴露分析 |
| `GET /api/backtest/:id/benchmark` | 基准日收益+超额 | 相对强弱曲线 |
| `GET /api/backtest/:id/logs?level=` | 引擎日志（可过滤 warning） | 定位拒单/异常原因 |
| `GET /api/backtest/:id/code` | 策略源码 | 回读历史策略修改迭代 |
| `GET /api/backtest/:id/export?type=transaction\|positions\|returns` | CSV 导出 | 落盘做深度分析 |

响应字段说明（camelCase）：summary 的键即 metrics 键名（`total_returns` 在该接口叫 `totalReturns`）。

### 辅助数据接口（写策略时可用来探数据）

| 接口 | 用途 |
|---|---|
| `GET /api/calendar/range` | 数据覆盖区间（1991-06 ~ 2026-08-25） |
| `GET /api/calendar?year=` | 交易日列表 |
| `GET /api/stock/:code/daily?start=&end=` | 单只股票日线 OHLCV |
| `POST /api/stock/batch/daily` `{codes,start,end}` | 批量收盘价 |
| `GET /api/stock/search?q=` | 按名称/代码搜股票 |
| `GET /api/index/:code/daily` | 指数日线（000905 已回填长史） |
| `GET /api/stats` | 数据库规模总览 |

---

## 3. AI 写策略速查（engine-docs 浓缩版）

### 最小骨架

```python
def initialize(context):
    set_benchmark('000300.XSHG')
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(open_tax=0, close_tax=0.001, open_commission=0.0003,
                             close_commission=0.0003, min_commission=5))
    run_monthly(rebal, monthday=1)

def rebal(context):
    ...
```

### 调度三件套

| 函数 | 触发 |
|---|---|
| `run_daily(fn)` | 每个交易日 |
| `run_weekly(fn, weekday=1)` | isoweekday==weekday 的交易日（1~5） |
| `run_monthly(fn, monthday=1)` | 当日 day==monthday 或月末兜底 |

> ⚠️ 无 handle_data 也行；若注册了任何 run_*，老式 handle_data 不再自动调用。

### 数据获取（本地可用面）

```python
h = attribute_history(s, 20, '1d', ('close','high','low'))   # 单股截至昨日；high/low 为真实值
ma20 = h['close'].mean(); last = h.close[-1]

cd = get_current_data()
cd[s].paused / cd[s].is_st / cd[s].last_price / cd[s].high_limit / cd[s].low_limit

stocks = get_all_stocks()                  # 已剔 ST/停牌/次新/B/北交所/金融
idx300 = get_index_stocks('000300.XSHG')   # 市值前300近似
all_secs = get_all_securities(['etf'])     # DataFrame(index=带后缀代码) 含 start_date/end_date/display_name

q = query(valuation.code, valuation.market_cap, indicator.roe)\
       .filter(valuation.market_cap < 50e9, indicator.roe > 15)\
       .order_by(valuation.market_cap.asc()).limit(50)
df = get_fundamentals(q)                   # pandas DataFrame，列名=字段名，indicator 类是百分数

hist = history(60, '1d', 'close', funds)   # DataFrame(index=日期, columns=证券)
```

### 下单

```python
order_target_value(s, 0)            # 清仓
order_target_value(s, 100000)       # 目标市值
order_target_percent(s, 0.05)       # 目标占总资产比例（推荐等权）
order_value(s, cash*0.3)            # 增量下单（负数卖出）
order_target(s, shares)             # 目标股数
```

引擎内置风控（无需写）：涨停拒买入、跌停拒卖出、整百股、佣金印花税滑点、除息分红入账。

### context / g

```python
context.portfolio.total_value / .cash / .positions[s].price|.avg_cost|.amount|.value|.closeable_amount
context.current_dt          # datetime，当日日期
context.previous_date       # 上一交易日 'YYYY-MM-DD' 字符串
g.anything = ...            # 全局变量容器
```

### 七条口径铁律（conventions）

1. 价格为原始不复权价 → 不要自己算复权，直接用 close 收益序列与 dretwd
2. 分红已自动入账（含股息的收益不用额外处理）
3. 涨跌停/整百股/费用已自动处理
4. 日线收盘撮合，无分钟
5. 基本面 +4 个月滞后（防未来函数）；金融股已被剔除出 get_all_stocks
6. 无退市股 → 幸存者偏差：小市值长周期结论必须声明
7. 指数成分=市值近似（000300 前 300 等），作宽基代理可以、精确轮动需谨慎

---

## 4. 数据资产规模（供 AI 判断可行性）

| 表 | 行数 | 说明 |
|---|---|---|
| stock_daily | 18,784,968 | 5973 只 A 股 1991→2026-08-25（不复权价 + 高低价真实 + 分红因子 + 市值千元） |
| fund_daily | 437,032 | 195 只 ETF/LOF 2012→2026 |
| index_daily | 119,679 | 含中证500/上证50/创业板指/中证1000/国证2000 长史 |
| fs_combas/comins/comscfd | 69万×3 | 三大报表（A 合并口径） |
| stocks / trade_calendar | 5,973 / 8,629 | 主档/交易日历 |

分钟线、期货、转债：未入库（计划任务逐步积累中）；涉及这些的策略请直接否决而不是硬测。

---

## 5. 既有 Web 流程接口（兼容层，前端继续用）

原有 26 个路由不变：算法 CRUD (`/api/algorithm/*`)、回测提交 (`POST /api/backtest/:id/run`)、逐项查询（summary/returns/trades/positions/benchmark/logs/code/kline/export）。AI 接口与其共享同一引擎与数据库表，互不影响。

**对比**：Web 流程需要 `create → 写code → run → summary` 四次调用；AI 流程一次 `/api/ai/backtest` 完成。

---

## 6. 并发与限制

- 引擎执行为同步阻塞（execFile），同一时刻一个请求占用一个 Python 子进程；大量并发会排队。AI agent 建议**串行调用**或 persist=false 先快筛再正式跑。
- 单次引擎超时 600 秒；maxBuffer 200MB。
- stdout 卫生：策略里禁止 print()/matplotlib show；日志走 log.info（会出现在 logsTail）。
- 端口冲突：Windows 保留段可能占 3000，`PORT=8080 node server/index.js` 更换。

---

## 附：变更记录

- 2026-08-27：新增 `/api/ai/backtest`、`/api/ai/engine-docs`、`/api/factors`；冒烟测试全通过（银行等权 2024：+30.6% vs 基准 +16.2%，39 笔）；本文档创建。
