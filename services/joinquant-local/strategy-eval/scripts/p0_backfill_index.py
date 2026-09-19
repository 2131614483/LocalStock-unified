# -*- coding: utf-8 -*-
"""
P0 指数回填：腾讯 fqkline → index_daily
目标指数：000905 中证500 / 000016 上证50 / 399006 创业板指 / 000852 中证1000 /
          000902 中证流通 / 399303 国证2000
已验证：腾讯 [date, open, close, high, low, volume] 列序，OHLC 与 baostock 偏差 <0.004
原则：INSERT OR IGNORE（不覆盖 CSMAR 已有行）；qfq 口径（指数无分红，等价原始）
"""
import json
import sqlite3
import subprocess
import sys
import time
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

DB = r'D:\pythonpro\聚宽-local\data\stock_data.db'
LOG = r'D:\pythonpro\聚宽-local\strategy-eval\logs\p0_index_backfill.log'

TARGETS = [
    ('sh000905', '000905', '2007-01-01'),   # 中证500
    ('sh000016', '000016', '2005-01-01'),   # 上证50
    ('sz399006', '399006', '2010-05-01'),   # 创业板指
    ('sh000852', '000852', '2014-10-01'),   # 中证1000
    ('sh000902', '000902', '2006-02-01'),   # 中证流通
    ('sz399303', '399303', '2014-04-01'),   # 国证2000
]

def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')

def fetch_chunk(code, start, end, n=2000, retries=3):
    url = (f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
           f'?param={code},day,{start},{end},{n},qfq')
    for attempt in range(retries):
        try:
            out = subprocess.run(['curl', '-s', '--max-time', '25', url,
                                  '-H', 'User-Agent: Mozilla/5.0'],
                                 capture_output=True, timeout=30)
            raw = out.stdout.decode('utf-8', errors='replace') if isinstance(out.stdout, bytes) else ''
            d = json.loads(raw)
            node = d['data'][code]
            if isinstance(node, list):
                return None
            return node.get('qfqday') or node.get('day') or []
        except Exception as e:
            if attempt == retries - 1:
                log(f'  {code} chunk {start}~{end} FAIL: {str(e)[:60]}')
                return None
            time.sleep(3 * (attempt + 1))
    return None

def walk_full_history(tx_code, listing_start):
    """向前翻页直到取完上市以来全部数据。"""
    all_bars = []
    end = '2026-08-25'
    while True:
        bars = fetch_chunk(tx_code, listing_start, end)
        if not bars:
            break
        all_bars = bars + all_bars
        new_end = bars[0][0]
        # 收敛：返回块首日 >= 当前end 或 <= 上市起点 → 结束
        if new_end >= end or len(bars) < n_hint(bars):
            break
        prev_first = bars[0][0]
        end = prev_first
        if not all_bars or all_bars[0][0] <= listing_start:
            break
        time.sleep(1.0)
    return all_bars

def n_hint(bars):
    return 1900  # 接近单请求上限说明可能还有更早数据

def main():
    conn = sqlite3.connect(DB)
    conn.execute('PRAGMA journal_mode=WAL')
    total_inserted = 0
    for tx_code, db_code, listing in TARGETS:
        t0 = time.time()
        # 已覆盖范围
        r = conn.execute('SELECT COUNT(*), MIN(trade_date), MAX(trade_date) FROM index_daily WHERE index_code=?',
                         (db_code,)).fetchone()
        log(f'== {db_code}: existing {r[0]} rows ({r[1]} ~ {r[2]})')

        bars = walk_full_history(tx_code, listing)
        if not bars:
            log(f'   {db_code}: NO DATA fetched')
            continue
        # 去重并排序
        seen = {}
        for b in bars:
            seen[b[0]] = b
        rows = []
        for date_str in sorted(seen):
            b = seen[date_str]
            try:
                o, c, h, l = float(b[1]), float(b[2]), float(b[3]), float(b[4])
            except (ValueError, IndexError):
                continue
            vol = float(b[5]) if len(b) > 5 and b[5] else 0.0
            dt = datetime.strptime(date_str, '%Y-%m-%d')
            ret = 0.0  # 占位；return_index 由引擎按 close 比值计算，不依赖此列
            dow = dt.isoweekday()
            rows.append((db_code, date_str, dow, o, h, l, c, ret))
        before = conn.execute('SELECT COUNT(*) FROM index_daily WHERE index_code=?', (db_code,)).fetchone()[0]
        conn.executemany(
            'INSERT OR IGNORE INTO index_daily (index_code, trade_date, day_of_week, open_index, high_index, low_index, close_index, return_index) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)', rows)
        conn.commit()
        after = conn.execute('SELECT COUNT(*) FROM index_daily WHERE index_code=?', (db_code,)).fetchone()[0]
        inserted = after - before
        total_inserted += inserted
        rr = conn.execute('SELECT MIN(trade_date), MAX(trade_date), COUNT(*) FROM index_daily WHERE index_code=?',
                          (db_code,)).fetchone()
        log(f'   {db_code}: fetched {len(rows)}, inserted {inserted}, now {rr[2]} rows ({rr[0]} ~ {rr[1]}), {time.time()-t0:.0f}s')
        time.sleep(1.5)
    log(f'DONE total inserted {total_inserted}')

if __name__ == '__main__':
    main()
