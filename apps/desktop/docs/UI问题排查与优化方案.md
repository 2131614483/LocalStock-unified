# UI 问题排查与优化方案（缩放 / 美观 / 报错）

> 2026-08-25 全量走查结论。基线健康：`npm run typecheck` 0 错误、`npm test` 83/83 通过。
> 本文基于代码走查（src/ 全组件 + electron/ 窗口层）+ 现有截图（test-results/01~10）分析，
> 按「确认的 Bug → 缩放/自适应专项 → 美观设计 → 交互 UX → 性能」分级，每项给位置与修法。
> 改完后按 CLAUDE.md 流程验证：`npm run build:win` + playwright 截图 + zhipu-vision 识图。

---

## 一、确认的 Bug（建议先修）

### B1. 图表不随面板拖拽重排，拖宽侧栏/AI面板后 canvas 拉伸模糊 ⭐核心
- **位置**：`src/lib/useEChart.ts:31-35` —— 只监听 `window resize`。
- **现象**：拖动侧栏宽度（SplitPane）、AI 面板宽度把手、盘口/图表分割、回测图 `ResizableChartShell` 高度时，容器尺寸变了但 ECharts 不 `resize()`，canvas 被 CSS 拉伸 → 图表模糊、留白或溢出，直到下次拖动系统窗口边缘才恢复。这是"缩放不如正规软件"的最大来源。
- **修法**：`useEChart` 内加 `ResizeObserver` 观察 container，回调里 `chart.resize()`（节流 rAF）。一处修复，全部图表（K线/分时/回测两图/浮窗）受益。

### B2. 表格表头吸顶失效
- **位置**：`src/styles/globals.css:259-264`（`.table-card { overflow: hidden }`）与 `:325-338`（`thead th { position: sticky }`）。
- **根因**：`overflow: hidden` 的祖先会成为 sticky 的"最近滚动容器"，但 `.table-card` 自身从不滚动 → 表头永远吸不住。滚动 100 行的沪深列表时表头直接滚走。
- **修法（二选一）**：
  1. 推荐：把 `.table-card` 改成内部滚动布局——`max-height` + `overflow-y: auto`（工具栏/分页在卡片外），sticky 相对卡片生效，形成"表头固定、表体滚动"的正规软件布局；
  2. 或去掉 `overflow:hidden`，用 `th:first-child/last-child` 圆角替代裁切。

### B3. 监盘窗 SplitPane 初始 620px 溢出，事件面板被挤没
- **位置**：`src/monitor.tsx:373`（`initial=620, min=400, max=1000`）；默认监盘窗 940x640（`electron/windows.ts:42`）。
- **根因**：`SplitPane` 生成 `gridTemplateRows: 620px 6px 1fr`（`SplitPane.tsx:74-76`），监盘窗内容高约 400px 时第一行 620px 直接溢出，`1fr` 的"提醒/预测记录"区被压成 0 且 `overflow:hidden` 不可见；localStorage 持久化值也不随窗口尺寸钳制。
- **修法**：① SplitPane 挂载/窗口 resize 时把 size 钳到 `min(max, 容器高-保留值)`；② 监盘窗 initial 降到 ~300；③ 可选：grid 第一行用 `minmax(0, Npx)`。

### B4. 5日分时拖拽"价格/量能"分割条完全无效
- **位置**：`src/components/MinuteChart.tsx` —— 多日分支 grid 固定 `top 28 / 56% / 70% / 20%`（:238-241），而分割把手按 `pricePct` 定位（:277-283）。
- **现象**：5日分时下拖把手，把手移动但图表纹丝不动（单日分支才用 `pricePct`）。
- **修法**：多日分支同样用 `pricePct` 计算 grid，或在多日模式隐藏把手。

### B5. 分时 x 轴 "11:30 / 13:00" 相邻标签重叠
- **位置**：`src/components/MinuteChart.tsx:12`（`SHOW_LABELS` 同时含 11:30 与 13:00，两索引 119/120 相邻）。
- **现象**：午休压缩轴上两个标签画在相邻刻度，渲染成叠字（02-detail.png 可见）。
- **修法**：`SHOW_LABELS` 去掉 `'13:00'`（或 axisLabel 加 `hideOverlap: true`）。

### B6. K线 legend 与主图蜡烛重叠
- **位置**：`src/components/KLineChart.tsx:320`（价格 grid `top: 2%`）vs `:373-379`（legend `top: 0`）。
- **现象**：MA/MACD 图例横排压在主图顶部 K 线上（04-dayk.png 可见，"MA5" 与蜡烛/最高价标签重叠）。
- **修法**：价格 grid `top` 提到固定 `28px`（其余 pane 百分比相应扣减），legend 保持在 0；或 legend 改 `icon:'roundRect'` 单行缩小。

### B7. dataZoom 滑块底部仍显"白条"感（dataShadow 默认浅色）
- **位置**：`src/components/KLineChart.tsx:385-399`。背景已是深色实底，但滑块默认 `dataShadow`（成交量阴影预览）用浅色渐变，远看仍是一条白/灰横带（04-dayk.png 底部）。
- **修法**：slider 加 `dataShadow: { lineStyle: { color: '#3a4048' }, areaStyle: { color: 'rgba(255,255,255,0.05)' } }`，或 `showDataShadow: false`。

