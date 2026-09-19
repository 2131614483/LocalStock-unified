@echo off
rem ============================================
rem  每日选股系统 · 一键启动（数据→报告→实时→回测）
rem  用系统 Python311（有 baostock/pandas/matplotlib）
rem ============================================
chcp 65001 >nul
cd /d "D:\pythonpro\聚宽-local"
echo ============================================
echo   每日选股 · 一键启动
echo   数据检查 → 报告(K线) → 实时行情 → 网页端回测
echo ============================================
"C:\Users\he\AppData\Local\Programs\Python\Python311\python.exe" scripts\run_daily.py
echo.
echo ============================================
echo   运行结束。报告见 Obsidian「量化回测平台/每日选股/」
echo ============================================
pause
