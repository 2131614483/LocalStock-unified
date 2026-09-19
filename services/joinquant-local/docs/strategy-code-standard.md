# 量化回测平台策略代码写作标准

> 适用于在本平台编写、编辑、运行的量化回测策略代码。
> 遵循本标准可保证策略：可被本地回测引擎解析执行、可读可维护。

---

## 1. 总体原则

| 原则 | 说明 |
|------|------|
| **单一职责** | 一个策略文件只实现一个交易逻辑，不混入数据下载、绘图等无关代码 |
| **可复现** | 相同参数 + 相同回测区间，结果必须可复现；禁止依赖外部随机源或实时网络请求 |
| **防御性编程** | 所有外部数据（行情、持仓）使用前必须判空，避免 IndexError / KeyError 导致回测中断 |
| **注释优先** | 关键逻辑必须有中文注释；参数必须有含义说明 |

---

## 2. 文件结构

一个标准的策略文件按以下顺序组织，**必须包含初始化函数**：

```python
# ==================== 1. 导入区（可选） ====================
# 平台内置 API 无需 import，仅自定义库需要

# ==================== 2. 全局参数区 ====================
# 策略可调参数集中声明，便于调参

# ==================== 3. 初始化函数（必须） ====================
def initialize(context):
    """策略初始化，仅执行一次"""
    ...

# ==================== 4. 定时调度函数 ====================
def rebalance(context):
    """主调仓逻辑"""
    ...

# ==================== 5. 生命周期钩子（可选） ====================
def before_trading_start(context): ...
def after_trading_end(context): ...
def on_strategy_end(context): ...

# ==================== 6. 辅助函数 ====================
def calc_signal(stock): ...
def filter_stocks(context): ...
```

---

## 3. 函数规范

### 3.1 必须函数：`initialize(context)`

每个策略**必须**定义 `initialize`，且只执行一次：

```python
def initialize(context):
    # 1. 设置基准（必须）
    set_benchmark('000300.XSHG')

    # 2. 设置交易成本（推荐，默认值对真实回测不准确）
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(
        close_tax=0.001,            # 卖出印花税
        open_commission=0.0003,     # 买入佣金
        close_commission=0.0003,    # 卖出佣金
        min_commission=5            # 最低佣金 5 元
    ), type='stock')

    # 3. 声明策略参数到全局对象 g
    g.short_window = 5
    g.long_window = 20
    g.max_position = 5

    # 4. 注册定时调度
    run_daily(rebalance, time='09:30')
```

### 3.2 函数命名

| 函数类型 | 命名规则 | 示例 |
|---------|---------|------|
| 平台生命周期钩子 | 固定名，不可改 | `initialize` / `before_trading_start` / `after_trading_end` |
| 主调仓函数 | 动词，描述动作 | `rebalance` / `trade` / `adjust_positions` |
| 辅助函数 | `动词_名词` 或 `calc_xxx` | `filter_stocks` / `calc_ma` / `get_signal` |
| 布尔判断函数 | `is_xxx` / `has_xxx` | `is_golden_cross` / `has_position` |

### 3.3 参数与返回值

- 函数参数 ≤ 5 个；超过应封装为字典
- 辅助函数必须有 `return`，禁止靠副作用传值
- 返回多个值用元组并注释：`return signal, weight  # (信号, 权重)`

---

## 4. 全局参数 `g` 对象

策略参数**必须**挂在平台内置的全局对象 `g` 上，禁止用 Python `global`：

```python
# ✅ 正确
def initialize(context):
    g.short_window = 5
    g.stocks = ['000001.XSHE', '600519.XSHG']

# ❌ 错误：global 变量在回测引擎中行为不可控
short_window = 5
```

### 参数命名约定

| 类型 | 前缀 | 示例 |
|------|------|------|
| 周期/窗口 | `_window` | `g.short_window`, `g.long_window` |
| 阈值 | `_threshold` / `_ratio` | `g.stop_loss_threshold` |
| 标的列表 | `_stocks` / `_universe` | `g.target_stocks` |
| 时间 | `_time` | `g_rebalance_time` |

---

## 5. 调度函数规范

平台支持多种调度方式，按需选择：

| 调度函数 | 频率 | 适用场景 |
|---------|------|---------|
| `run_daily(fn, time)` | 每日固定时刻 | 日频策略（最常用） |
| `run_weekly(fn, weekday, time)` | 每周 | 周频调仓 |
| `run_monthly(fn, monthday, time)` | 每月 | 月频调仓 |
| `run_minute(fn)` | 每分钟 | 日内/高频（慎用，速度慢） |

