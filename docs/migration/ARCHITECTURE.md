# 统一项目架构

```text
LocalStock-unified/
├─ apps/desktop/                  Electron + React 股票软件
│  └─ python/pa-agent/            价格行为 AI 服务（随桌面端分发，自动启停）
├─ services/joinquant-local/      聚宽兼容研究与回测服务
├─ data/
│  ├─ market/stock_data.db        唯一权威行情库
│  ├─ runtime/desktop/            新版本独立桌面配置
│  ├─ runtime/joinquant/          回测结果与同步状态
│  └─ snapshots/                  原运行资料完整快照
├─ knowledge/
│  ├─ strategy-library/           默认 AI 策略知识库
│  ├─ conversations/              Claude 历史对话
│  └─ project-history/            测试证据及旧 Git 元数据
├─ docs/migration/                迁移与架构记录
└─ tools/                         统一启动环境
```

## 数据流

```text
data/market/stock_data.db
        ├──> apps/desktop（行情、K线、轻量回测）
        ├──> services/joinquant-local（因子、长历史、聚宽回测）
        └──> apps/desktop 托管的 pa-agent（价格行为分析，仅只读）

knowledge/strategy-library
        └──> apps/desktop AI 知识库工具

services/joinquant-local :3000
        └──> apps/desktop Electron 主进程量化网关

apps/desktop 托管的 pa-agent（端口自动分配）
        └──> apps/desktop Electron 主进程（价格行为 AI 页，SSE 流式）
```

桌面端与各服务通过环境变量读取统一数据；聚宽服务目录中的 `data/stock_data.db` 是同一 NTFS 文件的硬链接，不占用第二份空间。

**注意**：硬链接仅用于服务目录的兼容入口。构建产物（`apps/desktop/dist/**`）**不要**硬链接权威库 ——
electron-builder 重建 `dist/` 时就地覆盖会连带破坏共享 inode（2026-09-09 曾因此损坏唯一权威库）。便携包应在打包时复制。
