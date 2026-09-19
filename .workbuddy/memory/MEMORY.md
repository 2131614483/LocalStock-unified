# LocalStock Unified —— 项目长期记忆

> 只记录**跨会话仍有价值**的约定与踩坑，不记录临时状态。日常流水见同目录 `YYYY-MM-DD.md`。

## Git / 版本库

- **多层 `.gitignore` 的优先级是「深层覆盖浅层」**：`services/joinquant-local/.gitignore`
  会**覆盖根目录 `.gitignore`**，所以根目录写 `!路径` **无法**放行被嵌套规则排除的文件，
  必须直接改嵌套文件本身。排查用 `git check-ignore -v <路径>`（会打印命中的层与行号）。
- 根 `.gitignore` 刻意**不设**全局 `*.db` / `*.exe` / `*.zip` 规则，只按路径精确忽略，
  以免误挡 `数据同步.exe` 这类需要入库的产物。
- `apps/desktop/build/icon.png` 是 electron-builder 资源，**必须入库**。
  因此禁用裸 `build/` 规则（git 无法重新包含被排除目录的子文件），
  只能写 `build/*` + `!apps/desktop/build/icon.png`。
- `core.autocrlf=true`，`.gitattributes` **刻意不设全局 `* text=auto`**，
  以免对已入库文件造成全量换行符重写。只显式声明 `.bat/.cmd/.ps1`(CRLF) 与 `.sh`(LF)。
- 入库范围约 **821 个文件 / 25.8 MB**（工作区实际约 8GB，99.7% 是数据库与依赖）。

## Python 依赖策略

- **`requirements.txt` 只列服务端必需的顶层包**，其余可选数据源适配器一律**注释形式**列出。
  原因：venv 由桌面端自动创建，多一个包就多一份下载与失败概率。
- **pa-agent 与 pa-agent-aggressive 共用同一个 venv**：
  `<userData>/pa-agent-venv`（仓库内 `data/runtime/desktop/pa-agent-venv`），
  由 `electron/pa/runtime.ts` 自动创建。必需项只有 4 个：
  `openai` / `pydantic` / `jsonschema` / `tzdata`。
  **`tzdata` 不能漏**——Windows 无系统时区库，缺了 `zoneinfo.ZoneInfo("Asia/Shanghai")` 直接导入失败。
- `apps/desktop/python/engine/` **必须保持零第三方依赖**：它在 Electron 子进程里被反复拉起，
  加依赖会拖慢冷启动并增大打包体积。
- `jqdata` / `jqfactor` / `jqlib` / `kuanke` 是**聚宽研究环境内部模块，不在 PyPI**。
  `engine/jqcompat.py` 已用 `_mk_module` 建空桩，**不要 pip 安装**。
- 聚宽侧主数据源（腾讯/新浪）**只用标准库 urllib**，故其 requirements 里没有 `requests`。
- PyInstaller 只是**打包期**依赖（产出 `数据同步.exe`），不写入必需项。

## 数据来源

- **唯一权威行情库**：`data/market/stock_data.db`（约 6.3G）。云端接口只在本地缺数据时回退。
- 主数据源：**腾讯 / 新浪**（免费免登录，全市场回填约 6 分钟）。
  baostock 为备选，已知服务端间歇性故障（挂起 / `WinError 10057` / login 10002007）。
- 免费接口的硬性约束（改代码时别踩）：
  - `hq.sinajs.cn`、`finance.sina.com.cn` **强制校验 Referer**
  - `qt.gtimg.cn` 返回 **GBK**，必须显式解码
  - 东财高频请求会封 IP（HTTP 000）→ 必须串行节流 + 60s 冷却回退
- 云端主机共 **35 个**，完整索引见 `docs/云端数据来源.md`。

## 文档地图

| 文档 | 内容 |
|---|---|
| `docs/云端数据来源.md` | 跨模块云端数据源横向索引（接口/认证/限制/密钥） |
| `apps/desktop/docs/下载数据源.md` | 桌面端数据源与本地化流程 |
| `services/joinquant-local/docs/project-docs/数据源与同步.md` | 聚宽侧来源与每日同步 |
| `apps/desktop/docs/踩坑记录.md` | 桌面端踩坑 |
| `services/joinquant-local/docs/project-docs/数据同步排错经验.md` | 同步故障排查 |
