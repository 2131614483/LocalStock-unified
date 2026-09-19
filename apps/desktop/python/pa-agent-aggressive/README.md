# pa-agent（LocalStock 集成版）

价格行为（Price Action / Al Brooks 体系）AI 决策服务的**无界面服务端**，
移植自 `PA_Agent_616`（PyQt6 桌面版）。源码随桌面端一起分发，**由桌面端自动启动**，
用户无需手动运行任何脚本。

## 与原项目的关系

| 部分 | 处理 |
|---|---|
| `pa_agent/ai/`、`orchestrator/`、`indicators/`、`records/`、`config/`、`util/` | 原样移植（核心资产） |
| `pa_agent/gui/`、`main.py`、`demo/`、`notify/` | **已剥离**（界面由 Electron/React 重写） |
| `pa_agent/data/` | 保留框架，新增 `localstock_source.py` 直读统一行情库 |
| 依赖 PyQt6/pyqtgraph 的 3 个文件 | 改为纯 Python（`event_bus` / `session_ledger` / `refresh_loop`） |

## 目录

```
apps/desktop/python/pa-agent/
├─ pa_agent/              核心逻辑（约 2.2 万行）
│  ├─ ai/                 提示词组装、决策节点引擎、JSON 校验、归一化
│  ├─ orchestrator/       两阶段流水线（two_stage.py 为入口）
│  ├─ data/               数据源框架 + localstock_source.py（本项目新增）
│  ├─ records/            分析记录落盘
│  ├─ indicators/         EMA20 / ATR14
│  └─ util/              事件总线、取消令牌等
├─ pa_service/            服务端装配层（runtime.py）
├─ prompt_engineering/    中文策略提示词（原样复制）
├─ scripts/setup_env.py   一键建 venv 装依赖（桌面端「安装运行环境」调用）
├─ config/                配置模板
├─ server.py              HTTP + SSE 入口
└─ requirements.txt
```

## 启动方式

**用户视角：不需要做任何事。** 打开桌面端即自动拉起服务；关闭桌面端即自动关闭
（被强制结束时由服务端的父进程守护兜底退出）。

### 运行环境是自动准备的（可迁移的关键）

服务**始终跑在自己的虚拟环境里**（`<userData>/pa-agent-venv`），不依赖系统
Python 的包 —— 避免版本漂移与"本机恰好缺某个包"。首次启动自动走一遍：

| 顺序 | 条件 | 动作 |
|---|---|---|
| 1 | venv 已就绪 | 直接用，**零下载** |
| 2 | 本机有可用 Python（设置 `pythonPath` › 随程序分发的 runtime › 官方安装目录 › PATH） | 用它建 venv + 装依赖 |
| 3 | **一个都没有** | 从 GitHub 下载独立 CPython（21MB）→ 再建 venv |

因此把项目拷到另一台电脑（哪怕没装 Python）也能直接跑起来。

- **pip 默认走清华镜像**（`https://pypi.tuna.tsinghua.edu.cn/simple`），不依赖本机 pip 配置；
  可用 `--index-url` 或环境变量 `PA_AGENT_PIP_INDEX` 覆盖。
- **独立 Python 的下载按可用性排序**：GitHub 代理（ghproxy.net、gh-proxy.com）优先，
  官方地址兜底（实测国内直连 GitHub release 常返回 HTTP 000）。可用
  `PA_AGENT_PY_DOWNLOAD_BASE` 指定自己的镜像前缀。
- 调试用 `LOCALSTOCK_PA_FORCE_DOWNLOAD=1` 可强制走"本机没有 Python"分支。

失败时界面显示「运行环境未就绪」+ 可操作入口（重新准备 / 重启服务 / 查看日志）。
机制实现在 `apps/desktop/electron/pa/runtime.ts`（环境供给）与 `server.ts`（进程托管）。

### 日志

服务同时写 stderr 与**日志文件**（滚动，单文件 2MB / 保留 3 份）：

```
<userData>/pa-agent/logs/pa_agent.log
```

开发时 userData 是工作区的 `data/runtime/desktop`，打包版是 `%APPDATA%/localstock-desktop`。
界面「查看日志」只显示最近 80 行并给出完整路径。启动时会记录 python 版本、cwd、
运行目录、行情库路径 —— 排查"为什么连不上"先看这一行。