**规范**：
- 调仓时间统一用 `'09:30'`（开盘）或 `'14:50'`（尾盘），避免盘中随意时刻
- 一个策略的调仓频率必须固定，禁止在运行时动态切换频率
- `time` 参数格式必须是 `'HH:MM'` 字符串

```python
# ✅ 正确
run_daily(rebalance, time='09:30')

# ❌ 错误：动态频率
if context.current_dt.day < 15:
    run_daily(rebalance, time='09:30')
```

---

## 6. 下单函数规范

平台提供多种下单 API，**按优先级选择**：

| 场景 | 推荐函数 | 说明 |
|------|---------|------|
| 按目标金额调仓 | `order_target_value(stock, value)` | **首选**，自动计算差额 |
| 按目标比例调仓 | `order_target_percent(stock, pct)` | 等权/按权重配置 |
| 按目标股数调仓 | `order_target(stock, count)` | 清仓时用 `order_target(stock, 0)` |
| 按指定数量下单 | `order(stock, amount)` | 不推荐，需自行计算 |

### 规范

```python
# ✅ 正确：按目标金额，引擎自动算差额
order_target_value(stock, context.portfolio.total_value * 0.2)

# ✅ 正确：清仓
order_target(stock, 0)

# ❌ 错误：未判断资金是否足够
order(stock, 10000)  # 可能因资金不足报错
```

- 下单前必须检查 `context.portfolio.available_cash` 或使用 `order_target_*` 让引擎自动处理
- 下单后必须记录日志（见第 8 节）
- 禁止在 `after_trading_end` 中下单（收盘后无法成交）

---

## 7. 数据获取规范

### 7.1 历史 K 线

```python
# ✅ 首选：attribute_history（轻量，返回 DataFrame）
hist = attribute_history(stock, 20, '1d', ('close', 'volume'))
close = hist['close']

# ✅ 批量多股票：get_price
df = get_price(['000001.XSHE', '600519.XSHG'],
               end_date=context.current_dt,
               count=20, frequency='daily',
               fields=['close'], panel=False)
```

### 7.2 防御性检查

所有取数后**必须判空**：

```python
# ✅ 正确
hist = attribute_history(stock, 20, '1d', ('close',))
if hist is None or len(hist) < g.long_window:
    log.warn('%s 数据不足，跳过' % stock)
    continue
short_ma = hist['close'][-g.short_window:].mean()
```

### 7.3 禁止事项

- 禁止使用 `get_current_data()` 在 `initialize` 中获取实时数据（此时无盘口）
- 禁止用未来数据：`attribute_history` 默认不含当日，不要用 `get_price` 的 `end_date` 设为未来
- 禁止在循环中重复调用 `attribute_history` 取同一只股票同一周期数据，应缓存

---

## 8. 日志规范

| 级别 | 函数 | 使用场景 |
|------|------|---------|
| `log.info` | 常规信息 | 初始化完成、调仓开始、买卖记录 |
| `log.warn` | 警告 | 数据不足、停牌跳过、资金不足 |
| `log.error` | 错误 | 不可恢复异常（但策略应 try-catch 而非直接崩） |

### 格式约定

```python
# 买卖日志：方向 + 标的 + 关键数值
log.info('金叉买入 %s 金额=%.0f' % (stock, value))
log.info('死叉卖出 %s' % stock)

# 参数日志：键=值
log.info('策略参数: short=%d, long=%d' % (g.short_window, g.long_window))

# 状态日志
log.info('当日持仓: %s' % list(context.portfolio.positions.keys()))
```

- 日志消息用中文，便于复盘
- 数值保留 2 位小数（金额）或 4 位小数（比例）
- 禁止 `print()`，必须用 `log.*`

---

## 9. 注释规范

### 9.1 必须注释的位置

1. `initialize` 顶部：策略名称 + 一句话描述
2. 每个策略参数：含义 + 单位
3. 核心交易逻辑：买卖条件
4. 复杂计算公式：变量含义

```python
def initialize(context):
    """
    策略名称：双均线交叉
    逻辑：短期均线上穿长期均线买入，下穿卖出
    """
    set_benchmark('000300.XSHG')

    g.short_window = 5      # 短期均线周期（交易日）
    g.long_window = 20      # 长期均线周期（交易日）
    g.stocks = [...]        # 目标股票池
```

### 9.2 禁止

