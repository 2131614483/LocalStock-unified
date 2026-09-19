# LocalStock Unified

本文件是 Claude Code 在本仓库工作时的统一入口。后续开发只在
`D:\pythonpro\LocalStock-unified` 进行；旧目录 `D:\pythonpro\desktop\desktop` 与
`D:\pythonpro\聚宽-local` 仅作历史参考，不要在那里修改代码。

## 接手前必读

- 桌面端：`apps/desktop/CLAUDE.md`、`apps/desktop/docs/项目交接文档.md`
- 聚宽兼容服务：`services/joinquant-local/CLAUDE.md`、`services/joinquant-local/HANDOVER.md`
- 统一架构与迁移记录：`docs/migration/ARCHITECTURE.md`、`docs/migration/`
- Claude 历史对话原文：`knowledge/conversations/claude-desktop/`
- Claude 对话摘要：`apps/desktop/docs/imported-conversations/README.md` 及同目录下的专题文档

子项目文档包含各自的架构、接口契约、数据口径和常见陷阱；修改对应子项目时必须同时遵守。

Claude 历史导入包括三个完整 JSONL 会话及其 memory 文件。涉及 UI、打包版或算法画线问题时，先阅读
`apps/desktop/docs/imported-conversations/股票软件UI优化方案.md`、`apps/desktop/docs/UI问题排查与优化方案.md`
和 `apps/desktop/docs/踩坑记录.md`；涉及策略评估时，再阅读同目录的
`量化策略评估与回测.md`。

## 工作区边界与核心约束

- `apps/desktop` 是 Electron + React 桌面端。
- `services/joinquant-local` 是聚宽兼容的本地研究/回测服务。
- `apps/desktop/python/pa-agent` 是桌面端自动拉起和关闭的价格行为 AI 服务，不单独启动。
- `data/market/stock_data.db` 是唯一权威行情库。不得在其他目录新建独立行情库副本；桌面端可通过设置选择外部库文件。
- 聚宽运行结果写入 `data/runtime/joinquant`，桌面配置写入 `data/runtime/desktop`。
- 策略知识库位于 `knowledge/strategy-library`；迁移对话和项目历史位于 `knowledge/conversations`、`knowledge/project-history`。
- 不提交数据库、运行状态、密钥、缓存、`node_modules` 或构建产物。
- 不要修改旧目录，也不要通过复制行情库制造第二份权威数据。

## 环境、启动与验证

开始工作前加载 `tools/workspace-env.ps1`；推荐使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-all.ps1
```

分别启动时使用 `tools/start-quant.ps1` 和 `tools/start-desktop.ps1`。修改桌面端后，至少从仓库根目录执行：

```powershell
npm run typecheck
npm test
```

如果根目录脚本不可用，进入 `apps/desktop` 执行其 `package.json` 中对应的 `npm run typecheck` 和 `npm test`。修改桌面 UI 后，还要按桌面端文档中的视觉测试流程验证打包产物。

## 跨模块修改规则

- 桌面端新增或修改 IPC 时，保持 `apps/desktop/shared/types.ts`、`electron/preload.ts` 和对应 handler 三处契约同步。
- 所有模块必须继续使用统一行情库路径解析，不要硬编码新的数据库路径。
- Python 回测/算法子进程的 stdout 必须保持约定的纯 JSON 或 JSONL 格式；日志使用 `log()` 或 stderr，不能用额外 `print()` 污染机器可解析输出。
- 变更数据同步、回测口径或因子定义时，同时检查生产引擎、研究脚本和相关文档。
- 保留用户已有的未提交改动；修改前先查看 `git status`，不要使用破坏性重置或覆盖命令。

## 目录速查

| 路径 | 内容 |
|---|---|
| `apps/desktop` | Electron 桌面应用与 Python AI 子服务 |
| `services/joinquant-local` | Node/Express + Python 本地量化服务 |
| `data/market` | 唯一权威行情数据库 |
| `data/runtime` | 运行状态与配置 |
| `knowledge` | 策略知识、对话和项目历史 |
| `docs/migration` | 统一架构、迁移清单和验证记录 |
| `tools` | 环境、启动和工作区验证脚本 |
