# -*- coding: utf-8 -*-
"""
全量下载 A 股历史日线（AkShare 新浪源）→ 构建回测引擎兼容的 SQLite 行情库。

用法:
  python download_full_data.py --db <path> [--start 1990-01-01] [--max-stocks N] [--reset]

特性:
  - 建表 trade_calendar / stocks / stock_daily / index_daily（CSMAR 命名，兼容 backtest_engine）
  - 前复权日线（adjust=qfq），adj_close_wd = 前复权 close，pre_close 由 shift 推导
  - 断点续传：stock_daily 已有数据的股票自动跳过
  - 进度输出：stdout 每 50 只输出一行 JSONL
"""
import argparse
import json
import os
import sys
import time

import akshare as ak
import pandas as pd

START_DEFAULT = '1990-01-01'
END_DEFAULT = '2050-01-01'  # akshare 会截断到最新

# 数据版本（随脚本变更递增，写入 sync_meta，供前端展示/判断是否需要重下）
DB_VERSION = '20260811'

# 回测引擎需要的指数（000300 为默认基准）
INDEXES = [
    ('sh000300', '000300', '沪深300'),
    ('sh000001', '000001', '上证指数'),
    ('sz399001', '399001', '深证成指'),
    ('sz399006', '399006', '创业板指'),
]

MARKET_NAMES = {1: '沪A', 4: '深A', 16: '创业板', 32: '科创板', 64: '北交所'}


def derive_market_type(code):
    if code.startswith('688'):
        return 32
    if code.startswith('300'):
        return 16
    if code.startswith('6'):
        return 1
    if code.startswith(('000', '001', '002', '003')):
        return 4
    if code.startswith(('8', '4', '9')):
        return 64
    return 0


def symbol_of(code):
    """6 位代码 → 新浪 symbol（sh/sz）；北交返回 None（新浪不支持）"""
    if code.startswith('6'):
        return 'sh' + code
    if code.startswith(('0', '3')):
        return 'sz' + code
    return None


def log(msg):
    print(msg, flush=True)


