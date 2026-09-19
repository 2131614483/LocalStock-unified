# jqcompat 兼容层完成报告（2026-08-27）

> 位置：`engine/jqcompat.py`（聚宽-local，纯新增，不侵入既有引擎行为）
> 目标：255 个候选策略依赖的聚宽 API → 引擎可跑的最小桥接面

## 一、覆盖的 API（15 个面）

| API | 实现 | 验证 |
|---|---|---|
| `query()/valuation/indicator/balance/income/cash_flow` | 列引用+运算符 DSL | PB/ROE/市值多股查询 ✓ |
| `get_fundamentals(q, date)` | 批量因子+财务+市值 → pandas DataFrame | 全市场 3838 行 ✓ |
| `get_fundamentals_continuously(q, count)` | 采样最近 8 交易日近似 | 银行 250 日均值 ✓ |
| `get_current_data()` | CurrentDataDict（paused/is_st/name/last_price/涨跌停） | 待试点验证 |
| `get_index_stocks(idx)` | 市值排名近似成分（声明前视偏差） | 待试点验证 |
| `get_all_securities()` | 股票+基金全市场 | ✓ |
| `get_trade_days()` | trade_calendar | ✓ |
| `history(n, unit, field, security_list)` | 多证券 → DataFrame | 待试点验证 |
| `order_value/order_shares` | 引擎下单封装 | ✓ |
| `set_option` | 无操作 | ✓ |
| `log.set_level` | 无操作 | ✓ |
| `filter_st/paused/new/kcb` | 名称/状态/上市日过滤 | 待试点验证 |
| `get_extras('is_st')` | 当前名近似（声明前视偏差） | 待试点验证 |
| `get_factor_values` | 日线因子时间序列（上限 120 点） | 待试点验证 |
| `OrderCost` | 兼容 open_tax/close_today_commission 参数 | ✓ |

## 二、桩模块
`jqdata`/`jqfactor`/`kuanke`/`jqlib.technical_analysis` 空桩注册到 sys.modules，防策略头部 `import jqdata` 直接崩。

## 三、口径关键（易错，已钉死）

1. **percent 口径**：JQ 的 `indicator.roe=10.47` 表示 10.47%，因子库给小数 0.1047。
   兼容层对 `roe/roa/净利率/毛利率/增速` 等百分比字段统一 ×100 → 策略里 `/100`、`>15` 比较才对。
2. **列名=字段名**：query 里 `valuation.pb_ratio` 输出列叫 `pb_ratio`，`indicator.code` 输出叫 `code`。
3. **code 归一化**：`valuation.code=='000001.XSHE'` vs 库内纯 6 位——比较/`in_` 都去后缀。
4. **universe 提取**：`code.in_(...)` 和 `code==` 均提取为股票池，避免全市场扫描。
5. **估值映射**：`pb_ratio=1/bp`、`pe_ratio=1/ep_ttm`、`ps_ratio=1/sp_ttm`（BP/EP 因子入库），
   `turnover_ratio` 无流通股本 → NaN（报告声明近似）。

## 四、性能优化（从超时到 1.7s）

| 问题 | 根因 | 修复 |
|---|---|---|
| 银行策略 300s 超时 | `_fs_tail` 单股查询也全表加载 69 万行+全量 strptime | 加 `codes` 过滤（≤50 只走 IN 查询）|
| `get_fundamentals_continuously` 20 点 | PB/ROE 慢变量不需要高采样 | 上限 8 点，均值与 250 日接近 |

## 五、端到端验证

「银行翻倍」策略（26 只银行、月频选翻倍期最短 5 只等权）：
- **2023-06 ~ 2024-06 回测 1.7s 完成，34 笔交易，总收益 +16.1%、年化 +15.5%、夏普 0.96**
- 基准沪深300 同期 **-9.1%** —— 银行行情确实跑赢，逻辑方向正确
- 说明：该策略原宣称"翻倍"依赖 PB/ROE 长期均值，本地用 8 点均值近似，结果偏保守

## 六、待试点批次验证的坑（S3 冒烟会暴露）

- `get_current_data().paused` 是昨日 bar 快照，日内策略（打板/竞价）仍不可测
- `get_index_stocks` 市值近似成分 → 沪深300 等宽基池与真实成分有偏差，小市值策略尤其敏感
- `df.sort('col')`（老 pandas）→ 需改成 `sort_values`；`print x`（py2）→ `log.info`
- `.values.mean()` 依赖 pandas 真实对象可用 ✓（已确认 Anaconda 3.13）

## 下一步

- [ ] 试点批次：取 10 个候选策略（覆盖 get_fundamentals/get_current_data/get_index_stocks/history 各面），打通 S1~S5 全流程
- [ ] 批量评测：按目录推进，每策略一份报告