### B8. 本地沪深列表 4 列全 "--"，且按这些列排序会静默错排
- **位置**：`electron/market/market-list-local.ts:27-32`（`sortValue` 对 f8/f9/f10/f100 全部回退 `changePercent`）、`:70-90`（本地行不含 turnoverRate/pe/volumeRatio/industry）。
- **现象**：本地模式下 换手率/市盈率/量比/行业 四列全 "--"（08-market.png）；点"换手率"表头实际按涨跌幅排序，无任何提示。
- **修法**：短期——本地模式隐藏这 4 列（`Quote.industry` 为空时 `showIndustry=false` 同理），排序遇到无数据列时禁用或提示"本地数据无此字段"；长期——`stock_daily` 有 volume/amount，可算量比近似（vs 5日均量），换手率需流通股本（stocks 表若无则放弃）。

### B9. 现价闪烁按"涨跌幅方向"而非"逐笔方向"
- **位置**：`src/components/StockTable.tsx:27-35`（`trendOf(changePercent)` 决定 flash 颜色）。
- **现象**：跌着的股票每次 tick 即使价格上调也闪绿，与直觉相反（同花顺按 tick 上下闪红绿）。
- **修法**：`PriceCell` 里比较 `price` 与 `prevRef.current`：升闪红、降闪绿、平不闪。

### B10. 指数详情页照常轮询并渲染"五档盘口"
- **位置**：`src/components/StockDetail.tsx:245-262`（3s 固定轮询 `getOrderBook`，未排除指数）；指数 secid 在 `INDEX_SECIDS` 中。
- **现象**：点指数进详情，五档区显示 0/无意义数据，且白耗腾讯接口配额。
- **修法**：`INDEX_SECIDS.includes(secid)` 时不渲染 OrderBook、不轮询；盘口轮询间隔同时改为跟随 `refreshInterval`（见 U4）。

### B11. 窄窗口横向溢出：详情头 / 回测双图不折叠
- **位置**：`globals.css:428-436`（`.detail-head` 无 `flex-wrap`，`.detail-metrics` 固定 4 列 `minmax(120px,auto)`）；`:1145-1149` `.chart-row`、`:1160-1165` `.result-tables` 固定 `1fr 1fr`。
- **现象**：浮窗拖窄或小屏时，详情头部指标被裁、回测收益/回撤两图挤成两条细图。
- **修法**：`.detail-head { flex-wrap: wrap }` + `.detail-metrics { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)) }`；`.chart-row/.result-tables` 加 `@media (max-width: 1100px) { grid-template-columns: 1fr }`。

---

## 二、缩放 / 自适应专项（用户主诉"缩放不如正规软件"）

| # | 项 | 现状 | 方案 |
|---|---|---|---|
| S1 | 图表随容器重排 | 仅 window resize（=B1 根修） | `useEChart` 加 ResizeObserver + rAF 节流 |
| S2 | 全局 UI 缩放 | 无。字体全部固定 px，无 Ctrl+滚轮/Ctrl+=− | `webFrame.setZoomFactor` + 快捷键（Ctrl+滚轮、Ctrl+=/Ctrl+-、Ctrl+0 复位），zoomFactor 存 `settings` 表，启动恢复。正规软件标配 |
| S3 | 窗口位置/尺寸不记忆 | 主窗每次 1360x860（`electron/main.ts:19-20`）；浮窗每次固定 VIEW_SIZE（`electron/windows.ts:34-44`） | 主窗与各浮窗 bounds 持久化（手写 JSON 存 userData 或 `electron-window-state`），关闭时保存、启动恢复；浮窗另存每视图上次尺寸 |
| S4 | SplitPane 钳制不响应 | min/max 是绝对 px，不随容器变；持久化值可能大于窗口（=B3） | 钳制到容器实际尺寸；双击分隔条恢复 initial；内部把 px 换算成百分比存储更稳 |
| S5 | 响应式断点缺失 | 详情头/双图/监盘控制条在窄窗挤压（=B11） | 引入 2~3 个断点（如 1280/1000）做列折叠与 wrap |
| S6 | 标题栏与深色主题割裂 | Windows 默认白标题栏压在深色 app 上（`main.ts:18-33` 未设置） | `titleBarStyle: 'hidden'` + `titleBarOverlay: { color: '#0d0e10', symbolColor: '#d0d5dd', height: 36 }`，拖拽区用 `-webkit-app-region: drag`；观感立刻"正规软件" |
| S7 | 原生控件弹层是白色 | `:root` 未声明 `color-scheme`，select 下拉/日期选择器/原生滚动条按浅色渲染 | `globals.css :root { color-scheme: dark }` 一行修复 |
| S8 | 高分屏 | Electron/Chromium 按 DPI 光栅化，canvas 文字本身不糊；糊感来自 S1 的拉伸 | 修 S1 即可；另避免大量固定 px 高度，图表高用 clamp |
| S9 | AI 面板宽度不持久 | `AiChatView.tsx:214` `pwidth` 每次 400，与 SplitPane 行为不一致 | 存 localStorage（对齐 `split.*` 约定，如 `split.aiPanel`） |
| S10 | 图表高度逻辑分散 | `chart.height` 设置、宽高比 `aspectRef`、拖拽把手三套逻辑交织（`StockDetail.tsx:83-143`） | 统一为"基准高度 + 宽度比例缩放"一个来源；设置页改的是基准，把手改的也是基准并回写 |