健康检查会被高频轮询（启动探活 10 秒内约 40 次），因此**同一个失败原因只记一次**，
恢复时记一条"已恢复正常"，避免日志被同一句话刷满。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 行情库路径、股票数、数据范围 |
| GET | `/api/symbols?q=&limit=` | 证券搜索 |
| GET | `/api/kline?symbol=&timeframe=&bars=` | K 线（日/周/月） |
| POST | `/api/analyze` | 提交分析，返回 `text/event-stream` |
| POST | `/api/cancel` | 取消分析（body: `{"jobId": "..."}`） |

`/api/analyze` 请求体（大模型配置**由桌面端按请求传入**，服务端不落盘密钥）：

```json
{
  "symbol": "600519",
  "timeframe": "1d",
  "barCount": 60,
  "analysisMode": "original",
  "llm": {
    "provider": "openai",
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "",
    "model": "qwen3_27b_iq3xxs_40k:latest"
  }
}
```

SSE 事件：`started`、`frame_ready`、`stage_event`、`stage1_reasoning`、
`stage1_content`、`stage2_reasoning`、`stage2_content`、`prompt`、
`stage2_files`、`token_update`、`done`、`error`、`closed`。

## 环境变量

| 变量 | 说明 | 由谁设置 |
|---|---|---|
| `LOCALSTOCK_MARKET_DB` | 统一行情库路径（只读） | Electron（`stockDataPath()`，可由设置页「行情库位置」覆盖） |
| `LOCALSTOCK_PA_RUNTIME_DIR` | 分析记录/日志落盘目录 | Electron（`<userData>/pa-agent`） |
| `PA_AGENT_PORT` | 监听端口；`0` = 系统分配 | Electron（固定用 0） |
| `PA_AGENT_PORT_FILE` | 绑定成功后写入真实端口 | Electron |
| `PA_AGENT_PARENT_PID` | 父进程 PID；父死则自退 | Electron |
| `PA_AGENT_HOST` | 监听地址 | 可选，默认 `127.0.0.1` |

## 独立调试

不启动桌面端时也可单独跑（仅调试用）：

```bash
pip install -r requirements.txt
python server.py                 # 默认 127.0.0.1:3210
```

未设置 `PA_AGENT_PARENT_PID` 时不会启用父进程守护，行为与普通服务一致。

## 依赖说明

`requirements.txt` 只有 4 项：`openai`、`pydantic`、`jsonschema`、`tzdata`。

- **`tzdata` 必需**：Windows 没有系统时区库，`zoneinfo.ZoneInfo("Asia/Shanghai")`
  会抛 `ZoneInfoNotFoundError`，导致 `pa_agent.data.ashare_common` 及其下游
  （含 `localstock_source`）全部导入失败。这个坑只在最小依赖环境才暴露。
- `tiktoken` **可选**（仅 token 估算，`ai/token_counter.py` 有字符数/4 兜底，且当前无人调用）。
- 未使用 `numpy`/`pandas`（原 GUI 与在线数据源才需要）。
- `pa_agent/data/eastmoney_*`、`sinatencent_source` 需要 `requests`，本集成不使用，
  它们导入失败不影响服务。

## 已知约束

1. **价格口径为不复权原始价**。`stock_daily` 的 OHLC 是 bfq 原始价（与桌面端 K 线图一致，
   便于把入场/止损/止盈直接叠加到图上），因此除权日会出现缺口，可能被误判为跳空。
   `adj_close_nd` 为后复权收盘，但复权因子在部分区间缺失（约 7.8% 的行因子为 1.0），
   暂不足以可靠还原前复权。
2. **提示词体积大**：60 根 K 线约 35.6k tokens，100 根约 67.4k tokens。
   本地模型需相应上下文窗口；上下文不足会被网关直接拒绝（服务端已转成中文可操作提示）。
3. **模型能力要求高**：阶段一/二的 JSON schema 约束严格，小模型（如 7B）会把模板
   字面量抄回导致校验失败。建议云端模型或 ≥27B 且上下文 ≥64k。
4. 周/月线由日线聚合（open=首、close=末、high/low=极值、量额=求和）。

## 开发说明

- 原项目的 `analysis_mode` 是死配置（用 `getattr` + `hasattr` 读取一个不存在的字段），
  本版已将其补为 `GeneralSettings.analysis_mode` 正式字段，`original`/`optimized` 才真正生效。
- `pa_agent/config/paths.py` 逐级上溯找工作区根（开发布局），找不到时回落到
  `LOCALSTOCK_PA_RUNTIME_DIR` 或服务目录旁的 `runtime/`，因此打包后也能正常落盘。
- 桌面端只以**只读**方式打开行情库，绝不写回。
