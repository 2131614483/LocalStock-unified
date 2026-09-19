# -*- coding: utf-8 -*-
"""每日选股一键运行（启动脚本的编排器）：数据检查 → 生成报告(含K线) → 实时行情 → 网页端回测。

供 启动每日选股.bat 调用；也可手动跑。任何一步失败不阻塞后续。
用法：C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/run_daily.py
"""
import os
import re
import subprocess
import sys

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
REPORT_DIR = os.path.join(BASE, 'docs', 'project-docs', '每日选股')


def run(script, *args):
    print(f'\n===== {script} {(" ".join(args))} =====', flush=True)
    try:
        r = subprocess.run([PY, os.path.join(BASE, 'scripts', script)] + list(args), cwd=BASE)
        return r.returncode
    except Exception as e:  # noqa: BLE001
        print(f'  执行失败: {e}')
        return 1


def top10_from_latest_report():
    files = sorted(f for f in os.listdir(REPORT_DIR)
                   if f.startswith('每日选股_') and f.endswith('.md')) if os.path.isdir(REPORT_DIR) else []
    if not files:
        return []
    txt = open(os.path.join(REPORT_DIR, files[-1]), encoding='utf-8').read()
    rows = re.findall(r'^\| \d+ \| (\d{6}) \|', txt, re.M)
    return rows[:10]


def main():
    print('# 每日选股一键运行', flush=True)
    run('check_data_fresh.py')
    run('daily_stock_pick.py', '--strategy', 'smallcap')
    codes = top10_from_latest_report()
    if codes:
        run('fetch_realtime.py', ','.join(codes), '6')
    else:
        print('（未从报告提取到 top-10，跳过实时）')
    run('daily_web_backtest.py', '--port', '8080', '--days', '120')
    print('\n# 完成！报告见 Obsidian「量化回测平台/每日选股/」', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