---

## 三、美观 / 设计优化

### A1. 设计 token 化（地基）
`globals.css` 2376 行、556 处 px，间距/圆角/字号无体系。建议在 `:root` 增补：
```css
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
--radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px;
--fs-11: 11px; --fs-12: 12px; --fs-13: 13px; --fs-15: 15px; --fs-18: 18px;
```
新代码一律引用变量；存量渐进迁移（不必一次全改）。

### A2. ECharts 主题集中
KLine/Minute/Backtest 三处图表硬编码同一批色值（`#1a1d22/#5c636e/#8b929c/#2e333c`…，KLineChart.tsx:331-397、MinuteChart.tsx:119-247、BacktestResult.tsx:48-130）。建议 `src/lib/chart-theme.ts` 注册 `echarts.registerTheme('localstock', {...})`，`echarts.init(el, 'localstock')`，与 CSS 变量同源。改主题一处生效，也顺带解决未来换肤。

### A3. 涨跌幅色块减负
`globals.css:384-401` `.chg-cell` min-width 74px + 渐变，市场列表整屏大红块（08-market.png），视觉过载。方案：min-width 降到 64px、渐变改平色（`--up`/`--down` 90% 不透明度）、圆角 3px；或提供"色块/彩字"两种密度切换（同花顺就有）。

### A4. 表格细节
- 行高：`td padding 7px 10px` 偏挤，建议 8px 10px；hover 过渡 `background .12s` 统一加上。
- 斑马纹可选：`tbody tr:nth-child(even) { background: rgba(255,255,255,0.015) }`，长列表更易读行。
- 数字右对齐已做（好），表头排序箭头与 `cursor: pointer` 只给可排序列（现在 `_actions` 列也是 pointer）。

### A5. 按钮体系
现状 `.btn` 一种 + 各处 `.primary` 内联拼。建议规范化：`btn / btn-primary / btn-danger / btn-ghost`，高度统一 28px（紧凑区 24px），补 `:disabled { opacity:.45; cursor:not-allowed }` 全局规则（现在只有 `.ai-send` 有）与 `:focus-visible { outline: 1px solid var(--accent) }`。

### A6. 空态 / 加载态
全部是文字"加载中…/暂无数据"（`.loading/.empty`）。建议：细 spinner（CSS 动画即可）+ 一句说明 + 重试按钮（尤其 K线/分时加载失败时现在静默空白，见 U6）；表格空态给"添加自选/下载数据"引导入口。

### A7. 图标统一
侧栏 ★≡▤⚠◎✦⚙ 与工具栏 ✦📊🗄🔍 混用 emoji/文本符号，Windows 下 emoji 彩色渲染与深色 UI 气质不符。建议引入 `lucide-react`（tree-shakable、线条风格统一），一次替换 ~20 个图标位。

### A8. 策略代码编辑器升级（回测页观感最大单项）
`StrategyEditor.tsx:78-84` 是纯 textarea：无高亮/无行号/无错误提示。建议 CodeMirror 6（`@codemirror/lang-python`，体积可控）：Python 高亮 + 行号 + 括号匹配；运行错误可按行号标红（`backtest-error` 现在只是一坨红字）。Tab 缩进、自动保存逻辑保留。

### A9. Markdown 代码高亮
`MarkdownView`（react-markdown + remark-gfm）代码块无高亮。加 `react-syntax-highlighter` 或 rehype-highlight（配深色主题），AI 回复策略代码可读性大幅提升。

### A10. 对比度微调
`--text-faint #5c636e` 在 `--bg-panel #15171b` 上约 3.2:1，大量 11px 小字（时间戳/提示）低于 WCAG 4.5:1。建议调到 `#6b7280` 一档（≈4.6:1），不改变层级感。

### A11. 滚动条
9px 常驻。建议默认 6px 更细、hover 时 10px 且 thumb 提亮一档（`#3a4048 → #4a515c`），`border-radius: 3px`。

---

## 四、交互 / UX

