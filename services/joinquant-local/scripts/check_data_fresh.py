# -*- coding: utf-8 -*-
"""打印 stock_data.db 最新交易日（每日选股第 1 步「数据新鲜度检查」用）。

用法：系统 Python311 运行，输出一行 YYYY-MM-DD 或 NO_DATA/ERROR。
供 daily-stock-pick skill 判断是否需要先同步数据。
"""
import os
import sqlite3
import sys

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, 'data', 'stock_data.db')


def main():
    try:
        row = sqlite3.connect(DB).execute('SELECT MAX(trade_date) FROM stock_daily').fetchone()
        print(row[0] if row and row[0] else 'NO_DATA')
    except Exception as e:  # noqa: BLE001
        print('ERROR:', e)
    return 0


if __name__ == '__main__':
    sys.exit(main())
