# Windows 环境开发排错提示词库

> 本文档总结了在 Windows 环境下进行前端/Node.js 开发时遇到的常见错误类型、排查思路和可复用的解决命令。
> 适用于 TRAE / Claude Code 等 AI 编程助手在 Windows 环境下的排错场景。

---

## 一、文件编辑未持久化到磁盘

### 错误现象
- Edit 工具返回"修改成功"，Read 工具也显示新内容
- 但 Grep 工具搜索不到新代码
- 服务器返回的文件内容仍是旧版本
- PowerShell `Get-Content` 读取磁盘文件显示旧内容

### 排查思路
1. **用 Grep 验证**：搜索新添加的关键词，确认是否真正写入
2. **用 PowerShell 读取磁盘真实内容**：不依赖 Edit/Read 工具的缓存
3. **对比文件大小和修改时间**：确认文件是否真的被修改

### 可复用提示词
```
验证 Edit 工具的修改是否真正写入磁盘：
1. 用 Grep 搜索新代码的关键标识符（如新函数名、新类名）
2. 用 PowerShell 读取磁盘文件并检查：
   ```powershell
   $content = Get-Content -Path "文件路径" -Raw -Encoding UTF8
   Write-Output ("File length: " + $content.Length)
   Write-Output ("Has 关键词: " + $content.Contains("关键词"))
   ```
3. 如果 Grep 和 PowerShell 都找不到新代码，说明 Edit 工具修改未持久化
4. 改用 PowerShell 脚本直接修改磁盘文件
```

### 解决方案：用 PowerShell 脚本直接修改文件
```
当 Edit 工具修改无法持久化时，按以下步骤操作：
1. 用 Write 工具创建一个 .ps1 修复脚本（注意：脚本中的中文路径需要 UTF-8 BOM）
2. 给 .ps1 文件添加 BOM 标记：
   ```powershell
   $path = "脚本路径"
   $content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
   $bom = New-Object System.Text.UTF8Encoding($true)
   [System.IO.File]::WriteAllText($path, $content, $bom)
   ```
3. 执行脚本：`powershell -ExecutionPolicy Bypass -File "脚本路径"`
4. 用 PowerShell 验证修改是否写入磁盘
5. 删除临时 .ps1 脚本
```

---

## 二、PowerShell 脚本中文路径编码问题

### 错误现象
- 执行 .ps1 脚本时报错：`Cannot find path 'D:\pythonpro\鑱氬-local\...'`
- 路径中的中文字符被错误解码（如"聚宽"变成"鑱氬"）
- 脚本内容正确，但路径变量无法正确解析

### 排查思路
1. 检查错误信息中的路径是否显示为乱码
2. 确认 .ps1 文件是否缺少 UTF-8 BOM
3. PowerShell 默认用系统编码（GBK）读取无 BOM 的文件

### 可复用提示词
```
PowerShell 脚本执行时报中文路径乱码错误时：
1. 问题是 .ps1 文件缺少 UTF-8 BOM，PowerShell 用 GBK 解码导致路径乱码
2. 解决方法：给 .ps1 文件添加 UTF-8 BOM 标记
   ```powershell
   $path = "脚本路径"
   $content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
   $bom = New-Object System.Text.UTF8Encoding($true)
   [System.IO.File]::WriteAllText($path, $content, $bom)
   ```
3. 重新执行脚本
4. 预防：Write 工具创建含中文路径的 .ps1 脚本后，先添加 BOM 再执行
```

---

## 三、浏览器缓存旧页面

### 错误现象
- 服务器文件已更新，但浏览器仍显示旧内容
- 浏览器快照中的元素仍是旧版本
- 通过 `fetch` API 请求服务器返回的也是旧内容

### 排查思路
1. **用 curl 直接请求服务器**：绕过浏览器缓存，确认服务器返回内容
2. **用 JavaScript fetch 验证**：在浏览器中执行 fetch 检查服务器响应
3. **对比磁盘文件和服务器响应**：定位问题在浏览器缓存还是服务器

### 可复用提示词
```
排查浏览器缓存 vs 服务器缓存问题：
1. 用 curl 直接请求服务器，检查是否返回新内容：
   ```powershell
   curl.exe -s "http://localhost:端口/页面?_nocache=时间戳" > "$env:TEMP\test.html"
   $c = Get-Content "$env:TEMP\test.html" -Raw
   Write-Output ("Has 关键词: " + $c.Contains("关键词"))
   ```
2. 用浏览器 JavaScript fetch 验证：
   ```javascript
   const resp = await fetch('/页面?_nocache=' + Date.now());
   const text = await resp.text();
   return '关键词位置: ' + text.indexOf('关键词');
   ```
3. 用 PowerShell 读取磁盘文件确认真实内容
4. 判断：
   - 磁盘有新代码 + 服务器返回旧代码 = 服务器进程未重启（但 express.static 通常实时读取）
   - 磁盘有新代码 + 服务器返回新代码 + 浏览器显示旧代码 = 浏览器缓存
   - 磁盘无新代码 = Edit 工具未持久化（见第一节）
5. 解决浏览器缓存：URL 添加时间戳参数 `?_t=20260808150000`
```

---

## 四、cmd /c 命令被禁止

### 错误现象
- 执行 `cmd /c "命令"` 时报错：`invalid command: The use of 'cmd /c' (or 'cmd.exe /c') is blocked on Windows for safety`

### 可复用提示词
```
Windows 环境下 cmd /c 被禁止时，改用 PowerShell 等效命令：
- 获取短路径名（替代 cmd /c "dir /x"）：
  ```powershell
  $fso = New-Object -ComObject Scripting.FileSystemObject
  $fso.GetFolder("中文路径").ShortPath
  ```
- 其他 cmd 命令改用 PowerShell cmdlet 等效替代
```