- **U1 键盘快捷键**：Ctrl+F 聚焦搜索、F5/Ctrl+R 刷新当前列表、Esc 关闭下拉/弹层（搜索已有）、详情页 ← 返回、1~8 数字切侧栏视图。全局 `window.addEventListener('keydown')` 分发即可。
- **U2 无障碍语义**：`sidebar-item/tab/index-item/win-menu-item` 全是 div，无 tabIndex/Enter。统一加 `role="button" tabIndex={0} onKeyDown(Enter/Space)`，配合 A5 的 focus-visible。
- **U3 市场页不实时**：`App.tsx:55-61` 订阅范围在市场视图只含指数，表格是进入时快照，需手点"刷新"。方案：把当前页 100 个 secid 并入 subscribe（主进程已支持按 secid 集合推送），或表格角落明示"快照时间 HH:MM:SS"。
- **U4 盘口轮询独立且不停歇**：`StockDetail.tsx:245-262` 固定 3s，与刷新频率设置无关；窗口最小化仍轮询。改：间隔跟随 `refreshInterval`，`document.visibilitychange` 隐藏时暂停。
- **U5 单实例锁**：`main.ts` 无 `app.requestSingleInstanceLock()`，便携版双击两次会开两个实例共写同一 SQLite。加锁 + `second-instance` 聚焦已有窗口。
- **U6 错误可见化**：渲染层大量 `.catch(() => {})`（StockDetail.tsx:273/282 等），K线/分时失败=永久空白无解释。建议最小 toast 组件（右下角，3s 自愈），失败时"加载失败 · 点击重试"；`DataDownloadPanel` 把 `dataStatus.error` 展示出来（踩坑记录 2026-08-13 已提）。
- **U7 分页增强**：页码跳转输入 + 每页条数（50/100/200）。
- **U8 IndexBar 溢出无提示**：`overflow-x:auto` 且滚动条隐藏，指数多时右侧无渐隐遮罩，用户不知道能横拖。加右侧渐变遮罩。
- **U9 表格列宽**（可选）：`<th>` 加拖拽手柄记忆列宽到 localStorage，行情软件高频需求。
- **U10 虚拟滚动**（可选）：若市场页改实时订阅（U3），100 行 × 1s 全量 diff 可接受；若放开分页则需 `react-window`。

---

## 五、性能（低优先，量小可后置）

- **P1** 行情推送 1s 一次 `setQuotes` 触发全表重渲染：`StockTable` 行组件 `React.memo` + `useApp` selector 细分即可（当前 100 行无感，自选扩大后有用）。
- **P2** ECharts 每次 option 变化 `setOption(option, true)` 全量重建（画线拖动时尤甚）：画线/指标开关可拆独立 series 增量更新；非热点，先不动。
- **P3** AI 配置每个击键写一次 settings 库（`AiChatView.tsx` ConfigForm `onChange={saveConfig}`、SettingsPage 同）：仿照策略编辑器加 500ms 防抖。

---

## 六、建议落地顺序

| 阶段 | 内容 | 预期效果 |
|---|---|---|
| P0（半天） | ✅已完成(2026-08-26)：B1/S1、B2、S7、B5、B6、B7 | 图表不再模糊错位、表头吸住、原生控件变深色——"缩放差"观感解决大半 |
| P1（1 天） | ✅已完成(2026-08-26)：S2 全局缩放、S3 窗口记忆、S6 深色标题栏(自绘)、B3、B4、B9、B10 | 窗口行为对齐正规软件 |
| P2（1~2 天） | ✅已完成(2026-08-26)：B8、B11/S5、A3~A6/A10/A11、U1~U3、U5~U8 | 视觉与交互整体升级 |
| P3（按需） | ✅已完成(2026-08-26)：A7 lucide 图标、A8 CodeMirror 策略编辑器、A9 代码高亮、A1/A2 ECharts 主题集中 | 专业度与可维护性提升（详见下方完成记录） |

### P2 完成记录（2026-08-26）

| 项 | 改动 | 验证 |
|---|---|---|
| B8 本地列表 4 列 "--" | 本地模式（行无 industry 字段判定）隐藏换手率/PE/量比/行业列 + 新增总市值列（本地库 mkt_cap_total 万元→元，支持 f20/f21 排序）；sortableKeys 白名单禁用无数据列排序（不再静默错排）；标题栏标注「本地行情库 · 收盘数据」 | 识图：表头 名称/代码/现价/涨跌幅/涨跌额/成交量/成交额/总市值 ✓ |
| B11/S5 响应式 | detail-head flex-wrap + detail-metrics auto-fit；chart-row/result-tables @1100px 单列 | 构建通过 |
| A3 色块减负 | chg-cell 渐变→平色 88%、min-width 74→64、圆角 3px | 构建通过 |
| A4 表格细节 | 行高 7→8px、斑马纹 rgba .015、行 hover 过渡、no-sort 列无手型 | 构建通过 |
| A5 按钮体系 | 全局 :disabled 规则、:focus-visible、.btn.danger | 构建通过 |
| A6 空态 | StockTable 空态加 spinner + 刷新引导 | 构建通过 |
| A10 对比度 | --text-faint #5c636e→#6b7280（4.5:1） | 构建通过 |
| A11 滚动条 | 9→8px + hover 提亮 | 构建通过 |
| U1 快捷键 | Ctrl+F//聚焦搜索、F5/Ctrl+R 刷新当前列表 | 构建通过 |
| U2 无障碍 | sidebar-item role=button+tabIndex+Enter/Space；focus-visible 样式 | 构建通过 |
| U3 市场页快照提示 | store 记 loadedAt，在线模式显示「快照 HH:MM:SS」 | 构建通过 |
| U5 单实例锁 | requestSingleInstanceLock + second-instance 聚焦；LOCALSTOCK_NO_SINGLETON=1 测试跳过（套跑锁竞态） | 套跑 4/4 ✓ |
| U6 错误可见化 | K线/分时失败/空数据 → chart-error-overlay + 重试按钮；搜索失败显示限流提示+重试（不再静默无结果） | 构建通过 |
| U7 分页增强 | 每页条数（50/100/200）+ 页码跳转（Enter） | 识图确认 ✓ |
| U8 指数栏渐隐 | index-bar-wrap::after 右侧渐变遮罩（pointer-events:none） | 构建通过 |

