@echo off
setlocal
rem Use the folder containing this file; no fixed drive or current directory.
set "PROJECT_ROOT=%~dp0"

echo Starting LocalStock...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%tools\start-all.ps1"

if errorlevel 1 (
  echo.
  echo Startup failed. Check the PowerShell windows for details.
  pause
)
endlocal
