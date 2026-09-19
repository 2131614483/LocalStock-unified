# LocalStock Unified
> LocalStock Unified，一个完全本地运行的 A 股行情、量化回测与 AI 分析桌面工具。
三大组件：Electron 桌面端、聚宽兼容回测服务、价格行为 AI，共用一个本地 SQLite 行情库。
覆盖全市场 5973 只股票，日线从 1991 年 6 月至今，共约 1884 万行。
K 线从 1 分钟到季线全覆盖：1、5、15、30、60、120 分钟，再到日、周、月、季。叠加 MA、MACD、KDJ、布林线，五档盘口，指标参数全部可自定义。
画线支持趋势线、射线、水平、矩形、斐波那契、通道六种工具，手动画，也可以让 AI 直接画。
分时图实时刷新，右侧聚合个股新闻与公告，AI 自动梳理时间线。
内置布林、双均线、海龟等策略模板，CodeMirror Python 编辑器，一键回测。
聚宽兼容服务基于聚宽开源包 MIT 协议，海龟多因子回测年化 23%，夏普 0.65。
均线金叉死叉预警，全市场立即扫描，跨重启去重。
价格行为 AI 基于 Al Brooks 体系两阶段推理，输入 60 到 100 根 K 线，输出市场诊断与交易决策。
整个产品的设计思路是 AI 优先：AI 读全部行情、K 线、分时、盘口数据，能分析、能画线、能操作回测、能自动选股。写操作仅限三类，全部审计可一键回滚。
项目自带策略知识库，沉淀历史对话与验证过的策略。未来计划接入知识图谱，让算法自我进化；并支持接入组网平台扩展能力，后续会开发自动挖因子功能。
模型后端支持 DeepSeek、OpenCode、Anthropic、Ollama 本地，密钥只存运行态，不入库。
行情走东财、腾讯、新浪多源冗余，支持独立监盘窗、置顶大屏、任意视图拆浮窗。
全部数据本地存储，不登录、不联网也能用，数据不出本机。这就是 LocalStock Unified。
<img src="docs/_shots/desktop-watchlist.png" width="900">

> 本地量化工作台：Electron 桌面端 + 聚宽兼容回测服务 + 统一行情库 + 价格行为 AI，全部跑在本地，不依赖云端。


## 项目定位

LocalStock Unified 是把桌面行情软件、本地研究/回测服务、统一行情数据库和策略知识库合并到一个工作区后的后续开发版本。三件套：

- **桌面端** `apps/desktop`：Electron + React，自选股 / 沪深 A 股 / K 线多周期 / 回测编辑器 / 预警 / 画线 / AI 助手
- **聚宽服务** `services/joinquant-local`：Node Express + Python，:3000 端口，因子计算与策略回测
- **价格行为 AI** `apps/desktop/python/pa-agent`：Al Brooks 两阶段推理，随桌面端自动拉起，不单独运行

唯一权威行情库为 `data/market/stock_data.db`（约 6.7 GB，5973 只 A 股，约 1884 万行日线，1991-06-01 至今）。

## 快速开始

```powershell
cd D:\pythonpro\LocalStock-unified
npm run install:all
npm run verify:workspace
powershell -ExecutionPolicy Bypass -File .\tools\start-all.ps1
```

也可以分别启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-quant.ps1
powershell -ExecutionPolicy Bypass -File .\tools\start-desktop.ps1
```

## 界面预览

### 行情浏览

<img src="docs/_shots/desktop-watchlist.png" width="900">
*自选股主界面：红涨绿跌，实时刷新*

<img src="docs/_shots/desktop-market.png" width="900">
*沪深 A 股全市场：5973 只股票*

<img src="docs/_shots/desktop-minute.png" width="900">
*分时图：价格线 + 均价线 + 昨收*

### K 线多周期

<img src="docs/_shots/desktop-dayk.png" width="900">
*日 K：蜡烛 + MA + 五档盘口 + 画线 + 新闻聚合*

<img src="docs/_shots/desktop-weekk.png" width="900">
*周 K：本地日线聚合*

<img src="docs/_shots/desktop-monthk.png" width="900">
*月 K：长周期定位*

### 工具

<img src="docs/_shots/desktop-backtest.png" width="900">
*回测编辑器：策略模板 + CodeMirror Python*

<img src="docs/_shots/desktop-alert.png" width="900">
*预警规则：均线金叉死叉，立即扫描*

<img src="docs/_shots/desktop-drawing.png" width="900">
*K 线画线：趋势线拖拽，自动保存*

### AI 与设置

<img src="docs/_shots/desktop-ai-page.png" width="900">
*AI 助手独立页：读行情 / 写策略 / 选股*

<img src="docs/_shots/desktop-pa.png" width="900">
*价格行为 AI：贵州茅台 600519 日线 + EMA20 + 多阶段分析*

<img src="docs/_shots/desktop-settings.png" width="900">
*全局设置：行情刷新 / 图表快捷键 / AI 后端配置*

### 聚宽服务网页

<img src="docs/_shots/jq-algorithms.png" width="900">
*策略列表：12 个因子策略*

<img src="docs/_shots/jq-home.png" width="900">
*海龟多因子回测详情：总收益 49.53% / 年化 23.20% / 夏普 0.65*

## 核心目录

| 目录                           | 用途                            |
| ---------------------------- | ----------------------------- |
| `apps/desktop`               | LocalStock Electron/React 桌面端 |
| `services/joinquant-local`   | 聚宽兼容数据、因子和回测服务                |
| `data/market`                | 唯一权威行情数据库                     |
| `data/runtime`               | 桌面配置、回测结果和运行数据                |
| `data/snapshots`             | 迁移时的只读运行资料快照                  |
| `knowledge/strategy-library` | AI 策略知识库                      |
| `knowledge/conversations`    | 历史对话积累                        |
| `knowledge/project-history`  | 原测试证据和 Git 历史元数据              |
| `docs/migration`             | 架构、迁移清单和验证记录                  |
| `tools`                      | 统一环境、启动和验证脚本                  |

旧目录保持不动，不再作为后续开发入口。
