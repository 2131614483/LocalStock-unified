# -*- coding: utf-8 -*-
"""
CLI 包装：增量更新 baostock 日线行情
核心逻辑见 baostock_sync.py（与 GUI 共用）。
运行方式（必须用系统 Python311，baostock 只装在那里）:
  C:\\Users\\he\\AppData\\Local\\Programs\\Python\\Python311\\python.exe scripts/update-daily-baostock.py
"""
import sys
import argparse

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from baostock_sync import SyncConfig, run_sync


def main():
    ap = argparse.ArgumentParser(description='Incremental baostock sync (CLI)')
    ap.add_argument('--end', help='end date YYYY-MM-DD (default today)')
    ap.add_argument('--delay', type=float, default=0.2)


    ap.add_argument('--max-stocks', type=int, default=0)
    ap.add_argument('--no-indices', action='store_true')
    args = ap.parse_args()


    cfg = SyncConfig(end=args.end, delay=args.delay, max_stocks=args.max_stocks, no_indices=args.no_indices)


    stats = run_sync(cfg, log_fn=print)
    print('=' * 50)


    if stats.get('skipped_lock'):
        print('skip: another sync is running')
    elif stats.get('login_failed'):
        print('sync failed: baostock login error')
    elif stats.get('no_new_days'):
        print('no new trading days')


    else:
        print(f"done: {stats['rows']} rows, {stats['skipped']} skipped, {stats['failed']} failed")


if __name__ == '__main__':
    main()
