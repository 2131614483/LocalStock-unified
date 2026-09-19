# 注册 QuantBacktestDailyPickClaude：工作日 18:40 用 claude -p 无头跑 daily-stock-pick skill
# prompt 从 UTF-8 文件读取（避免 ps1 中文编码问题）；WorkingDirectory 设为项目目录（加载项目 CLAUDE.md / .mcp.json / 白名单）
$ErrorActionPreference = 'Stop'
$prompt = [System.IO.File]::ReadAllText('D:\pythonpro\聚宽-local\data\_pick_prompt.txt', [System.Text.Encoding]::UTF8).Trim()
$action = New-ScheduledTaskAction -Execute 'C:\Users\he\AppData\Roaming\npm\claude.cmd' `
    -Argument ('-p "' + $prompt + '"') `
    -WorkingDirectory 'D:\pythonpro\聚宽-local'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '18:40'
Register-ScheduledTask -TaskName 'QuantBacktestDailyPickClaude' -Action $action -Trigger $trigger `
    -Description 'Claude headless daily stock pick (sync -> report -> browser realtime -> highlights)' -Force
Write-Output 'OK registered QuantBacktestDailyPickClaude'
