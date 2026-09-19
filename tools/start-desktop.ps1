. (Join-Path $PSScriptRoot 'workspace-env.ps1')
Set-Location (Join-Path $env:LOCALSTOCK_WORKSPACE 'apps\desktop')
npm run dev