- 禁止注释代码（删除即删除，版本管理交给 git）
- 禁止无意义注释：`x = x + 1  # x加1`

---

## 10. 风险控制规范

回测策略**必须**包含以下风控逻辑之一：

### 10.1 止损

```python
# 个股止损：持仓亏损超过阈值则清仓
position = context.portfolio.positions[stock]
if position.price < position.avg_cost * (1 - g.stop_loss_threshold):
    order_target(stock, 0)
    log.warn('止损卖出 %s 亏损=%.2f%%' % (stock, loss_pct))
```

### 10.2 仓位控制

```python
# 单只股票最大权重 20%
max_weight = 0.2
target_value = min(value, context.portfolio.total_value * max_weight)
order_target_value(stock, target_value)
```

### 10.3 推荐风控参数

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| 个股止损 | 8%~10% | 超过则趋势可能已破坏 |
| 单票最大权重 | 20% | 分散风险 |
| 最大持仓数 | 5~10 只 | 过多则管理困难 |
| 最大回撤止损 | 15% | 组合级别熔断 |

---

## 11. 代码风格

| 项目 | 规范 | 示例 |
|------|------|------|
| 缩进 | 4 个空格，禁止 Tab | `    set_benchmark(...)` |
| 行宽 | ≤ 100 字符 | 超长用括号换行 |
| 变量命名 | `snake_case` | `short_ma`, `target_weight` |
| 常量命名 | `UPPER_SNAKE` | `MAX_POSITION = 5` |
| 字符串引号 | 单引号 `'` | `'000300.XSHG'` |
| 股票代码 | 带后缀 | `'000001.XSHE'`（深圳）/ `'600519.XSHG'`（上海） |
| 百分比 | 小数表示 | `0.001` 表示 0.1%，不用 `0.1%` |

---

## 12. 本地模拟引擎兼容性

本平台的"运行回测"使用本地回测引擎，需额外注意：

| 平台 API | 本地引擎支持 | 说明 |
|---------|-------------|------|
| `set_benchmark` | ✅ 解析 | 提取基准代码 |
| `set_slippage` / `set_order_cost` | ✅ 解析 | 提取费率参数 |
| `run_daily` / `run_monthly` | ✅ 解析 | 提取频率 |
| `g.xxx = ...` | ✅ 解析 | 提取策略参数（short_window/long_window 等） |
| `log.info/warn/error` | ✅ 模拟 | 生成日志记录 |
| `attribute_history` | ⚠️ 模拟 | 本地用几何布朗运动模拟价格，非真实行情 |
| `order_target_value` | ⚠️ 模拟 | 本地按等权模拟，不计算真实差额 |

### 本地引擎识别参数

本地引擎会从 `g` 对象提取以下参数用于模拟，**命名必须一致**：

```python
g.short_window = 5       # 短期均线周期
g.long_window = 20       # 长期均线周期
g.stocks = [...]         # 股票池（引擎会读取标的数量）
```

如需扩展模拟参数，在 `server/db.js` 的 `runBacktestSimulation` 中添加。

---

## 13. 检查清单

策略提交前逐项确认：

- [ ] `initialize` 函数存在且只调用一次
- [ ] 设置了 `set_benchmark`
- [ ] 设置了 `set_slippage` 和 `set_order_cost`
- [ ] 策略参数全部挂在 `g` 对象上
- [ ] 调仓频率固定，使用 `run_daily/weekly/monthly`
- [ ] 使用 `order_target_*` 而非 `order`
- [ ] 所有 `attribute_history` 返回值有判空
- [ ] 买卖操作有 `log.info` 记录
- [ ] 包含止损或仓位控制风控逻辑
- [ ] 无 `print()`，无 `global`，无 Tab 缩进
- [ ] 关键逻辑有中文注释
- [ ] 股票代码带 `.XSHE` / `.XSHG` 后缀

---

## 附录：完整示例

