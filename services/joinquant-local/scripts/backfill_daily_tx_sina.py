# -*- coding: utf-8 -*-
"""腾讯/新浪日线同步（baostock 服务故障时的替代数据源，也是数据同步 GUI 默认源）。

背景：baostock 服务端间歇性挂起/登录失败（2026-08-12 早），本地 stock_daily 停在 08-07。
本脚本用腾讯 fqkline(bfq 不复权) + 新浪 getKLineData 兜底，增量补全本地缺失交易日。

约定与存量一致：
  - volume = 股（腾讯 K线 vol_手 × 100）
  - amount = volume × close 估算（腾讯 K线无 amount）
  - change_ratio/dretwd/dretnd = close/pre_close - 1（pre_close 取前一交易日 close）
  - market_type 取自 stocks 表；trade_status = 1（有 K 线即成交）
  - 不复权原始价（bfq），与存量 CSMAR/baostock 一致
  - INSERT OR IGNORE，不清库，可断点续跑
  - 只补 stock_daily，不写 trade_calendar/index_daily（baostock 恢复后再补齐口径）

运行：Python311（urllib 即可，无需 baostock）
  C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/backfill_daily_tx_sina.py [--end YYYY-MM-DD]
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, 'data', 'stock_data.db')
META_PATH = os.path.join(BASE, 'data', 'sync_meta.json')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
MAX_WORKERS = 6


def get(url, hdrs=None, timeout=12):
    req = urllib.request.Request(url, headers={**UA, **(hdrs or {})})
    return urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8', 'replace')


def code_prefix(code):
    if code[:1] in ('6', '9'):
        return 'sh' + code
    if code.startswith(('8', '4', '920')):
        return 'bj' + code
    return 'sz' + code


def fetch_tencent(sym, start, end):
    """腾讯 bfq 不复权 K线 → {date: (open, close, high, low, vol_shares)}"""
    r = get('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=%s,day,%s,%s,120,bfq' % (sym, start, end))
    d = json.loads(r)
    data = (d.get('data') or {}).get(sym, {})
    kline = data.get('bfqday') or data.get('day') or []
    out = {}
    for row in kline:
        if len(row) < 6:
            continue
        day, o, c, h, l, vol = row[0], float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])
        out[day] = (o, c, h, l, int(vol * 100))
    return out


def fetch_sina(sym, end):
    """新浪 getKLineData → {date: (open, close, high, low, vol_shares)}"""
    r = get('https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData'
            '?symbol=%s&scale=240&ma=no&datalen=120' % sym, {'Referer': 'https://finance.sina.com.cn'})
    rows = json.loads(r)
    out = {}
    for x in rows:
        if not x.get('day') or x['day'] > end:
            continue
        out[x['day']] = (float(x['open']), float(x['close']), float(x['high']),
                         float(x['low']), int(float(x.get('volume') or 0)))
    return out


def build_rows(code, mtype, bars, cutoff):
    """bars: {date: (o,c,h,l,vol)} → 日期 > cutoff 的 stock_daily 行。pre_close 用前一交易日 close。"""
    rows = []
    prev_close = None
    for day in sorted(bars):
        o, c, h, l, vol = bars[day]
        if day > cutoff and prev_close is not None and prev_close > 0:
            ret = round(c / prev_close - 1, 6)
            amount = round(vol * c, 2)
            rows.append((code, day, o, h, l, c, prev_close, ret, vol, amount,
                         ret, ret, c, c, mtype, 1))
        prev_close = c  # 每根 K 线都更新，保证下一日 pre_close 取前一交易日 close
    return rows


def write_meta(stats):
    try:
        with open(META_PATH, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
    except OSError as e:
        print('写 sync_meta.json 失败:', e)


def run_backfill(end=None, delay=0.02, log_fn=print, progress_fn=None):
    """腾讯/新浪增量同步 stock_daily：补本地最新交易日之后的所有已发布交易日。

    返回 stats dict：{source, last_sync, local_max, end, rows, failed, failed_sample}。
    """
    if end is None:
        end = date.today().strftime('%Y-%m-%d')
    t0 = time.time()
    conn = sqlite3.connect(DB)
    conn.execute('PRAGMA journal_mode = WAL')
    local_max = conn.execute('SELECT MAX(trade_date) FROM stock_daily').fetchone()[0] or ''
    if local_max >= end:
        log_fn('本地数据已到 %s（end=%s），无需回填' % (local_max, end))
        conn.close()
        return {'source': 'txsina', 'rows': 0, 'no_new': True, 'local_max': local_max}
    stocks = dict(conn.execute('SELECT stock_code, market_type FROM stocks').fetchall())
    all_codes = sorted(r[0] for r in conn.execute('SELECT DISTINCT stock_code FROM stock_daily').fetchall())
    # 腾讯/新浪当前不提供北交所和 B 股的这组 K 线接口；这些属于已知覆盖边界，
    # 不应每天被计为网络失败并导致 Windows 计划任务显示失败。
    unsupported = tuple(c for c in all_codes if c.startswith(('4', '8', '920', '200', '900')))
    codes = [c for c in all_codes if c not in unsupported]
    rows_all = []
    failed = []
    n_total = len(codes)
    log_fn('腾讯/新浪回填: %d 只, 本地 %s → %s（已跳过不支持市场 %d 只）'
           % (n_total, local_max, end, len(unsupported)))

    def work(code):
        mtype = stocks.get(code)
        if mtype is None:
            mtype = 32 if code.startswith(('688', '689')) else (
                16 if code.startswith(('300', '301')) else (
                    1 if code.startswith(('6', '9')) else 4))
        sym = code_prefix(code)
        try:
            bars = fetch_tencent(sym, local_max, end)
            if not bars:
                raise ValueError('tencent empty')
            return code, build_rows(code, mtype, bars, local_max), None
        except Exception:  # noqa: BLE001
            try:
                bars = fetch_sina(sym, end)
                if bars:
                    return code, build_rows(code, mtype, bars, local_max), None
                raise ValueError('sina empty')
            except Exception as e2:  # noqa: BLE001
                return code, [], '%s' % e2

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(work, c): c for c in codes}
        done = 0
        for fut in as_completed(futs):
            code, rows, err = fut.result()
            done += 1
            if rows:
                rows_all.extend(rows)
            elif err:
                failed.append((code, err))
            if progress_fn:
                progress_fn(done, n_total, len(rows_all), len(failed), 0)
            elif done % 800 == 0:
                log_fn('  进度 %d/%d 已回填 %d 行 (%.0fs)' % (done, n_total, len(rows_all), time.time() - t0))

    if rows_all:
        conn.executemany(
            'INSERT OR IGNORE INTO stock_daily '
            '(stock_code, trade_date, open_price, high_price, low_price, close_price, pre_close_price, '
            'change_ratio, volume, amount, dretwd, dretnd, adj_close_wd, adj_close_nd, market_type, trade_status) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', rows_all)
        conn.commit()
    new_max = conn.execute('SELECT MAX(trade_date) FROM stock_daily').fetchone()[0]
    per_day = {}
    for d in conn.execute('SELECT trade_date, COUNT(*) FROM stock_daily WHERE trade_date>? GROUP BY trade_date', (local_max,)):
        per_day[d[0]] = d[1]
    conn.close()
    stats = {'source': 'txsina', 'last_sync': time.strftime('%Y-%m-%d %H:%M:%S'),
             'start': local_max, 'end': end, 'rows': len(rows_all),
             'failed': len(failed), 'failed_sample': failed[:10],
             'unsupported_skipped': len(unsupported), 'new_max': new_max, 'per_day': per_day}
    write_meta(stats)
    log_fn('完成: 新增 %d 行, 失败 %d 只, 最新 %s (%.0fs)'
           % (len(rows_all), len(failed), new_max, time.time() - t0))
    if failed:
        log_fn('失败样例: %s' % failed[:5])
    return stats


def main():
    import argparse
    ap = argparse.ArgumentParser(description='Tencent/Sina daily backfill')
    ap.add_argument('--end', help='end date YYYY-MM-DD (default today)')
    args = ap.parse_args()
    run_backfill(end=args.end)


if __name__ == '__main__':
    main()