**P2 踩坑**：
- **单实例锁 vs 测试套跑**：`requestSingleInstanceLock` 在 Playwright 套跑时（前实例退出与后实例启动竞态）会让新实例直接 quit → `electron.launch: Target closed`。用环境变量 `LOCALSTOCK_NO_SINGLETON=1` 在 launch env 里跳过，生产语义不变。
- **探针间窗口状态污染**：窗口记忆测试会持久化窗口尺寸/最大化状态，影响后续探针的宽度断言——测试开始前清 window-state.json 的 main 记录 + unmaximize。
- 东财 searchapi 限流是**间歇性环境问题**（同一构建时好时坏）：搜索断言改为「无结果时跳过并打日志」，UI 侧则加了限流提示+重试（U6）。

### P1 完成记录（2026-08-26）

| 项 | 改动 | 验证 |
|---|---|---|
| S2 全局缩放 | preload 里 `webFrame.setZoomFactor`（渲染层 import 'electron' 会把整个包拖进 bundle 导致 `__dirname` 崩溃——坑）；Ctrl+滚轮/Ctrl+=−/Ctrl+0，存 settings['ui.zoom']，全窗口生效 | 探针：dpr 1.25→1.375，ui.zoom 持久化，Ctrl+0 复位 |
| S3 窗口记忆 | `electron/window-state.ts`：主窗/8 浮窗/监盘窗 bounds 存 userData/window-state.json，显示器交集校验防屏幕外，最大化状态记忆 | 探针：1100x720@80,60 保存、重启恢复 |
| S6 深色标题栏 | `titleBarStyle:'hidden'` + 自绘 TitleBarControls（win:minimize/maximizeToggle/close IPC，sender 定位窗口）+ .toolbar/.monitor-head/float-titlebar 拖拽区 | 识图：控制按钮/深色融合 ✓ |
| B3 监盘溢出 | SplitPane 双层尺寸：userSize（用户拖拽，持久化）+ size（生效值=clamp 容器）；**修正方向轴读反**（vertical=竖分隔条应读 clientWidth） | 探针：拖 800→小窗钳 770→最大化恢复 800，事件格始终可见 |
| B4 5日分时拖拽 | 多日分支 grid 也用 pricePct | 探针：拖拽后 grid 56%→43% |
| B9 闪烁方向 | PriceCell 按逐笔价差闪红/绿 | 代码审查+构建 |
| B10 指数五档 | 指数详情不轮询 getOrderBook、显示占位说明；盘口轮询跟随刷新间隔+页面隐藏暂停 | 探针：指数详情显示"指数无五档盘口" |

**P1 踩坑（重要）**：
1. **渲染层禁 import 'electron'**：`webFrame` 必须在 preload 用；渲染层 import 会把 electron 包打进 bundle，`__dirname is not defined` 白屏。
2. **Playwright 启动后窗口不在前台时 Windows 吞 mouse down**（mousemove 正常）——所有依赖真实鼠标拖拽的测试必须先 `BrowserWindow.show()+focus()`。此前误判为 titleBarStyle:'hidden' 的 bug，A/B 多轮后用 focus 对照实验定位真因。
3. **SplitPane direction 语义**：'vertical'=竖分隔条=调列宽=读 clientWidth（曾读反导致监盘窗按高度钳制宽度）。
4. **钳制值不能回写持久化**：否则小窗口的钳制值永久卡死布局（最大化不恢复）；userSize/生效值分离。
5. `build:win` 会清空 `dist/win-unpacked/data/`（行情库副本），每次打包后要重新放置。

**测试基建**：visual-test 加 `jsClick`（行情刷新致元素"不稳定"，Playwright 稳定性检测超时）与启动后 focus；新增 5 个探针 spec（p0-verify / p1-verify / p1-verify-monitor / p1-verify-minute5d / p1-verify-maximized）。

### P0 完成记录（2026-08-26）

