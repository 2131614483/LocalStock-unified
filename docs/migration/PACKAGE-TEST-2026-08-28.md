# 成品打包与运行测试（2026-08-28）

## 成品

- 便携程序：`apps/desktop/dist/LocalStock-portable-0.2.0.exe`
- 独立数据库：`apps/desktop/dist/data/stock_data.db`
- 展开版：`apps/desktop/dist/win-unpacked/LocalStock.exe`

数据库使用 NTFS 硬链接指向 `data/market/stock_data.db`，测试目录不额外占用一份 6.7GB 空间。发布或复制到其他磁盘时，需要同时复制 `LocalStock-portable-0.2.0.exe` 和旁边的 `data` 文件夹。

## 测试结果

- TypeScript 类型检查：通过。
- Vitest：17 个测试文件、96 项全部通过。
- Electron/Vite 生产构建：通过。
- electron-builder Windows portable 打包与签名流程：通过。
- SQLite 市场列表首次加载：约 806ms；内存缓存约 4.4ms；5,973 只证券。
- 新闻聚合：最新100条正常；K线日期前后10天历史检索正常，本次返回8条。
- AI多周期预测：12周期、代码编辑、滚动条、浮动/停靠、日K三条预测线均通过。
- 便携 EXE 直接启动：产生5个正常进程、1个主窗口，窗口标题 `LocalStock`，持续运行正常。
- 聚宽本地服务：端口3000启动正常，并读取统一行情数据库。

## 测试中修复

1. 增加 `PORTABLE_EXECUTABLE_DIR` 数据库路径识别，避免便携版解压到临时目录后找不到旁置数据库。
2. 限制AI多周期浮窗标题栏不超出屏幕，避免“停靠”按钮被拖出可视区。

测试结束后，所有测试程序和聚宽临时服务均已关闭。
