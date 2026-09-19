"""
CSMAR 数据完整导入脚本（Python版，比Node快3-5倍）
只导入回测核心字段，减小数据库体积

运行: python scripts/import-csmar-py.py
"""
import os
import sqlite3
import csv
import time
from glob import glob

CSMAR_DIR = r'D:\pythonpro\股票日数据'
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'stock_data.db')
BATCH_SIZE = 50000

def main():
    start = time.time()
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = OFF')
    conn.execute('PRAGMA cache_size = -64000')
    conn.execute('PRAGMA temp_store = MEMORY')

    # 清空旧数据
    print('清空旧 stock_daily 数据...')
    conn.execute('DELETE FROM stock_daily')
    conn.commit()

    # 查找所有CSV
    csv_files = []
    for root, dirs, files in os.walk(CSMAR_DIR):
        for f in files:
            if f.lower().startswith('trd_dalyr') and f.lower().endswith('.csv'):
                csv_files.append(os.path.join(root, f))
    csv_files.sort()
    print(f'找到 {len(csv_files)} 个CSV文件\n')

    # 批量插入（只导入核心字段）
    insert_sql = '''INSERT OR IGNORE INTO stock_daily
        (stock_code, trade_date, open_price, close_price, pre_close_price,
         volume, amount, dretwd, dretnd, adj_close_wd, adj_close_nd,
         mkt_cap_total, market_type, trade_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'''

    total_rows = 0
    file_idx = 0
    batch = []

    for csv_path in csv_files:
        file_idx += 1
        file_rows = 0
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                stkcd = row.get('Stkcd', '').strip()
                trddt = row.get('Trddt', '').strip()
                if not stkcd or not trddt or stkcd == 'Stkcd':
                    continue
                try:
                    batch.append((
                        stkcd, trddt,
                        float(row.get('Opnprc') or 0),
                        float(row.get('Clsprc') or 0),
                        float(row.get('PreClosePrice') or 0),
                        int(float(row.get('Dnshrtrd') or 0)),
                        float(row.get('Dnvaltrd') or 0),
                        float(row.get('Dretwd') or 0),
                        float(row.get('Dretnd') or 0),
                        float(row.get('Adjprcwd') or 0),
                        float(row.get('Adjprcnd') or 0),
                        float(row.get('Dsmvtll') or 0),
                        int(float(row.get('Markettype') or 0)),
                        int(float(row.get('Trdsta') or 0)),
                    ))
                    file_rows += 1
                    if len(batch) >= BATCH_SIZE:
                        conn.executemany(insert_sql, batch)
                        conn.commit()
                        total_rows += len(batch)
                        batch = []
                        elapsed = time.time() - start
                        rate = int(total_rows / elapsed) if elapsed > 0 else 0
                        print(f'\r  已导入: {total_rows:>12,} 行 | {rate:>6,} 行/秒 | {elapsed:.0f}s', end='', flush=True)
                except (ValueError, KeyError):
                    continue

        if batch:
            conn.executemany(insert_sql, batch)
            conn.commit()
            total_rows += len(batch)
            batch = []

        print(f'\n  [{file_idx}/{len(csv_files)}] {os.path.basename(csv_path)}: {file_rows:,} 行')

    # 提取股票信息和交易日历
    print('\n提取股票基本信息...')
    conn.execute('''INSERT OR IGNORE INTO stocks
        (stock_code, market_type, market_name, first_trade_date, last_trade_date, status)
        SELECT stock_code, market_type,
            CASE market_type
                WHEN 1 THEN '上证A股' WHEN 2 THEN '上证B股'
                WHEN 4 THEN '深证A股' WHEN 8 THEN '深证B股'
                WHEN 16 THEN '创业板' WHEN 32 THEN '科创板'
                WHEN 64 THEN '北证A股' ELSE '其他' END,
            MIN(trade_date), MAX(trade_date), 1
        FROM stock_daily GROUP BY stock_code, market_type''')
    conn.commit()
    stock_cnt = conn.execute('SELECT COUNT(*) FROM stocks').fetchone()[0]
    print(f'  股票: {stock_cnt:,} 只')

    print('提取交易日历...')
    conn.execute('''INSERT OR IGNORE INTO trade_calendar (trade_date, is_trading_day, year, month)
        SELECT DISTINCT trade_date, 1,
            CAST(strftime('%Y', trade_date) AS INTEGER),
            CAST(strftime('%m', trade_date) AS INTEGER)
        FROM stock_daily ORDER BY trade_date''')
    conn.commit()
    cal_cnt = conn.execute('SELECT COUNT(*) FROM trade_calendar').fetchone()[0]
    print(f'  交易日: {cal_cnt:,} 个')

    # 统计
    total = conn.execute('SELECT COUNT(*) FROM stock_daily').fetchone()[0]
    rng = conn.execute('SELECT MIN(trade_date), MAX(trade_date) FROM stock_daily').fetchone()
    db_size = os.path.getsize(DB_PATH) / 1024 / 1024
    elapsed = time.time() - start

    print(f'\n{"="*50}')
    print(f'✅ 导入完成!')
    print(f'   总行数: {total:,}')
    print(f'   时间范围: {rng[0]} ~ {rng[1]}')
    print(f'   数据库大小: {db_size:.0f} MB')
    print(f'   总耗时: {elapsed:.0f}s')

    conn.close()

if __name__ == '__main__':
    main()
