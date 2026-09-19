# 导入交接：股票软件 UI 优化方案

## 来源与目标

- Claude 会话：`c60f752a-3379-4dde-a250-2230f4baa7ed.jsonl`
- 会话标题：股票软件UI优化方案
- 原始工作区：`D:\pythonpro\desktop\desktop`
- 用户目标：全面了解股票桌面软件，排查报错、缩放和美观问题，先形成方案，再逐阶段落地并完成真实 UI/视觉验证。

## 已完成的主线工作

详细设计、改动说明和踩坑记录已在 `docs/UI问题排查与优化方案.md` 中维护。对话中确认完成：

- P0：图表跟随容器缩放、表头吸顶、深色原生控件、分时标签、K 线 legend 与 dataZoom 视觉问题。
- P1：全局缩放、窗口状态记忆、深色自绘标题栏、SplitPane 钳制、5 日分时拖拽、逐笔涨跌闪烁、指数盘口处理。
- P2：本地行情列、响应式布局、表格与按钮、空态、快捷键、无障碍、分页、错误可见化、单实例锁等。
- P3：Lucide 图标、CodeMirror Python 编辑器、Markdown 代码高亮、ECharts 主题集中。
- 后续项：表格列宽拖拽与 localStorage 记忆；StockTable 行级 `React.memo` 和稳定回调；明确不引入虚拟滚动及 ECharts series 增量更新。
- 当时完整基线曾达到：TypeScript 0 错误、单测 83/83、视觉回归 3/3、P0/P1 专项探针通过。

## 关键设计决定与已知坑

- ECharts 必须通过 `ResizeObserver` 跟随实际容器尺寸，不能只监听系统窗口 resize。
- 渲染层不能直接 `import 'electron'`；缩放 API 通过 preload 暴露。
- SplitPane 的用户期望尺寸与当前容器钳制尺寸必须分开，不能把临时钳制值写回持久化。
- Chromium sticky 的三个坑：`border-collapse: collapse`、flex item 的 `flex:1`、滚动容器直接子元素为 table；当前实现已规避。
- Playwright 驱动 Electron 前应使窗口 show/focus，否则 Windows 可能吞掉真实 mouse down。
- 单实例锁会影响测试套跑，测试环境用 `LOCALSTOCK_NO_SINGLETON=1`。
- `build:win` 会重建 `dist/win-unpacked` 并清掉其中的数据副本；视觉测试前需恢复本地行情库。
- 视觉识别历史约定使用智谱云端 `zhipu-vision`，不使用本地 Ollama vision。

## 最新问题：算法画线不可见

### 已完成诊断

1. Python 算法引擎和打包资源存在，`resources/python/engine/draw_engine.py` 可用。
2. 诊断脚本实测算法运行成功：某股票画线数量从 1 增至 4，新增 3 条。
3. 视觉识别与 canvas 像素探针确认红/绿水平线、蓝色趋势线都没有真正画出。
4. ECharts option 中 custom series 存在，7 条 drawings 也已进入 option，因此不是存储、IPC 或算法输出问题。
5. 根因：K 线共有约 3843 根，默认 dataZoom 只显示最后约 120 根。算法水平线/趋势线的锚点位于 `x=0` 或 `x=n-1`，dataZoom 默认 `filterMode: 'filter'` 会过滤可视窗外的数据点，导致 custom series 的 `renderItem` 根本不执行。

### 已实施修复

文件：`src/components/KLineChart.tsx`

- inside dataZoom 和 slider dataZoom 都已增加 `filterMode: 'none'`。
- 语义：保留全部画线数据点，只缩放坐标；custom series 始终参与渲染。
- 当前文件中该修改仍然存在（约第 403、411 行）。

### 原断点已完成（2026-08-27）

- Windows portable 已重新打包成功，行情数据库副本已恢复到 `dist/win-unpacked/data/stock_data.db`。
- 初始的 `filterMode:'none'` 修法在验证中发现会压扁当前蜡烛，未作为最终方案保留。
- 最终方案改为 custom series 动态可视锚点；dataZoom 保持 `filter`，并在缩放/平移后更新锚点。
- 新增隔离式回归 `scripts/verify-algo-drawing.js`，不读取或清除用户真实画线。
- 算法生成、持久化、三色 canvas 像素、当前价格轴、缩放到最后 60 根后的画线与价格轴均已通过。
- TypeScript 0 错误、单测 83/83、Windows portable 打包成功。

## 后续建议

1. 把 `scripts/verify-algo-drawing.js` 纳入长期回归入口，防止 ECharts/dataZoom 升级后再次丢失画线。
2. 全量视觉测试脚本仍包含 `window.api.drawings.clear(...)`；运行前必须隔离 userData，或把该测试重构为临时配置目录。
3. 后续 UI 开发可转向真实用户反馈与新功能，不再以本算法画线问题作为阻塞项。

## 诊断脚本与产物

会话中新建或修改过以下诊断脚本，继续前应先审阅，不要默认全部属于正式测试：

- `scripts/diag-algo.js`：只读对比运行前后画线数量；早期会清画线的版本已被改掉。
- `scripts/diag-algo-data.js`：比较画线数据与 K 线范围。
- `scripts/diag-algo-px.js`：扫描 canvas 中画线颜色像素。
- `scripts/diag-algo-option.js`：检查 ECharts option 的 custom series 和 drawing 数量。
- `test-results/18-algo3.png`：修复前的不可见截图。

## 安全边界

- 不得调用会清空用户真实画线的 `window.api.drawings.clear(...)`。
- 不得未经确认结束用户主动打开的 LocalStock。
- `D:\pythonpro\desktop\desktop` 当前不是 Git 仓库，不能依赖 Git 回滚；目录中有 `desktop备份20260826.rar`，另有会话记录的 pre-P3 源码备份。