```python
def initialize(context):
    """
    策略名称：双均线交叉
    逻辑：短期均线上穿长期均线买入，下穿卖出
    基准：沪深300
    """
    set_benchmark('000300.XSHG')
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(
        close_tax=0.001,
        open_commission=0.0003,
        close_commission=0.0003,
        min_commission=5
    ), type='stock')

    g.short_window = 5          # 短期均线周期（交易日）
    g.long_window = 20          # 长期均线周期（交易日）
    g.stop_loss_threshold = 0.08  # 止损阈值 8%
    g.stocks = [
        '000001.XSHE', '600519.XSHG', '000858.XSHE',
        '601318.XSHG', '000333.XSHE'
    ]

    log.info('双均线交叉策略初始化完成')
    run_daily(rebalance, time='09:30')


def rebalance(context):
    """每日调仓：金叉买入，死叉卖出"""
    target_weight = 1.0 / len(g.stocks)

    for stock in g.stocks:
        hist = attribute_history(stock, g.long_window + 1, '1d', ('close',))
        if hist is None or len(hist) < g.long_window:
            log.warn('%s 数据不足，跳过' % stock)
            continue

        short_ma = hist['close'][-g.short_window:].mean()
        long_ma = hist['close'][-g.long_window:].mean()
        held = stock in context.portfolio.positions

        # 止损检查
        if held:
            position = context.portfolio.positions[stock]
            loss_ratio = (position.price - position.avg_cost) / position.avg_cost
            if loss_ratio < -g.stop_loss_threshold:
                order_target(stock, 0)
                log.warn('止损卖出 %s 亏损=%.2f%%' % (stock, loss_ratio * 100))
                continue

        # 金叉买入
        if short_ma > long_ma and not held:
            order_target_value(stock, context.portfolio.total_value * target_weight)
            log.info('金叉买入 %s' % stock)

        # 死叉卖出
        elif short_ma < long_ma and held:
            order_target(stock, 0)
            log.info('死叉卖出 %s' % stock)


def after_trading_end(context):
    """收盘后记录持仓"""
    log.info('当日持仓: %s' % list(context.portfolio.positions.keys()))
```

---

## 多因子策略（新增 API）

引擎新增跨截面选股 API（`engine/backtest_engine.py` + `engine/factor_calc_stdlib.py`），策略可直接全市场打分选股，无需固定股票池。

### 新增平台 API

| API | 说明 |
|-----|------|
| `get_all_stocks(date=None)` | 全市场可交易股票列表（带后缀；自动过滤 ST/涨跌停/停牌/次新/B股/北交所/金融股） |
| `get_factors(stocks, factors, date=None)` | 批量取因子截面，返回 `{股票: {因子: 值}}` |
| `get_factor(stock, factor, date=None)` | 单股单因子 |
| `rank_normalize(dict)` | 截面 z-score 归一化（返回新 dict） |
| `order_target_percent(stock, pct)` | 按总资产目标比例下单 |

因子名见 `scripts/factor_registry.json`（动量/价值/质量/成长/低波/规模/技术面约 20 个）。基本面因子用报告期+4 个月披露滞后对齐（无未来函数）；动量跳过最近 20 交易日。

### 多因子策略模板（月度调仓）

```python
def initialize(context):
    set_benchmark('000300.XSHG')
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(close_tax=0.001, open_commission=0.0003,
                   close_commission=0.0003, min_commission=5), type='stock')
    g.n_stocks = 30
    g.weights = {'bp': 0.6, 'ep_ttm': 0.4}   # 权重按研究结论定
    g.stop_loss = -0.08
    run_monthly(rebalance, monthday=1, time='09:30')

def rebalance(context):
    stocks = get_all_stocks()
    if len(stocks) < g.n_stocks * 3:
        return
    data = get_factors(stocks, list(g.weights.keys()))
    scores = {}
    for f, w in g.weights.items():
        vals = {s: d.get(f) for s, d in data.items()}
        z = rank_normalize(vals)             # 逐因子截面 z-score
        for s in stocks:
            scores[s] = scores.get(s, 0) + w * z.get(s, 0)
    ranked = sorted(scores, key=lambda s: scores[s], reverse=True)[:g.n_stocks]
    # 等权调仓（含止损）
    for s in list(context.portfolio.positions.keys()):
        pos = context.portfolio.positions[s]
        if pos.avg_cost and (pos.price - pos.avg_cost) / pos.avg_cost < g.stop_loss:
            order_target(s, 0)
    pct = 1.0 / g.n_stocks
    for s in ranked:
        order_target_percent(s, pct)
    for s in list(context.portfolio.positions.keys()):
        if s not in ranked:
            order_target(s, 0)
```

要点：
- 因子值先 `rank_normalize` 再加权（不同因子量纲不同，直接相加会被大数值因子主导）。
- 综合策略建议价值/质量为核心权重、动量/低波辅助（A 股动量在 2018-2026 方向反转）。
- 策略文件见 `scripts/strategies/`，入库用 `python scripts/seed_strategies.py`。