def force_utf8_stdio():
    """Windows 下被管道捕获时 stdout/stderr 默认按 locale（GBK）编码，
    导致 Electron 端按 UTF-8 解码出现乱码。这里统一强制为 UTF-8。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except Exception:
            pass


def emit_progress(done, total, rows, failed, skipped):
    print(json.dumps({
        'type': 'progress', 'done': done, 'total': total,
        'rows': rows, 'failed': failed, 'skipped': skipped
    }, ensure_ascii=False), flush=True)


def open_db(db_path):
    import sqlite3
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS trade_calendar (
            trade_date TEXT PRIMARY KEY,
            is_trading_day INTEGER,
            year INTEGER,
            month INTEGER
        );
        CREATE TABLE IF NOT EXISTS stocks (
            stock_code TEXT PRIMARY KEY,
            market_type INTEGER,
            market_name TEXT,
            name TEXT,
            first_trade_date TEXT,
            last_trade_date TEXT,
            status INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS stock_daily (
            stock_code TEXT,
            trade_date TEXT,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            close_price REAL,
            pre_close_price REAL,
            change_ratio REAL,
            volume INTEGER,
            amount REAL,
            dretwd REAL,
            dretnd REAL,
            adj_close_wd REAL,
            adj_close_nd REAL,
            market_type INTEGER,
            trade_status INTEGER,
            PRIMARY KEY (stock_code, trade_date)
        );
        CREATE INDEX IF NOT EXISTS idx_stock_daily_code ON stock_daily(stock_code, trade_date);
        CREATE TABLE IF NOT EXISTS index_daily (
            index_code TEXT,
            trade_date TEXT,
            close_index REAL,
            return_index REAL,
            PRIMARY KEY (index_code, trade_date)
        );
        CREATE TABLE IF NOT EXISTS sync_state (
            stock_code TEXT PRIMARY KEY,
            last_trade_date TEXT,
            status TEXT,              -- 'ok' | 'failed'
            failed_count INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
    ''')
    conn.commit()
    # 兼容旧库：若已有 stock_daily 数据但无 sync_state，从已有数据播种，
    # 避免首次运行按新表全量重下 3GB 库。
    seed_sync_state(conn)
    return conn


def seed_sync_state(conn):
    """从已有 stock_daily 初始化 sync_state（status='ok'，last=MAX(trade_date)）"""
    n = conn.execute('SELECT COUNT(*) FROM sync_state').fetchone()[0]
    if n > 0:
        return
    conn.execute('''
        INSERT OR IGNORE INTO sync_state (stock_code, last_trade_date, status)
        SELECT stock_code, MAX(trade_date), 'ok' FROM stock_daily GROUP BY stock_code
    ''')
    conn.commit()


def get_stock_list(max_stocks=0):
    """AkShare 全 A 股代码表，过滤出新浪支持的沪深 A 股"""
    df = ak.stock_info_a_code_name()
    stocks = []
    for _, row in df.iterrows():
        code = str(row['code']).strip()
        sym = symbol_of(code)
        if not sym:
            continue
        stocks.append({'code': code, 'sym': sym, 'name': str(row['name']).strip()})
    stocks.sort(key=lambda s: s['code'])
    if max_stocks:
        stocks = stocks[:max_stocks]
    return stocks


def update_trade_calendar(conn, start):
    insert = 'INSERT OR IGNORE INTO trade_calendar (trade_date, is_trading_day, year, month) VALUES (?,?,?,?)'
    cal = ak.tool_trade_date_hist_sina()
    rows = []
    for d in cal['trade_date']:
        ds = str(d)[:10]
        if ds < start:
            continue
        rows.append((ds, 1, int(ds[:4]), int(ds[5:7])))
    conn.executemany(insert, rows)
    conn.commit()
    return len(rows)


def update_index_daily(conn):
    insert = 'INSERT OR IGNORE INTO index_daily (index_code, trade_date, close_index, return_index) VALUES (?,?,?,?)'
    total = 0
    for sym, num, _name in INDEXES:
        try:
            df = ak.stock_zh_index_daily(symbol=sym)
        except Exception as e:
            log(f'  [指数] {sym} 失败: {e}')
            continue
        df = df.copy()
        df['return'] = df['close'].pct_change().fillna(0)
        rows = []
        for _, r in df.iterrows():
            rows.append((num, str(r['date'])[:10], float(r['close']), float(r['return'])))
        if rows:
            conn.executemany(insert, rows)
            conn.commit()
            total += len(rows)
        time.sleep(0.2)
    return total


def update_stocks(conn, stocks):
    insert = ('INSERT OR IGNORE INTO stocks '
              '(stock_code, market_type, market_name, name, first_trade_date, last_trade_date, status) '
              'VALUES (?,?,?,?,?,?,1)')
    rows = []
    for s in stocks:
        mtype = derive_market_type(s['code'])
        rows.append((s['code'], mtype, MARKET_NAMES.get(mtype, ''), s['name'], None, None))
    conn.executemany(insert, rows)
    conn.commit()
    return len(rows)


def update_stock_daily(conn, stocks, start, max_stocks=0, refresh=False):
    insert_sql = (
        'INSERT OR IGNORE INTO stock_daily '
        '(stock_code, trade_date, open_price, high_price, low_price, '
        'close_price, pre_close_price, change_ratio, volume, amount, '
        'dretwd, dretnd, adj_close_wd, adj_close_nd, market_type, trade_status) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    # 断点续传：默认跳过 sync_state 标记 ok 的股票；--refresh 强制全量重下（INSERT OR IGNORE 幂等）
    if refresh:
        done = set()
    else:
        done = set(r[0] for r in conn.execute("SELECT stock_code FROM sync_state WHERE status='ok'"))
    codes = [s for s in stocks if s['code'] not in done]
    if max_stocks:
        codes = codes[:max_stocks]

    total_rows = 0
    failed = []
    skipped = len(stocks) - len(codes)
    total = len(codes)
    start_compact = start.replace('-', '')

    for idx, s in enumerate(codes):
        ok = False
        df = None
        for attempt in range(3):
            try:
                df = ak.stock_zh_a_daily(
                    symbol=s['sym'], start_date=start_compact,
                    end_date='20500101', adjust='qfq')
                ok = True
                break
            except Exception as e:
                last_err = e
                time.sleep(1)
        if not ok:
            conn.execute('''
                INSERT INTO sync_state (stock_code, status, failed_count, updated_at)
                VALUES (?, 'failed', 1, datetime('now','localtime'))
                ON CONFLICT(stock_code) DO UPDATE SET
                    status='failed', failed_count = sync_state.failed_count + 1,
                    updated_at = datetime('now','localtime')
            ''', (s['code'],))
            conn.commit()
            failed.append(s['code'])
            log(json.dumps({'type': 'log', 'message': f'  {s["code"]} 失败: {last_err}'}, ensure_ascii=False))
            if len(failed) >= 100:
                log(f'[下载] 失败过多（{len(failed)} 只），中止剩余下载')
                break
            continue

        if df is None or df.empty:
            failed.append(s['code'])
            continue

        df = df.copy()
        df['pre_close'] = df['close'].shift(1)
        df.loc[df['pre_close'].isna(), 'pre_close'] = 0.0
        df['pre_close'] = df['pre_close'].astype(float)
        df['ret'] = df.apply(
            lambda r: round(r['close'] / r['pre_close'] - 1, 6) if r['pre_close'] > 0 else 0.0, axis=1)
        mtype = derive_market_type(s['code'])

        rows = []
        for _, r in df.iterrows():
            rows.append((
                s['code'], str(r['date'])[:10],
                float(r['open']), float(r['high']), float(r['low']),
                float(r['close']), float(r['pre_close']),
                float(r['ret']), int(float(r['volume'])), round(float(r['amount']), 2),
                float(r['ret']), float(r['ret']), float(r['close']), float(r['close']),
                mtype, 1
            ))
        if rows:
            conn.executemany(insert_sql, rows)
            last_date = str(df['date'].iloc[-1])[:10] if len(df) else ''
            conn.execute('''
                INSERT INTO sync_state (stock_code, last_trade_date, status, failed_count, updated_at)
                VALUES (?, ?, 'ok', 0, datetime('now','localtime'))
                ON CONFLICT(stock_code) DO UPDATE SET
                    last_trade_date = excluded.last_trade_date, status='ok', failed_count=0,
                    updated_at = datetime('now','localtime')
            ''', (s['code'], last_date))
            conn.commit()
            total_rows += len(rows)
        time.sleep(0.2)

        if (idx + 1) % 50 == 0 or (idx + 1) == total:
            emit_progress(idx + 1, total, total_rows, len(failed), skipped)

    return total_rows, skipped, failed


def main():
    force_utf8_stdio()
    parser = argparse.ArgumentParser(description='下载 A 股历史日线（AkShare）构建回测行情库')
    parser.add_argument('--db', required=True, help='SQLite 数据库路径')
    parser.add_argument('--start', default=START_DEFAULT, help='起始日期 YYYY-MM-DD')
    parser.add_argument('--max-stocks', type=int, default=0, help='仅下载前 N 只（调试/分片）')
    parser.add_argument('--reset', action='store_true', help='清空 stock_daily 重建')
    parser.add_argument('--refresh', action='store_true', help='强制全量重下（即使 sync_state 标记 ok）')
    parser.add_argument('--no-index', action='store_true', help='跳过指数下载')
    args = parser.parse_args()

    t0 = time.time()
    conn = open_db(args.db)
    if args.reset:
        conn.execute('DELETE FROM stock_daily')
        conn.commit()
        log('[下载] 已清空 stock_daily')

    try:
        log(json.dumps({'type': 'log', 'message': '拉取股票列表...'}, ensure_ascii=False))
        stocks = get_stock_list(args.max_stocks)
        log(json.dumps({'type': 'log', 'message': f'股票列表 {len(stocks)} 只'}, ensure_ascii=False))

        n_cal = update_trade_calendar(conn, args.start)
        log(json.dumps({'type': 'log', 'message': f'交易日历 {n_cal} 天'}, ensure_ascii=False))

        update_stocks(conn, stocks)

        if not args.no_index:
            n_idx = update_index_daily(conn)
            log(json.dumps({'type': 'log', 'message': f'指数数据 {n_idx} 行'}, ensure_ascii=False))

        rows, skipped, failed = update_stock_daily(conn, stocks, args.start, args.max_stocks, refresh=args.refresh)
        conn.execute(
            'UPDATE stocks SET first_trade_date = (SELECT MIN(trade_date) FROM stock_daily s2 WHERE s2.stock_code=stocks.stock_code), '
            'last_trade_date = (SELECT MAX(trade_date) FROM stock_daily s2 WHERE s2.stock_code=stocks.stock_code)')
        # 记录数据版本 + 最后同步时间（供前端展示 / 判断是否需要重下）
        conn.execute('INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (\'db_version\', ?, datetime(\'now\',\'localtime\'))', (DB_VERSION,))
        conn.execute('INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (\'last_full_sync\', datetime(\'now\',\'localtime\'), datetime(\'now\',\'localtime\'))')
        conn.commit()
        log(json.dumps({
            'type': 'done', 'stocks': len(stocks), 'rows': rows,
            'skipped': skipped, 'failed': failed,
            'elapsed_sec': int(time.time() - t0),
        }, ensure_ascii=False))
    except Exception as e:
        log(json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False))
        sys.exit(1)

    if failed:
        log(json.dumps({'type': 'log', 'message': f'下载完成，失败 {len(failed)} 只: {",".join(failed[:10])}'}, ensure_ascii=False))
    log(json.dumps({'type': 'log', 'message': '全部完成'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
