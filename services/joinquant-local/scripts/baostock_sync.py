# -*- coding: utf-8 -*-
"""
baostock 增量同步核心库

供 CLI（update-daily-baostock.py）与 GUI（sync_gui.py）共用。
只 INSERT OR IGNORE，绝不清空既有数据；支持断点续传与并发锁。

运行解释器：系统 Python311（baostock/pandas 只装在那里）。
"""
import os
import sys
import json
import time
import sqlite3
from datetime import date, datetime, timedelta
from dataclasses import dataclass
import socket
# 网络默认超时：避免 baostock 服务器无响应时无限挂起（计划任务场景关键）
socket.setdefaulttimeout(30)

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'data', 'stock_data.db')
META_PATH = os.path.join(BASE_DIR, 'data', 'sync_meta.json')
LOCK_PATH = os.path.join(BASE_DIR, 'data', 'sync.lock')

# 指数（含引擎回退基准 000016/000905）
MAIN_INDEX_CODES = ['000001', '000002', '000003', '000010', '000020',
                    '000300', '000902', '000903', '399001', '399004',
                    '399005', '399106', '399107', '399108', '399329',
                    '399903', '000016', '000905']

MARKET_NAME = {1: '上证A股', 2: '上证B股', 4: '深证A股', 8: '深证B股',
               16: '创业板', 32: '科创板', 64: '北证A股'}


@dataclass
class SyncConfig:
    end: str = ''                # 结束日期 YYYY-MM-DD，空=今天
    delay: float = 0.2           # 每股下载间隔秒
    max_stocks: int = 0          # 调试用
    no_indices: bool = False     # 跳过指数


def stock_bs_code(code):
    """股票代码 → baostock 代码"""
    if code.startswith(('6', '9')):
        return 'sh.' + code
    if code.startswith(('8', '4')) or code.startswith('920'):
        return 'bj.' + code
    return 'sz.' + code


def index_bs_code(code):
    return ('sh.' if code.startswith('000') else 'sz.') + code


def derive_market_type(code):
    """新股市场类型推导（CSMAR 口径）"""
    if code.startswith(('6', '9')):
        return 32 if code.startswith(('688', '689')) else (2 if code.startswith('900') else 1)
    if code.startswith(('8', '4')) or code.startswith('920'):
        return 64
    return 16 if code.startswith(('300', '301')) else 4


def parse_row_float(val, default=0.0):
    try:
        f = float(val)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def open_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = OFF')
    conn.execute('PRAGMA temp_store = MEMORY')
    return conn