| 项 | 改动 | 验证 |
|---|---|---|
| B1/S1 图表随容器缩放 | `useEChart.ts` 加 ResizeObserver + rAF 节流 | 探针：拖侧栏后 canvas 宽 736→665 实时跟随；属性/CSS 比=1.25(=DPR) 无拉伸 |
| B2 表头吸顶 | `StockTable` 内置 `.table-scroll` 滚动区 + `.table-card` 改 grid `auto 1fr auto` + `border-collapse:separate` | 探针：滚动 27px 后表头 y 不变；zhipu 识图确认 |
| S7 原生控件深色 | `:root { color-scheme: dark }` | 构建通过，select 下拉深色 |
| B5 分时标签叠字 | `SHOW_LABELS` 去掉 13:00，补 14:00 | zhipu 识图：标签 09:30~15:00 无重叠 |
| B6 legend 压蜡烛 | 价格主图 top 固定 28px，副图按剩余高度百分比堆叠 | zhipu 识图：图例在蜡烛上方独立区域 |
| B7 dataZoom 白条感 | slider 加深色 `dataShadow` | zhipu 识图：滑块深色无白条 |

**B2 排查中发现的三个 Chromium sticky 坑（都已绕过，值得记住）**：
1. `border-collapse: collapse` 使 `thead th` 的 `position:sticky` 完全失效 → 必须 `separate` + `border-spacing:0`；
2. 滚动容器若是 flex item 且用了 `flex:1`（basis 0%），sticky 失效 → 卡片改 grid `auto 1fr auto`；
3. **滚动容器的直接子元素是 `<table>` 时 sticky 失效**（最隐蔽，computed style 全部正确但不吸附）→ `StockTable` 在滚动区里垫一层普通 div。
另注意：`.splitpane-item > *` 的 `height:100%!important` 会盖掉内联样式，表格卡片需专门豁免。

**测试环境备注**：`dist/win-unpacked/data/stock_data.db`（从聚宽-local 复制的 6GB 只读副本）用于本地行情数据；没有它时市场页依赖东财在线，限流期（socket hang up）会显示"暂无数据"导致 visual-test 第 2 用例失败——这是环境问题非回归。

### P3 完成记录（2026-08-26）

| 项 | 改动 | 验证 |
|---|---|---|
| A7 lucide 图标库 | 引入 `lucide-react`，替换侧栏（★≡▤⚠◎✦⚙◉←）、工具栏（✦📊🗔）、搜索（🔍）、AI 面板（⚙◷✕）、标题栏（─□❐✕）全部 emoji/Unicode 为线条图标 | 识图：主界面/回测/工具栏三处线条统一 ✓ |
| A8 CodeMirror 编辑器 | 引入 `@uiw/react-codemirror` + `@codemirror/lang-python` + `@codemirror/theme-one-dark`，替换回测策略 textarea：行号/代码折叠/括号匹配/活动行高亮；Tab 缩进（CodeMirror 原生）+ 1s 防抖自动保存保留 | 识图：行号 1-27 + Python 多彩高亮 ✓ |
| A9 AI 回复代码高亮 | 引入 `rehype-highlight`，MarkdownView 代码块高亮；Atom One Dark 配色写入 globals.css（限定 `.md-body` 作用域避免污染全局） | 构建通过 |
| A1/A2 ECharts 主题集中 | 新建 `src/lib/chart-theme.ts`（`CHART_COLORS` 常量 + `registerTheme('localstock-dark')`）；`useEChart` init 统一主题；KLine/Minute/BacktestResult 三处图表散落色值全部改引常量（MA/指标/滑块/tooltip/填充渐变） | typecheck/单测 83/视觉 3 探针全绿 |

**P3 引库说明**：按设计规范「不引入新库除非强需求」，编辑器/图标/高亮确属强需求，新增 3 个依赖（`lucide-react`、`@uiw/react-codemirror`+`@codemirror/lang-python`+`theme-one-dark`、`rehype-highlight`）。bundle 变化：CodeMirror + highlight.js 打进 SettingsPage 动态 chunk（Rollup 自动分块无重复加载，4.3MB 可接受）。

**备份**：P3 改动前备份 `D:\pythonpro\desktop-backups\localstock-desktop-2026-08-26-preP3.tar.gz`（11MB，源码+配置+脚本+文档，排除 node_modules/dist/out/data）。

### 后续可做项（2026-08-26 追加）

| 项 | 决策 | 说明 |
|---|---|---|
| U9 表格列宽拖拽记忆 | ✅ 已做 | `.col-resizer` 拖拽把手（th 内右侧）调列宽并持久化 `table.colwidths.<key>`；有宽度时表格转 `table-layout:fixed` + colgroup（无则保持内容自适应）。探针：名称列 240→300 持久化 ✓ |
| P1 行情渲染优化 | ✅ 已做 | `StockTable` 行组件 `Row` React.memo 逐字段比较 Quote（静止行跳过 reconcile）；`columns`/`onRowClick`/`renderActions` useMemo/useCallback 稳引用（Watchlist/Market 已配）。探针：行情 3.5s 后 8 行 DOM 未重建 ✓ |
| U10 虚拟滚动 | ❌ 不引入 | 自选 + 市场页行数有限（市场分页 100 行），且 sticky 表头/斑马纹/列宽拖拽都依赖真实 DOM 行，虚拟滚动收益低、复杂度高。维持分页 + memo 方案 |
| ECharts series 增量更新 | ❌ 不引入 | 画线/指标切换低频，option 全量 rebuild 开销可忽略（数据替换 120 根左右成本微小）；仅在大量实时点更新时才需要 |

