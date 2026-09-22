<#
  Windows Task Scheduler entry point for LocalStock's daily market maintenance.
  It deliberately runs from this repository and always writes the one
  authoritative database defined by workspace-env.ps1.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'workspace-env.ps1')

$runtimeDir = Join-Path $workspaceRoot 'data\runtime\desktop\market-sync-logs'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$logPath = Join-Path $runtimeDir ("sync-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'LocalStockIncrementalSync', [ref]$createdNew)
if (-not $createdNew) {
  "[$(Get-Date -Format s)] 已有增量同步任务运行，跳过本次。" | Tee-Object -FilePath $logPath
  exit 0
}

try {
  $activePython = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -match '(?i)download_fund_history\.py|sync_incremental_data\.py'
    }
  if ($activePython) {
    "[$(Get-Date -Format s)] 检测到基金全量下载或增量同步仍在运行，跳过本次。" |
      Tee-Object -FilePath $logPath
    exit 0
  }

  $dbPath = $env:LOCALSTOCK_MARKET_DB
  if (-not (Test-Path -LiteralPath $dbPath)) {
    throw "行情库不存在：$dbPath"
  }
  $scriptPath = Join-Path $workspaceRoot 'apps\desktop\python\scripts\sync_incremental_data.py'
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "增量同步脚本不存在：$scriptPath"
  }
  $python = (Get-Command python.exe -ErrorAction Stop).Source
  "[$(Get-Date -Format s)] 开始增量同步：$dbPath" | Tee-Object -FilePath $logPath
  & $python $scriptPath --db $dbPath 2>&1 | Tee-Object -FilePath $logPath -Append
  if ($LASTEXITCODE -ne 0) {
    throw "同步脚本退出码：$LASTEXITCODE"
  }
  "[$(Get-Date -Format s)] 增量同步完成。" | Tee-Object -FilePath $logPath -Append
} catch {
  "[$(Get-Date -Format s)] 同步失败：$($_.Exception.Message)" | Tee-Object -FilePath $logPath -Append
  exit 1
} finally {
  if ($createdNew) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
