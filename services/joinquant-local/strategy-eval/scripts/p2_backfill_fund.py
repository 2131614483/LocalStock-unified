# -*- coding: utf-8 -*-
"""
P2 ETF/基金日线回填：腾讯 fqkline bfq → fund_daily
范围：策略文件中引用的 212 只场内基金候选代码
关键经验（P1 三次试错固化）：
- 腾讯 WAF 单线程 2s 间隔才安全 → WORKERS=1, REQ_DELAY=2.0
- ETF 的 qfq 只返回最近 640 根，bfq 才有完整历史 → 用 bfq
- fail_fetch 不写 done，断点续传自动重试
- bfq 口径：ETF 分红日有跳空（多数 <2%/年），报告中声明；信号计算建议用 close 相对变化
"""
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

DB = r'D:\pythonpro\聚宽-local\data\stock_data.db'
BASE = r'D:\pythonpro\聚宽-local\strategy-eval'
LOGF = os.path.join(BASE, 'logs', 'p2_fund_backfill.log')
DONE_FILE = os.path.join(BASE, 'logs', 'p2_fund_done.json')
CODE_FILE = os.path.join(BASE, 'logs', 'fund_codes.txt')
REQ_DELAY = 2.0
SKIP_KW = ('150', '155', '501', '502', '505', '506')  # 分级基金/已转型，跳过

def log(msg):
    line = f"[{datetime.now().strftime('%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOGF, 'a', encoding='utf-8') as f:
        f.write(line + '\n')

def fmt(code6):
    """6位代码 → 腾讯前缀（沪基金多为 51/56/58，深为 15/16）"""
    if code6.startswith(('51', '52', '50', '53', '56', '57', '58', '588', '560')):
        return 'sh' + code6
    elif code6.startswith(('15', '16')):
        return 'sz' + code6
    elif code6.startswith(('51',)):
        return 'sh' + code6
    return 'sz' + code6  # 兜底，实际不会到

def fetch_chunk(code6, start, end, n=2000, retries=3):
    tx = fmt(code6)
    url = (f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
           f'?param={tx},day,{start},{end},{n},bfq')
    for attempt in range(retries):
        try:
            out = subprocess.run(['curl', '-s', '--max-time', '25', url,
                                  '-H', 'User-Agent: Mozilla/5.0'],
                                 capture_output=True, timeout=30)
            raw = out.stdout.decode('utf-8', errors='replace') if isinstance(out.stdout, bytes) else ''
            d = json.loads(raw)
            node = d['data'].get(tx)
            if node is None or isinstance(node, list):
                return {}
            bars = node.get('day') or []
            result = {}
            for b in bars:
                try:
                    o, c, h, l = float(b[1]), float(b[2]), float(b[3]), float(b[4])
                except (ValueError, IndexError):
                    continue
                if c <= 0 or h <= 0 or l <= 0 or h < l:
                    continue
                vol = float(b[5]) if len(b) > 5 and b[5] else 0.0
                result[b[0]] = (o, c, h, l, vol)
            return result
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(2 * (attempt + 1))
    return {}

def walk_history(code6, start, end):
    all_bars = {}
    cur_end = end
    for _ in range(8):
        chunk = fetch_chunk(code6, start, cur_end)
        if not chunk:
            break
        all_bars.update(chunk)
        first = min(chunk)
        if len(chunk) < 1900 or first <= start:
            break
        cur_end = first
        time.sleep(REQ_DELAY)
    return all_bars

def main():
    t0 = time.time()
    if not os.path.exists(CODE_FILE):
        log('missing fund_codes.txt — abort')
        return
    with open(CODE_FILE, encoding='utf-8') as f:
        codes = [l.strip() for l in f if l.strip()]
    codes = [c for c in codes if not c.startswith(SKIP_KW) and not c.startswith(('155', ))]
    log(f'P2 start: {len(codes)} fund codes')

    done_set = set()
    if os.path.exists(DONE_FILE):
        with open(DONE_FILE, encoding='utf-8') as f:
            done_set = set(json.load(f))
        log(f'resume: {len(done_set)} done')

    conn = sqlite3.connect(DB)
    conn.execute('PRAGMA journal_mode=WAL')
    ok = fail = skip = 0
    for idx, code6 in enumerate(codes, 1):
        if code6 in done_set:
            continue
        try:
            txbars = walk_history(code6, '2012-01-01', '2026-08-25')
            if not txbars:
                log(f'  {code6}: NO DATA (delisted/男traded), skip')
                fail += 1
                done_set.add(code6)  # 没数据的不重试
                continue
            before = conn.execute('SELECT COUNT(*) FROM fund_daily WHERE fund_code=?', (code6,)).fetchone()[0]
            rows = [(code6, d, b[0], b[1], b[2], b[3], b[4], 0.0, 'bfq')
                    for d, b in sorted(txbars.items())]
            conn.executemany('INSERT OR IGNORE INTO fund_daily '
                             '(fund_code, trade_date, open, high, low, close, volume, amount, fq_type) '
                             'VALUES (?,?,?,?,?,?,?,?,?)', rows)
            conn.commit()
            after = conn.execute('SELECT COUNT(*) FROM fund_daily WHERE fund_code=?', (code6,)).fetchone()[0]
            added = after - before
            ok += 1
            log(f'  {code6}: {added} rows ({len(rows)} fetched)')
        except Exception as e:
            log(f'  {code6}: ERROR {str(e)[:80]}')
            fail += 1
        finally:
            if idx % 50 == 0:
                with open(DONE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(sorted(done_set), f)
            time.sleep(REQ_DELAY)
    with open(DONE_FILE, 'w', encoding='utf-8') as f:
        json.dump(sorted(done_set), f)
    conn.close()
    log(f'DONE in {time.time()-t0:.0f}s: ok={ok} fail={fail}')

if __name__ == '__main__':
    main()