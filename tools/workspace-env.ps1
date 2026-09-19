$WorkspaceRoot = Split-Path -Parent $PSScriptRoot
$env:LOCALSTOCK_WORKSPACE = $WorkspaceRoot
$env:LOCALSTOCK_MARKET_DB = Join-Path $WorkspaceRoot 'data\market\stock_data.db'
$env:LOCALSTOCK_RUNTIME_DIR = Join-Path $WorkspaceRoot 'data\runtime\joinquant'
$env:LOCALSTOCK_DESKTOP_USER_DATA = Join-Path $WorkspaceRoot 'data\runtime\desktop'
$env:LOCALSTOCK_STRATEGY_KB = Join-Path $WorkspaceRoot 'knowledge\strategy-library'
$env:LOCALSTOCK_QUANT_URL = 'http://127.0.0.1:3000'
# 价格行为 AI 服务（pa-agent）由桌面端托管启动，端口自动分配；
# 仅独立调试 `python server.py` 时才需要这个运行产物目录。
$env:LOCALSTOCK_PA_RUNTIME_DIR = Join-Path $WorkspaceRoot 'data\runtime\pa-agent'
