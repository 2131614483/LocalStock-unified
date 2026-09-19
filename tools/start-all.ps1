. (Join-Path $PSScriptRoot 'workspace-env.ps1')
$quantScript = Join-Path $PSScriptRoot 'start-quant.ps1'
$desktopScript = Join-Path $PSScriptRoot 'start-desktop.ps1'
Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $quantScript -WindowStyle Hidden
Start-Sleep -Seconds 2
# 价格行为 AI 服务由桌面端自己拉起（见 apps/desktop/electron/pa/server.ts），无需单独启动
Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $desktopScript -WindowStyle Hidden
