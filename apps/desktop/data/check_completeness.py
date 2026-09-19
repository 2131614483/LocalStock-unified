# -*- coding: utf-8 -*-
"""检查回测行情库的年度完整度与覆盖区间"""
import argparse
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('--db', required=True)
args = parser.parse_args()

conn = sqlite3.connect(args.db)
c = conn.cursor()

print('=== 1. 全局区间 ===')
r = c.execute('SELECT MIN(trade_date), MAX(trade_date), COUNT(DISTINCT trade_date), COUNT(*) FROM stock_daily').fetchone()
print('  日线范围: {} ~ {}，独立交易日 {}，总行数 {}'.format(*r))
r2 = c.execute('SELECT COUNT(*) FROM stocks').fetchone()[0]
print('  股票数:', r2)

print('=== 2. 交易日历（每年交易日数） ===')
rows = c.execute(
    'SELECT substr(trade_date,1,4) y, COUNT(*) FROM trade_calendar WHERE is_trading_day=1 GROUP BY y ORDER BY y').fetchall()
print('  年份区间: {} ~ {}，总交易日 {}'.format(rows[0][0], rows[-1][0], sum(n for _, n in rows)))

print('=== 3. 每年 stock_daily 行数 / 当年交易日 / 每只股票年均天数 ===')
n_stock = r2
for y, n in rows:
    if y < '1991':
        continue
    sy = c.execute('SELECT COUNT(*) FROM stock_daily WHERE substr(trade_date,1,4)=?', (y,)).fetchone()[0]
    if y == rows[-1][0]:
        # 当年：只统计有上市数据的股票
        avg = sy / n_stock if n_stock else 0
        print('  {} | 行数 {:>7} | 交易日 {:>5} | 每只均 {:>6.1f}（年内迄今）'.format(y, sy, n, avg))
    else:
        avg = sy / n_stock
        print('  {} | 行数 {:>7} | 交易日 {:>5} | 每只均 {:>6.1f}'.format(y, sy, n, avg))

print('=== 4. 各股票区间与年度完整度（抽样前 8 只） ===')
stocks = c.execute('SELECT DISTINCT stock_code FROM stock_daily ORDER BY stock_code LIMIT 8').fetchall()
for (code,) in stocks:
    rng = c.execute('SELECT MIN(trade_date), MAX(trade_date) FROM stock_daily WHERE stock_code=?', (code,)).fetchone()
    # 上市区间内的交易日数
    cal_days = c.execute(
        'SELECT COUNT(*) FROM trade_calendar WHERE is_trading_day=1 AND trade_date>=? AND trade_date<=?',
        (rng[0], rng[1])).fetchone()[0]
    have = c.execute('SELECT COUNT(DISTINCT trade_date) FROM stock_daily WHERE stock_code=?', (code,)).fetchone()[0]
    print('  {} | {} ~ {} | 应有 {} 天 | 实有 {} 天 | 完整度 {:.1f}%'.format(
        code, rng[0], rng[1], cal_days, have, have / cal_days * 100 if cal_days else 0))

print('=== 5. 缺失交易日统计（抽样 000001：按日历缺失天数） ===')
rng = c.execute('SELECT MIN(trade_date), MAX(trade_date) FROM stock_daily WHERE stock_code=?', ('000001',)).fetchone()
miss = c.execute(
    'SELECT COUNT(*) FROM trade_calendar t WHERE t.is_trading_day=1 AND t.trade_date>=? AND t.trade_date<=? '
    'AND NOT EXISTS (SELECT 1 FROM stock_daily s WHERE s.stock_code=? AND s.trade_date=t.trade_date)',
    (rng[0], rng[1], '000001')).fetchone()[0]
print('  000001 区间 {} ~ {}：日历交易日 {}，缺失 {} 天'.format(
    rng[0], rng[1], cal_days, miss))
