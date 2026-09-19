# 694 个聚宽精选策略 · 本地回测评测总方案（2026-08-25）

> 任务：对 `D:\来自：分享` 下 7 个目录、694 个聚宽精选策略逐个执行
> 「合理性审查 →（否决出报告）→ 改写适配 → 本地回测 → 评测报告」全流程。
> 工作区：`D:\pythonpro\聚宽-local\strategy-eval\`

## 一、资源现状（已实测）

### 数据库 `D:\pythonpro\聚宽-local\data\stock_data.db`（6.3 GB）
| 表 | 规模 | 说明 |
|---|---|---|
| stock_daily | 1878 万行 | 5973 只，1991→2026-08-25，**原始不复权价**，含市值/复权因子 |
| stocks | 5973 | 含名称/上市日/market_type；无历史 ST 状态 |
| fs_combas / fs_comins / fs_comscfd | 各 ~69 万行 | 三大报表，report_type='A' |
| index_daily | 9.8 万行 | 仅 000001/000300/399001 等有长史；**000905 只有 41 行** |
| trade_calendar | 8629 交易日 | 到 2026-08-25 |

### 引擎 `D:\pythonpro\聚宽-local\engine\backtest_engine.py`
- 聚宽 API 子集：set_benchmark/slippage/order_cost、run_daily/weekly/monthly、
  attribute_history/get_price、order/order_target/order_target_value/**order_target_percent**、
  **get_all_stocks / get_factors / get_factor / rank_normalize**（多因子跨截面选股）。
- 日线收盘价撮合、整百股、佣金+印花税+滑点。纯日线，无分钟。
- 实测：动量月调仓策略两年回测 22s 完成。

## 二、策略普查结果（inventory.json）

- 总数 **694**（2020:99 / 2021:99 / 2022:97 / 2023:99 / 2024×2:200 / 2025:100）
- 第一轮静态分类：**candidate 255 / reject 439**
- reject 原因分布：ETF基金 248、机器学习 144、分钟级 83、期货 63、转债 38、资金流 32、宏观 10
  （注：ETF 类在 P2 数据补全后部分解锁）
- 编码：2020 目录是 GB18030，其余 UTF-8-SIG

### 引擎不支持的常用 API（候选 255 个中的需求量）
set_option 199 / get_current_data 159 / valuation 157 / get_fundamentals 121 /
history 116 / get_index_stocks 110 / indicator 110 / order_value 69 /
filter_st_stock 52 / jqfactor 51 / industry 75 / concept 42 …

→ **结论：必须先建「聚宽 API 兼容层」（jqcompat），把上述 API 映射到本地数据**，
否则每个策略都要手工改写，工作量爆炸。

## 三、评测流水线（每策略五步）

```
S1 合理性审查   数学原理/逻辑自洽性/过拟合嫌疑/数据可行性
                ├─ 不合理 → 否决报告 reports/S1_否决/<id>.md（说明数学或逻辑理由）
                └─ 合理但缺数据 → 挂起等数据补全
S2 代码适配     经 jqcompat 兼容层改写为引擎可跑（adapted/<id>.py）
S3 试运行       短区间(1年)冒烟测试，捕获 API 缺口/崩溃
S4 正式回测     全区间 2016-01-01 ~ 2026-08-25（10.6 年），100 万本金
S5 评测报告     reports/<id>.md：原理/数学公式/适配改动/回测指标/结论
```

### 统一评测口径
- 区间 2016~2026（覆盖 16 熊、19 牛、20 疫情、21 抱团瓦解、22-23 熊、24-25 行情）
- 基准：沪深300（000300）；报告中同时给中证500 对照
- 成本：滑点 FixedSlippage(0.02) + 标准佣金印花税（与原策略设置一致优先）
- 指标：总收益/年化/夏普/最大回撤/胜率/换手 vs 沪深300 同期
- 判定：年化跑赢基准且夏普>0 → 有效；否则注明失效及可能原因（幸存者偏差/因子反转/过拟合）

## 四、文档产出约定

1. 每个策略一份报告（S1 否决报告或 S5 评测报告），命名 `<年份>-<序号>-<简称>.md`
2. 每完成一个目录（如 2020 年度精选）写一份目录级汇总
3. 总进度看 `reports/_进度看板.md`（每批更新）
4. 所有日志进 `logs/`
5. 最终汇总《694策略评测总结报告》：通过率/因子有效性统计/与 Obsidian 多因子研究结论对照

## 五、当前状态与下一步

- [x] 数据源探测（见 reports/数据补全方案.md）
- [x] 策略普查 inventory.json（255 candidate）
- [x] P0 指数回填（中证500/上证50/创业板指/中证1000/中证流通/国证2000，22,075 行）
- [x] P1 高低价回填（1155 万行）+ 引擎分红入账/涨跌停约束/真实高低价
- [x] P2 ETF fund_daily 回填（195 只 / 43.7 万行）+ 引擎基金路由/免印花税
- [x] jqcompat 兼容层（engine/jqcompat.py，15 个聚宽 API 面，银行翻倍策略端到端验证）
- [ ] 试点批次：10 个代表性策略打通 S1~S5 全流程
- [ ] 批量执行（按目录推进）

## 附：关键坑备忘

- 策略文件编码两种（GB18030 / UTF-8-SIG），读取用 fallback 链
- 库内代码 6 位纯数字，策略带 .XSHG/.XSHE 后缀
- mkt_cap_total 千元×1000；B002000101=归母净利；high/low 曾全 NULL（P1 解决）
- 幸存者偏差：库内无退市股，长周期收益偏高——所有报告统一声明
- 财报对齐：报告期+4 个月滞后（防未来函数）
- 引擎 stdout 必须纯 JSON：适配时删 print()、禁 matplotlib
