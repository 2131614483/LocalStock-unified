@echo off
chcp 65001 >nul 2>&1
title Quant Backtest Launcher
cd /d "%~dp0"

:: ============================================
::    Quant Backtest Platform Launcher
:: ============================================
:: 端口：默认 8080（3000 是 Windows 保留段 2990-3089，会被 EACCES 拒绝）。
:: 可用环境变量 PORT 覆盖，如 `set PORT=7070` 再运行本脚本。

set "PORT=8080"
if not defined PORT_ARG set "PORT_ARG=%PORT%"

echo ============================================
echo    Quant Backtest Platform Launcher
echo ============================================
echo.

:: Isolate environment: prefer system Node.js
set "NODE_EXE="
if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE (
    for /f "delims=" %%i in ('where node 2^>nul') do (
        if not defined NODE_EXE set "NODE_EXE=%%i"
    )
)
if not defined NODE_EXE (
    echo [ERROR] Node.js not found. Please install Node.js first.
    echo Download: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo [INFO] Using Node: %NODE_EXE%
"%NODE_EXE%" --version
echo.

:: Check dependencies
if not exist "node_modules" (
    echo [INIT] First run, installing dependencies...
    "%NODE_EXE%" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo.
)

:: Check if port is already in use
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Server is already running on port %PORT%.
    echo [OPEN] Opening browser...
    ping 127.0.0.1 -n 3 >nul
    start "" "http://localhost:%PORT%"
    exit /b 0
)

echo [START] Starting local server...
echo [INFO]  URL: http://localhost:%PORT%
echo.

:: Start server in a minimized window with PORT env, log to file
start "Quant Backtest Server" /min cmd /c "set PORT=%PORT% && ""%NODE_EXE%" server/index.js > server.log 2>&1"

:: Wait for server to be ready
echo [WAIT] Waiting for server to be ready...
set /a tries=0
:wait_loop
set /a tries+=1
if %tries% gtr 30 (
    echo [ERROR] Server startup timeout. Check server.log for details.
    echo [TIP] Try running "set PORT=%PORT% & %NODE_EXE% server/index.js" manually to see errors.
    pause
    exit /b 1
)
ping 127.0.0.1 -n 2 >nul
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [WAIT] Starting... (%tries%/30)
    goto wait_loop
)

echo.
echo [OK] Server is running!
echo [OPEN] Opening browser...
start "" "http://localhost:%PORT%"
echo.
echo ============================================
echo  Server is running at http://localhost:%PORT%
echo  A minimized "Quant Backtest Server" window
echo  is in taskbar - close it to stop server.
echo ============================================
echo.
echo Press Ctrl+C to exit (server keeps running).
echo.

:: Keep window alive so user can see status
:keep_alive
ping 127.0.0.1 -n 3600 >nul
goto keep_alive
