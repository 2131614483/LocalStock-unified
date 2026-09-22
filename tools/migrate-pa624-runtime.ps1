[CmdletBinding()]
param(
    [string]$SourceRoot = "D:\pythonpro\PA_Agent_624\PA_Agent",
    [string]$TargetRoot = (Join-Path $PSScriptRoot "..\data\runtime\desktop\pa-agent-aggressive")
)

$ErrorActionPreference = "Stop"

$SourceRoot = [System.IO.Path]::GetFullPath($SourceRoot)
$TargetRoot = [System.IO.Path]::GetFullPath($TargetRoot)

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    throw "找不到 PA Agent 624 源目录：$SourceRoot"
}

New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null

$groups = @(
    @{ Name = "离线分析包"; Source = "offline_packs"; Target = "offline_packs" },
    @{ Name = "批量离线分析数据"; Source = "offline_packs_batch"; Target = "offline_packs_batch" },
    @{ Name = "分析历史记录"; Source = "records\pending"; Target = "records\pending" },
    @{ Name = "交易记录"; Source = "trade_records"; Target = "trade_records" }
)

$results = @()
foreach ($group in $groups) {
    $sourceDir = Join-Path $SourceRoot $group.Source
    $targetDir = Join-Path $TargetRoot $group.Target
    if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
        $results += [pscustomobject]@{ Category = $group.Name; Copied = 0; Skipped = 0; Missing = $true }
        continue
    }

    $copied = 0
    $skipped = 0
    Get-ChildItem -LiteralPath $sourceDir -Recurse -File | ForEach-Object {
        if ($_.Name -eq ".gitkeep") { return }
        $relative = $_.FullName.Substring($sourceDir.Length).TrimStart('\', '/')
        $destination = Join-Path $targetDir $relative
        $destinationParent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null

        if (Test-Path -LiteralPath $destination) {
            $base = [System.IO.Path]::GetFileNameWithoutExtension($destination)
            $extension = [System.IO.Path]::GetExtension($destination)
            $destination = Join-Path $destinationParent ("{0}_pa624{1}" -f $base, $extension)
            $number = 2
            while (Test-Path -LiteralPath $destination) {
                $destination = Join-Path $destinationParent ("{0}_pa624_{1}{2}" -f $base, $number, $extension)
                $number++
            }
        }

        Copy-Item -LiteralPath $_.FullName -Destination $destination
        $copied++
    }
    $results += [pscustomobject]@{ Category = $group.Name; Copied = $copied; Skipped = $skipped; Missing = $false }
}

$manifest = [pscustomobject]@{
    source = $SourceRoot
    importedAt = (Get-Date).ToString("o")
    groups = $results
    notes = @(
        "未迁移 config/settings.json，避免覆盖桌面端配置或导入密钥。",
        "未发现 PA Agent 624 的本地 SQLite 行情数据库；桌面端继续使用统一行情库 data/market/stock_data.db。"
    )
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $TargetRoot "migration-pa624-manifest.json") -Encoding utf8

$results | Format-Table -AutoSize
Write-Host "迁移完成：$TargetRoot"
