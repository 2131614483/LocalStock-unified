# 迁移记录（2026-08-28）

## 原始位置（只读历史版本）

- 桌面端：`D:\pythonpro\desktop\desktop`
- 聚宽服务：`D:\pythonpro\聚宽-local`
- 策略知识库：`D:\来自：分享`
- Claude 对话：`C:\Users\he\.claude\projects\D--pythonpro-desktop-desktop`

## 新位置

- `D:\pythonpro\LocalStock-unified`

## 数据库迁移

- 权威源：`D:\pythonpro\聚宽-local\data\stock_data.db`
- 新位置：`data\market\stock_data.db`
- 大小：6,677,073,920 字节
- SHA-256：`F8682A4267670BF89C17A7B9B57E5304EA7B41BBD655ACBBFBEE0AC29759D3BE`
- 复制后哈希核对：一致
- 聚宽服务兼容入口：`services\joinquant-local\data\stock_data.db`（硬链接到统一数据库）

## 已迁移的知识积累

- 桌面端 `docs`、交接文档与导入的历史对话
- 聚宽项目全部文档、策略评估源码与报告
- `D:\来自：分享` 策略知识库
- Claude 桌面项目对话文件
- 桌面端测试截图与验证结果
- 聚宽项目原 `.git` 元数据（归档到 `knowledge/project-history/joinquant-git-metadata`）

## 未复制的可再生成内容

- `node_modules`
- `dist*`、`out`
- IDE 缓存、Python 字节码
- 多份旧打包数据库副本

这些内容仍完整保留在原历史目录，可通过锁定版本重新安装或构建。

## 验证结果

- 新数据库可读：5,973 只证券、18,790,137 条日线。
- 日线日期范围：1991-06-01 至 2026-08-27。
- 桌面端 TypeScript 类型检查通过。
- 桌面端测试：17 个测试文件、96 项全部通过。
- 新目录聚宽服务已在隔离端口 3100 启动验证，`/api/stats` 与 `/api/calendar/range` 返回成功；验证后已关闭。
- 根目录已初始化为新的 Git 仓库；私人知识库、历史对话、数据库与运行状态不纳入 Git。
- Windows 计划任务 `QuantBacktestDataSync` 已从旧 `D:\pythonpro\聚宽-local` 切换到 `services\joinquant-local\scripts\unified_data_sync.py`；同步结果通过硬链接写入唯一权威数据库。
