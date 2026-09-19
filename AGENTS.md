# LocalStock Unified 工作区约定

- 后续开发只在本目录进行；旧目录 `D:\pythonpro\desktop\desktop` 与 `D:\pythonpro\聚宽-local` 是历史版本，只读保留。
- 桌面端源码位于 `apps/desktop`，聚宽服务位于 `services/joinquant-local`。
- 价格行为 AI 服务源码位于 `apps/desktop/python/pa-agent`（移植自 `D:\pythonpro\PA_Agent_616`，已剥离 Qt GUI），
  随桌面端打包，**由桌面端自动拉起/关闭**，不单独启动；只读统一行情库，
  大模型配置由桌面端按请求传入。
- 唯一权威行情库为 `data/market/stock_data.db`。不得在其他目录新增独立行情库副本。
  软件主体与数据库可分开存放：桌面端「设置 → 行情库位置」可选定任意位置的库文件，切换后立即生效。
- 聚宽运行结果位于 `data/runtime/joinquant`，桌面配置位于 `data/runtime/desktop`。
- 策略知识库位于 `knowledge/strategy-library`；迁移对话与项目历史位于 `knowledge/conversations`、`knowledge/project-history`。
- 启动前加载 `tools/workspace-env.ps1`；推荐使用 `tools/start-all.ps1`。
- 不提交数据库、运行状态、密钥、缓存、node_modules 或打包产物。
- 修改桌面端后至少运行根目录的 `npm run typecheck` 与 `npm test`。