---

## 五、PowerShell 复杂命令语法错误

### 错误现象
- 单行 PowerShell 命令中包含复杂变量引用（如 `$r.Content.Length`）时报语法错误
- 错误提示：`You must provide a value expression following the '+' operator`

### 可复用提示词
```
PowerShell 单行复杂命令易出错时，改用脚本文件方式：
1. 用 Write 工具创建 .ps1 脚本（注意添加 UTF-8 BOM）
2. 执行脚本：`powershell -ExecutionPolicy Bypass -File "脚本路径"`
3. 或将复杂逻辑拆分为多个简单命令分步执行
4. 避免在单行命令中嵌套过多变量属性访问
```

---

## 六、Node.js 版本冲突（TRAE IDE vs 系统）

### 错误现象
- `better-sqlite3` 等原生模块报 `MODULE_VERSION` 不匹配错误
- TRAE IDE 内置 Node.js v22 (MODULE_VERSION 127) 与系统 Node.js v24 (137) 冲突

### 可复用提示词
```
Node.js 原生模块版本冲突时：
1. 明确使用系统 Node.js 路径执行命令：
   ```powershell
   & "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" rebuild better-sqlite3
   ```
2. 启动服务器时也使用系统 Node.js 绝对路径
3. 在 .bat 启动器中检测并使用系统 Node.js：
   ```bat
   if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
   ```
4. 项目约束：服务器必须用系统 Node.js 启动，避免 IDE 内置版本干扰
```

---

## 七、Node.js 服务启动失败（bat 脚本）

### 错误现象
- `start /b node server/index.js >nul 2>&1` 导致服务启动失败
- `start /min node server/index.js` 双击 .bat 时无法可靠启动

### 可复用提示词
```
.bat 启动器中 Node.js 服务启动失败时：
1. 避免使用 `start /b`（输出重定向和共享 stdin 导致问题）
2. 避免使用 `start /min`（双击时不可靠）
3. 改用 PowerShell Start-Process 启动隐藏独立进程：
   ```bat
   powershell -Command "Start-Process node -ArgumentList 'server/index.js' -WindowStyle Hidden -RedirectStandardOutput 'server.log' -RedirectStandardError 'server.err'"
   ```
4. 启动后轮询端口确认服务就绪：
   ```bat
   :wait_loop
   netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
   if errorlevel 1 (
       ping 127.0.0.1 -n 2 >nul
       goto wait_loop
   )
   ```
```

---

## 八、Python 回测引擎常见 Bug 模式

### 错误现象类型

#### 8.1 SeriesDict 返回 list 而非 Series
```
Python 回测引擎中 SeriesDict 类的 hist['close'] 返回 list 而非 Series：
- 导致 .mean() 等 Series 方法报错
- 解决：_data 必须存储为 pandas.Series 类型，不能存为 list
```

#### 8.2 基准指数数据缺失导致错误回退
```
基准收益计算异常（如 -97.98%）：
- 原因：指数数据（如 000300）在某日期后缺失，回退到股票池第一只股票
- 解决：用前值填充缺失的指数数据（forward-fill）
- 验证：修复后基准收益应为合理值（如 +34.03%）
```

#### 8.3 持仓快照记录频率不足
```
持仓数据大部分交易日为空：
- 原因：只在季末（03-31/06-30/09-30）记录持仓快照
- 解决：改为每个交易日都记录持仓状态
```

---

## 九、通用排错工作流模板

### 可复用提示词
```
遇到"修改不生效"类问题时，按以下流程排查：

步骤 1：确认磁盘文件真实内容
- 用 PowerShell Get-Content 读取（不依赖 IDE 工具缓存）
- 用 Grep 搜索新代码关键词
- 对比文件大小和修改时间

步骤 2：确认服务器返回内容
- 用 curl.exe 请求服务器（绕过浏览器缓存）
- 对比磁盘文件和服务器响应

步骤 3：确认浏览器加载内容
- 用 browser_evaluate 执行 fetch 检查
- 用 URL 时间戳参数强制刷新

步骤 4：根据三层对比定位问题
- 磁盘旧 + 服务器旧 → Edit 未持久化 → 用 PowerShell 脚本修改
- 磁盘新 + 服务器旧 → 服务器缓存 → 重启服务器
- 磁盘新 + 服务器新 + 浏览器旧 → 浏览器缓存 → 时间戳参数刷新

步骤 5：中文路径脚本执行失败
- 检查 .ps1 是否有 UTF-8 BOM
- 用 [System.IO.File]::WriteAllText 添加 BOM 后重新执行
```

---

## 十、项目特定约束备忘

> 以下约束适用于本项目（聚宽-local 量化回测平台），使用时请确认是否适配目标项目。

```
项目硬约束：
1. 所有回测必须完全本地运行，数据存储在本地
2. 服务器必须用系统 Node.js（C:\Program Files\nodejs\node.exe）启动
3. 启动器用 PowerShell Start-Process 启动隐藏独立进程
4. .bat 文件用全英文注释避免 chcp 65001 编码问题
5. 用户输入控件用 localStorage 持久化
6. 策略名称在 backtests.algorithm_name 和 algorithms.name 间同步
```

---

## 使用说明

1. **按错误现象查找**：根据遇到的错误现象，定位到对应章节
2. **复制可复用提示词**：每个章节的"可复用提示词"代码块可直接复制使用
3. **调整路径和参数**：将占位符（如"文件路径"、"端口"、"关键词"）替换为实际值
4. **遵循排查顺序**：复杂问题优先使用第九章的通用排错工作流
5. **注意项目约束**：操作前确认第十章的项目特定约束