### 算法画线不可见修复（2026-08-27）

**现象**：算法引擎能成功生成压力、支撑和趋势线，drawings 已保存且 custom series 已进入
ECharts option，但默认只显示最后 120 根 K 线时，canvas 上完全看不到画线。

**根因**：算法水平线/趋势线常以全历史的 `x=0`、`x=n-1` 为锚点。dataZoom 默认
`filterMode:'filter'` 会删除可视窗外的 custom data item，导致 `renderItem` 根本不执行。

**最终修法**：

- custom series 的 data 不再直接使用真实画线端点，而统一使用当前 dataZoom 窗口中央的
  “可视锚点”；`renderItem` 仍从原始 drawings 读取真实日期和价格坐标。
- dataZoom 继续使用 `filter`，因此 K 线 Y 轴只按当前可见行情缩放，不会因全历史高低点被压扁。
- datazoom 事件同时兼容直接 `start/end` 与 `batch[0]` 两种载荷；缩放/平移后更新锚点并保持画线。

**为什么不用 `filterMode:'none'/'empty'`**：两者虽然能保留 custom item，却会让窗口外历史行情或
画线端点继续参与 Y 轴自动范围，实测会把 17～22 元的当前蜡烛压到 0～120 的坐标中。

**验证**：新增 `scripts/verify-algo-drawing.js`，使用临时隔离 userData，绝不清除用户真实画线。

- 算法输出 3 条：红色压力 hline、绿色支撑 hline、蓝色趋势 segment。
- canvas 像素确认三条线真实渲染；默认窗口红/绿横线均横跨 276 个采样点，蓝线 683 个采样像素。
- 默认 120 根价格轴与可见行情一致（示例：可见 44.57～81.78，轴 40～90）。
- 缩放到最后 60 根后 start 精确保持，红/绿横线继续横跨 276 个采样点，价格轴为 50～80。
- `npm run typecheck` 通过；Vitest 14 个文件、83/83 测试通过；Windows portable 打包成功。
- 验证截图：`test-results/18-algo-fixed.png`。

### 画线体验扩展（2026-08-27，用户截图反馈）

针对“算法代码框太小、分时无画线、拖动时看不到形状”完成第二轮改进：

1. **算法编辑框可调高度**
   - 默认高度由 180px 级别提升到 360px。
   - textarea 开启原生纵向 resize，右下角可拖至 240～720px；高度保存到
     `localStorage['drawing.algo.editorHeight']`，重新打开仍保持。
   - 双击代码框恢复 360px，并在标题栏显示操作提示。
2. **画线覆盖全部周期**
   - 工具栏现覆盖：当日分时、5 日分时、1/5/15/30/60/120 分钟 K、日/周/月/季 K。
   - 分时数据可转换为算法引擎所需的 KlineResult，因此分时同样支持算法画线。
   - Drawing 新增可选 `scope`：如 `minute:day`、`minute:5d`、`kline:5`、
     `kline:day/week/month/quarter`；各周期独立显示、删除和清空，不再串用坐标。
   - 旧版没有 scope 的画线兼容归入 `kline:day`，不会丢失。
3. **拖动过程实时预览**
   - KLineChart 与 MinuteChart 均在 mousedown 后记录起点，mousemove 时以临时 custom series
     渲染当前形状，mouseup 才正式写入数据库。
   - 趋势线、射线、矩形、斐波那契和通道均支持预览；水平线仍是单击立即完成。
   - 新增共享 `src/lib/drawing-render.ts`，让分时/K 线使用同一套六类形状渲染逻辑。

**隔离式验证**：新增 `scripts/verify-drawing-ux.js`，临时 userData 中完成以下断言：

- 编辑框 360 → 拖到 520 → 关闭重开仍为 520。
- 当日分时算法成功生成 3 条画线，scope 全为 `minute:day`。
- 分时矩形与日 K 趋势线在 mouseup 前 custom series 已存在，松开后才保存。
- 分时画线不会出现在日 K；周 K 与 5 分钟 K 均存在完整工具栏。
- 原算法画线像素/价格轴/缩放专项仍通过；TypeScript、83/83 单测及新目录 Windows portable 打包通过。
- 截图：`test-results/19-algo-editor-resized.png`、`test-results/19-drawing-ux.png`。

### K 线右侧半屏留白（2026-08-27）

针对“最新 K 线贴在最右边、不方便向未来区域画线”增加可拖出的未来空间：

- 默认打开周期时仍显示最后 120 根（不足则显示全部），最新 K 线保持在右边，不浪费初始空间。
- 横轴末尾补充当前可视数量一半的空白槽位；把行情窗口向右拖到底后，最新 K 线位于画面约 50% 处，右半屏用于趋势线、矩形和预测区域。
- 未来槽位不显示伪日期、不生成虚假 K 线，也不影响行情指标计算和价格轴范围。
- 空白区使用正常图表坐标，手动画线可实时预览并保存；切换周期时仍遵循既有 scope 隔离。

