. (Join-Path $PSScriptRoot 'workspace-env.ps1')
$required = @(
  (Join-Path $env:LOCALSTOCK_WORKSPACE 'apps\desktop\package.json'),
  (Join-Path $env:LOCALSTOCK_WORKSPACE 'services\joinquant-local\package.json'),
  $env:LOCALSTOCK_MARKET_DB,
  $env:LOCALSTOCK_STRATEGY_KB
)
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count) {
  $missing | ForEach-Object { Write-Error "缺少: $_" }
  exit 1
}
$db = Get-Item -LiteralPath $env:LOCALSTOCK_MARKET_DB
Write-Output "Workspace: $env:LOCALSTOCK_WORKSPACE"
Write-Output "Market DB: $($db.FullName) ($([math]::Round($db.Length / 1GB, 2)) GB)"
Write-Output "Strategy KB: $env:LOCALSTOCK_STRATEGY_KB"
Write-Output 'Workspace verification passed.'
