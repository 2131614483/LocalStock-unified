# -*- coding: utf-8 -*-
"""
P1 高低价回填：腾讯 fqkline bfq → stock_daily.high_price/low_price（只填 NULL）
范围：2015-01-01 起 high 为 NULL 的 ~5879 只股票
要点：
- 腾讯列序 [date, open, close, high, low, volume手]，volume×100=股（已验证）
- 价格 bfq 与库内 CSMAR 原始价一致（已验证 000001 三日全匹配）
- 只 UPDATE high/low 为 NULL 的行；价格交叉核对（|tx_close - db_close| > 0.011 则跳过该行并记日志）
- 断点续传：done 集合存 logs/p1_hl_done.json；每 200 只提交一次
- 后台可杀：任何时刻中断重跑自动跳过已完成股票
"""
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

DB = r'D:\pythonpro\聚宽-local\data\stock_data.db'
BASE = r'D:\pythonpro\聚宽-local\strategy-eval'
LOG = os.path.join(BASE, 'logs', 'p1_hl_backfill.log')
DONE_FILE = os.path.join(BASE, 'logs', 'p1_hl_done.json')
START_DATE = '2015-01-01'
WORKERS = 1
REQ_DELAY = 2.0   # 实测：6并发8分钟被封、2并发90秒再被封；腾讯WAF阈值≈千级请求/窗口，单线程2s间隔（~0.35 req/s）安全

_log_lock = threading.Lock()

def log(msg):
    line = f"[{datetime.now().strftime('%m-%d %H:%M:%S')}] {msg}"
    with _log_lock:
        print(line, flush=True)
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')

def tx_code(code6):
    return ('sh' if code6[0] in '69' else ('bj' if code6[0] in '489' and False else 'sz')) + code6

def fetch_chunk(code6, start, end, n=2000, retries=3):
    """返回 {date: (o,c,h,l)} 或 None"""
    prefix = 'sh' if code6[0] in ('6', '9') else 'sz'
    url = (f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
           f'?param={prefix}{code6},day,{start},{end},{n},bfq')
    for attempt in range(retries):
        try:
            out = subprocess.run(['curl', '-s', '--max-time', '30', url,
                                  '-H', 'User-Agent: Mozilla/5.0'],
                                 capture_output=True, timeout=35)
            raw = out.stdout.decode('utf-8', errors='replace') if isinstance(out.stdout, bytes) else ''
            d = json.loads(raw)
            node = d['data'].get(f'{prefix}{code6}')
            if node is None or isinstance(node, list):
                return None
            bars = node.get('bfqday') or node.get('day') or []
            result = {}
            for b in bars:
                try:
                    o, c, h, l = float(b[1]), float(b[2]), float(b[3]), float(b[4])
                except (ValueError, IndexError):
                    continue
                if h <= 0 or l <= 0 or h < l:
                    continue
                result[b[0]] = (o, c, h, l)
            return result
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(2 * (attempt + 1))
    return None

def walk_history(code6, start, end):
    all_bars = {}
    cur_end = end
    for _ in range(5):  # 2015→2026 约 2830 交易日，2 块足够；留余量
        chunk = fetch_chunk(code6, start, cur_end)
        if not chunk:
            break
        all_bars.update(chunk)
        first = min(chunk)
        if len(chunk) < 1900 or first <= start:
            break
        cur_end = first
        time.sleep(0.4)
    return all_bars

def process_stock(conn, code6, done_set):
    if code6 in done_set:
        return 'skip'
    # 库内待补行：日期 -> close
    rows = conn.execute(
        "SELECT trade_date, close_price FROM stock_daily "
        "WHERE stock_code=? AND trade_date>=? AND high_price IS NULL",
        (code6, START_DATE)).fetchall()
    if not rows:
        done_set.add(code6)
        return 'empty'
    need = {d: c for d, c in rows}
    tx = walk_history(code6, START_DATE, '2026-08-25')
    if not tx:
        return 'fail_fetch'
    updates = []
    mismatch = 0
    for d, db_close in need.items():
        bar = tx.get(d)
        if not bar:
            continue  # 当日腾讯无数据（停牌等），保持 NULL
        _, c, h, l = bar
        if db_close and abs(c - db_close) > 0.011 + db_close * 0.001:
            mismatch += 1
            continue  # 口径不符，宁缺毋滥
        updates.append((h, l, code6, d))
    if updates:
        conn.executemany(
            "UPDATE stock_daily SET high_price=?, low_price=? "
            "WHERE stock_code=? AND trade_date=? AND high_price IS NULL",
            updates)
        conn.commit()
    done_set.add(code6)
    return f'{len(updates)} upd, {mismatch} mismatch'

def worker(stock_queue, conn_path, done_set, stats, stats_lock):
    conn = sqlite3.connect(conn_path)
    conn.execute('PRAGMA journal_mode=WAL')
    while True:
        try:
            code6 = stock_queue.get_nowait()
        except Exception:
            break
        try:
            r = process_stock(conn, code6, done_set)
            with stats_lock:
                stats['n'] += 1
                if stats['n'] % 100 == 0:
                    with open(DONE_FILE, 'w', encoding='utf-8') as f:
                        json.dump(sorted(done_set), f)
                    log(f"progress: {stats['n']}/{stats['total']} stocks done")
            if r not in ('skip', 'empty'):
                log(f"  {code6}: {r}")
        except Exception as e:
            log(f"  {code6}: ERROR {str(e)[:80]}")
        finally:
            time.sleep(REQ_DELAY)
    conn.close()

def main():
    t0 = time.time()
    conn = sqlite3.connect(DB)
    stocks = [r[0] for r in conn.execute(
        "SELECT DISTINCT stock_code FROM stock_daily "
        "WHERE trade_date>=? AND high_price IS NULL ORDER BY stock_code",
        (START_DATE,)).fetchall()]
    conn.close()
    log(f"P1 high/low backfill start: {len(stocks)} stocks")
    done_set = set()
    if os.path.exists(DONE_FILE):
        with open(DONE_FILE, encoding='utf-8') as f:
            done_set = set(json.load(f))
        log(f"resume: {len(done_set)} already done")
    todo = [s for s in stocks if s not in done_set]
    from queue import Queue
    q = Queue()
    for s in todo:
        q.put(s)
    stats = {'n': 0, 'total': len(todo)}
    lock = threading.Lock()
    threads = []
    for i in range(WORKERS):
        t = threading.Thread(target=worker, args=(q, DB, done_set, stats, lock), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
    with open(DONE_FILE, 'w', encoding='utf-8') as f:
        json.dump(sorted(done_set), f)
    # 终检
    conn = sqlite3.connect(DB)
    remain = conn.execute(
        "SELECT COUNT(*) FROM stock_daily WHERE trade_date>=? AND high_price IS NULL",
        (START_DATE,)).fetchone()[0]
    filled = conn.execute(
        "SELECT COUNT(*) FROM stock_daily WHERE trade_date>=? AND high_price IS NOT NULL AND trade_date>='2026-06-14'",
        (START_DATE,)).fetchone()[0]
    conn.close()
    log(f"DONE in {time.time()-t0:.0f}s. remaining NULL high since 2015: {remain}")

if __name__ == '__main__':
    main()