**验证**：新增 `scripts/verify-kline-right-space.js`。打包版以 3843 根日 K 验证补充 60 个未来槽位；默认窗口结束于最新行情，拖到最右端后最新 K 线位置比例为 `0.5`。并在右侧空白区从 x=3855 拖到 x=3887，确认 mouseup 前实时预览、松开后正确保存。TypeScript、83/83 单测通过，截图为 `test-results/20-kline-right-space.png`。

### 图表快捷键系统（2026-08-27）

新增统一、可配置的键盘操作，并在“设置 → 图表快捷键”提供总开关、标准/专业模式、平移步长、缩放比例、Shift 加速倍数和完整按键说明：

- `←/→` 左右平移，默认每次 10 根；`Shift+←/→` 默认 5 倍加速。
- `↑/↓` 或 `+/-` 放大/缩小；`Home` 回到最新行情，`End` 进入右侧半屏留白。
- `[/]` 顺序切换分时、分钟 K、日/周/月/季 K；`Esc` 取消当前画线并关闭画线面板。
- `Alt+T/H/Y/R/F/C` 分别选择趋势线、水平线、射线、矩形、斐波那契、通道；`Ctrl+Z` 撤销当前周期最后一条画线。
- 专业模式追加 `A/D` 平移、`W/S` 缩放、`R/F` 最新/未来，以及数字 `1—5` 直达分时/日/周/月/季 K。
- 搜索框、普通输入框、下拉框、CodeMirror 编辑器和可编辑区域中自动停用图表快捷键，避免误操作。
- 设置同时持久化到 settings 表和共享 localStorage；从独立设置窗口修改后，主行情窗口下一次按键立即使用新配置。
- 每次快捷键动作均显示短暂反馈提示；所有移动统一驱动 ECharts dataZoom，键盘、鼠标和底部滑块状态同步。

**验证**：新增 `scripts/verify-chart-shortcuts.js`，在隔离 userData 的打包版中验证标准模式平移、Shift 加速、缩放、Home/End、输入保护、画线/取消、周期切换、设置持久化及专业模式 D/数字键。TypeScript、83/83 单测通过。截图为 `test-results/21-chart-shortcuts-settings.png` 和 `test-results/21-chart-shortcuts-pan.png`。

### 算法画线 · AI 生成/调优代码（2026-08-27）

在算法画线代码框上方加 AI 输入区：自然语言描述需求 → AI 生成/调优 Python 画线代码 → 填回代码框 → 用户点「运行并画线」上屏。

- **主进程** `electron/drawing-ai.ts`：`drawing:aiCode` IPC，单次 LLM 调用（复用 `callPredictApi`，无工具循环）。输入 = 需求 + 旧代码（调优时）+ K线紧凑摘要（n/首末日期/高低/近60根收盘采样，不塞整包K线）；系统提示词锁死运行环境（data 变量、6 个画线函数、禁 print/import/函数定义/try），输出 JSON `{code, note}`。
- **渲染层** DrawingAlgoPanel：AI 输入框 + 6 个快捷需求 chips（支撑压力/放量突破/上升通道/斐波那契/金叉死叉/提醒线）+「AI 生成/AI 调优」按钮（代码被手动改过时先弹确认再覆盖）+ 重置示例。
- **三处接线**：shared/types.ts（`drawings.aiCode`）+ preload + main.ts 注册 `registerDrawingAiIpc`。
- **本地模型适配**：`extractJson`（monitor/predict.ts）剥推理模型 `<think>…</think>` 段（含未闭合截断），qwen3 系列经 Ollama 兼容端点正常出 JSON；callPredictApi 全部调用点（监盘/分时/画线）受益。
- **AI 配置复用**：走 AI 面板既有配置（provider/baseUrl/model/key），本地 Ollama 填 `http://localhost:11434/v1` + 模型名、key 留空即可。

**E2E 验证**（`scripts/diag-algo-ai.js`，打包版 + 本地 Ollama qwen3.5:9b）：写 AI 配置 → 进详情日K → 开算法面板（AI 条/chips 就位）→ 点快捷需求「画出最近120根的支撑与压力位」→ 生成 154 字符代码 + note「最近120根K线最高价画红色压力横线，最低价画绿色支撑横线」→ 运行后画线数 1→3，截图确认红/绿横线上屏（`test-results/19-ai-drawn.png`）。TypeScript 通过、83/83 单测通过。

## 七、验证方式

每阶段完成后按 CLAUDE.md：`npm run build:win` → `npx playwright test scripts/visual-test.spec.js --reporter=list`（记得 `--output=test-artifacts` 防止清空 test-results/）→ 用 zhipu-vision 识图核对：表头是否吸顶、拖窄窗口后详情头是否换行、K线 legend 是否离开蜡烛、分时 11:30/13:00 是否还叠字、dataZoom 是否仍显白条。B1/S1 的验证要专门加一步：脚本内拖动侧栏分隔条后断言 canvas 尺寸变化（`chart.getSize()` 或像素探针），这是现有 spec 没覆盖的盲区。