def compute_start(conn):
    # 起点 = 交易日历最后一天 + 1 天（日历在股票之后才更新，断点续跑时仍是旧值，可正确对齐）
    cal_max = conn.execute('SELECT MAX(trade_date) FROM trade_calendar').fetchone()
    if cal_max and cal_max[0]:
        return (datetime.strptime(cal_max[0], '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
    return '2026-01-01'


def acquire_lock():
    if os.path.exists(LOCK_PATH):
        age = time.time() - os.path.getmtime(LOCK_PATH)
        if age < 7200:
            return False
        os.remove(LOCK_PATH)  # 过期锁
    with open(LOCK_PATH, 'w') as f:
        f.write(str(time.time()))
    return True


def release_lock():
    try:
        os.remove(LOCK_PATH)
    except OSError:
        pass


def update_trade_calendar(conn, bs, start, end, log_fn=print):
    # 用 baostock 官方交易日历补增量交易日
    rs = bs.query_trade_dates(start_date=start, end_date=end)
    if rs.error_code != '0':
        log_fn(f'  [日历] query_trade_dates 失败: {rs.error_msg}')
        return 0
    rows = []
    while rs.error_code == '0' and rs.next():
        d, is_trading = rs.get_row_data()
        if is_trading == '1':
            rows.append((d, 1, int(d[:4]), int(d[5:7])))
    sql = 'INSERT OR IGNORE INTO trade_calendar (trade_date, is_trading_day, year, month) VALUES (?,?,?,?)'
    conn.executemany(sql, rows)
    conn.commit()
    log_fn(f'  [日历] 新增交易日 {len(rows)} 个（{start} ~ {end}）')
    return len(rows)


def update_index_daily(conn, bs, start, end, delay=0.2, log_fn=print):
    # 指数从自身最后日期起补（可能早于股票，避免 06-11/06-12 缺口）
    istart = conn.execute('SELECT MAX(trade_date) FROM index_daily').fetchone()[0]
    istart = (datetime.strptime(istart, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
    if istart > end:
        return 0
    insert_sql = ('INSERT OR IGNORE INTO index_daily '
                  '(index_code, trade_date, day_of_week, open_index, high_index, '
                  'low_index, close_index, return_index) VALUES (?,?,?,?,?,?,?,?)')
    total = 0
    for code in MAIN_INDEX_CODES:
        bscode = index_bs_code(code)
        rs = bs.query_history_k_data_plus(
            bscode, 'date,open,high,low,close,pctChg',
            start_date=istart, end_date=end, frequency='d', adjustflag='3')
        if rs.error_code != '0':
            log_fn(f'  [指数] {code} 查询失败: {rs.error_msg}')
            continue
        rows = []
        while rs.error_code == '0' and rs.next():
            d, o, h, l, c, pct = rs.get_row_data()
            dt = datetime.strptime(d, '%Y-%m-%d')
            rec = [code, d, dt.weekday() + 1]
            rec += [parse_row_float(o), parse_row_float(h)]
            rec += [parse_row_float(l), parse_row_float(c)]
            rec.append(round(parse_row_float(pct) / 100.0, 6))
            rows.append(tuple(rec))
        if rows:
            conn.executemany(insert_sql, rows)
            conn.commit()
            total += len(rows)
        time.sleep(delay)
    log_fn(f'  [指数] 新增 {total} 行')
    return total


def update_stock_daily(conn, bs, start, end, delay, max_stocks=0, log_fn=print, progress_fn=None):
    mt = dict(conn.execute('SELECT stock_code, market_type FROM stocks'))
    codes = [r[0] for r in conn.execute('SELECT DISTINCT stock_code FROM stock_daily')]
    if max_stocks:
        codes = codes[:max_stocks]
    done = set(r[0] for r in conn.execute(
        'SELECT DISTINCT stock_code FROM stock_daily WHERE trade_date > ?', (start,)))
    insert_sql = ('INSERT OR IGNORE INTO stock_daily '


                  '(stock_code, trade_date, open_price, high_price, low_price, '
                  'close_price, pre_close_price, change_ratio, volume, amount, '
                  'dretwd, dretnd, adj_close_wd, adj_close_nd, market_type, '
                  'trade_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    total_rows = 0
    failed = []
    skipped = 0
    for idx, code in enumerate(codes):
        if code in done:
            skipped += 1
            continue
        rs = bs.query_history_k_data_plus(
            stock_bs_code(code),


            'date,code,open,high,low,close,preclose,volume,amount,tradestatus,pctChg',
            start_date=start, end_date=end, frequency='d', adjustflag='3')
        if rs.error_code != '0':
            failed.append(code)
            if len(failed) >= 100 or len(failed) >= max(10, len(codes) // 3):
                log_fn(f'失败过多（{len(failed)} 只），中止剩余下载')
                break
            continue
        rows = []
        while rs.error_code == '0' and rs.next():
            dd, sc, o, h, l, c, pc, vol, amt, tstat, pct = rs.get_row_data()
            rec = [code, dd]
            rec += [parse_row_float(o), parse_row_float(h), parse_row_float(l)]
            rec += [parse_row_float(c), parse_row_float(pc)]


            rec += [round(parse_row_float(pct) / 100.0, 6)]
            rec += [int(parse_row_float(vol)), round(parse_row_float(amt), 2)]
            closep = parse_row_float(c)
            precl = parse_row_float(pc)
            ret = round(closep / precl - 1, 6) if precl > 0 else 0.0
            rec += [ret, ret, closep, closep]
            rec += [mt.get(code, derive_market_type(code)), int(parse_row_float(tstat))]
            rows.append(tuple(rec))
        if rows:
            conn.executemany(insert_sql, rows)
            conn.commit()
            total_rows += len(rows)
            done.add(code)
        time.sleep(delay)
        if progress_fn and (idx + 1) % 100 == 0:
            progress_fn(idx + 1, len(codes), total_rows, len(failed), skipped)
    return total_rows, skipped, failed


def refresh_stocks(conn, bs, log_fn=print):
    # 更新既有股票 last_trade_date
    conn.execute(
        'UPDATE stocks SET last_trade_date = '
        '(SELECT MAX(s2.trade_date) FROM stock_daily s2 WHERE s2.stock_code = stocks.stock_code)')
    conn.commit()
    new_codes = [r[0] for r in conn.execute(
        'SELECT DISTINCT s.stock_code FROM stock_daily s LEFT JOIN stocks t '
        'ON s.stock_code = t.stock_code WHERE t.stock_code IS NULL')]
    for code in new_codes:
        name = None
        rs = bs.query_stock_basic(code=stock_bs_code(code))
        if rs.error_code == '0' and rs.next():
            row = dict(zip(rs.fields, rs.get_row_data()))
            name = row.get('code_name')
        mtype = derive_market_type(code)
        mn = MARKET_NAME.get(mtype)
        fd = conn.execute('SELECT MIN(trade_date) FROM stock_daily WHERE stock_code=?', (code,)).fetchone()[0]
        ld = conn.execute('SELECT MAX(trade_date) FROM stock_daily WHERE stock_code=?', (code,)).fetchone()[0]
        conn.execute(
            'INSERT OR IGNORE INTO stocks (stock_code, market_type, market_name, name, '
            'first_trade_date, last_trade_date, status) VALUES (?,?,?,?,?,?,1)',
            (code, mtype, mn, name, fd, ld))
    conn.commit()
    log_fn(f'  [股票表] 新股补入 {len(new_codes)} 只')


def backfill_stock_names(conn, bs, log_fn=print):
    # 用 baostock query_stock_basic 一次补全 stocks 表名称（CSMAR 导入未填 name，影响按名称搜索）
    rs = bs.query_stock_basic()
    if rs.error_code != '0':
        log_fn('  [名称] query_stock_basic 失败: ' + rs.error_msg)
        return 0
    updates = []
    while rs.error_code == '0' and rs.next():
        row = dict(zip(rs.fields, rs.get_row_data()))
        code = row.get('code', '')
        name = row.get('code_name', '')
        if '.' in code and name:
            updates.append((name, code.split('.')[1]))
    conn.executemany('UPDATE stocks SET name=? WHERE stock_code=?', updates)
    conn.commit()
    log_fn(f'  [名称] 补全股票名称 {len(updates)} 只')
    return len(updates)


def run_sync(config, log_fn=print, progress_fn=None):
    # 防并发：已有运行中的同步则跳过
    if not acquire_lock():
        log_fn('另一同步正在进行，本次跳过')
        return {'skipped_lock': True}
    conn = None
    try:
        end = config.end or date.today().strftime('%Y-%m-%d')
        conn = open_db()
        start = compute_start(conn)
        log_fn(f'同步区间: {start} ~ {end}')
        import baostock as bs
        lg = bs.login()
        if lg.error_code != '0':
            log_fn(f'baostock 登录失败: {lg.error_code} {lg.error_msg}')
            return {'login_failed': True}
        # 无新交易日则快速退出（周末/节假日/数据未更新）
        rs = bs.query_trade_dates(start_date=start, end_date=end)
        new_days = 0
        if rs.error_code == '0':
            while rs.next():
                if rs.get_row_data()[1] == '1':
                    new_days += 1
        if new_days == 0:
            log_fn('无新交易日，无需同步')
            return {'no_new_days': True}
        # 数据探针：baostock 数据滞后于日历，探测一只代表股票确认真有新数据
        probe = bs.query_history_k_data_plus(
            'sz.000001', 'date,code', start_date=start, end_date=end,
            frequency='d', adjustflag='3')
        probe_rows = 0
        if probe.error_code == '0':
            while probe.next():
                probe_rows += 1
        if probe_rows == 0:
            log_fn('baostock 数据未更新（数据滞后），本次跳过')
            return {'no_new_days': True}


        try:
            rows, skipped, failed = update_stock_daily(
                conn, bs, start, end, config.delay, config.max_stocks,
                log_fn=log_fn, progress_fn=progress_fn)
            index_rows = 0
            if not config.no_indices:
                index_rows = update_index_daily(conn, bs, start, end, config.delay, log_fn)
            cal_days = update_trade_calendar(conn, bs, start, end, log_fn)
            refresh_stocks(conn, bs, log_fn)
            backfill_stock_names(conn, bs, log_fn)
            stats = {
                'last_sync': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'start': start, 'end': end,
                'rows': rows, 'skipped': skipped, 'failed': len(failed),
                'failed_list': failed, 'index_rows': index_rows, 'cal_days': cal_days,
            }
            write_meta(stats)
            log_fn(f'完成: 新增 {rows} 行, 跳过 {skipped} 只, 失败 {len(failed)} 只')
            if failed:
                log_fn('失败清单: ' + ', '.join(failed[:50]))
            return stats
        except Exception as e:
            log_fn(f'同步出错: {e}')
            return {'error': str(e)}
        finally:
            bs.logout()
    finally:
        release_lock()
        if conn:
            conn.close()


def write_meta(stats):
    try:
        os.makedirs(os.path.dirname(META_PATH), exist_ok=True)
        with open(META_PATH, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
    except OSError as e:
        print('写 sync_meta.json 失败:', e)
