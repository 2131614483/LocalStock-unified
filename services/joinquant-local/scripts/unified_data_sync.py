# -*- coding: utf-8 -*-
"""LocalStock / 量化服务统一数据同步入口。

计划任务只调用本文件：
1. 腾讯/新浪增量补全股票日线；
2. 从已落库的日线补齐交易日历并刷新股票日期；
3. 输出 AI、回测和桌面端共同使用的数据状态。
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.request
from datetime import datetime

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'data', 'stock_data.db')
META_PATH = os.path.join(BASE_DIR, 'data', 'sync_meta.json')
LOG_PATH = os.path.join(BASE_DIR, 'data', 'sync.log')
FACTOR_REGISTRY = os.path.join(BASE_DIR, 'scripts', 'factor_registry.json')
# 已更换代码、在线行情不再返回的历史证券简称（交易所历史资料核验）。
HISTORICAL_NAME_FALLBACKS = {
    '200022': '深赤湾B',
    '601313': '江南嘉捷',
}


def _tencent_symbol(code):
    if code.startswith(('4', '8', '920')):
        return 'bj' + code
    return ('sh' if code.startswith(('6', '9')) else 'sz') + code


def refresh_missing_stock_names():
    """用腾讯批量行情补齐证券名称，重点覆盖 baostock 不提供名称的北交所股票。"""
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.execute('PRAGMA busy_timeout=60000')
    try:
        codes = [row[0] for row in conn.execute(
            "SELECT stock_code FROM stocks WHERE name IS NULL OR trim(name) = '' ORDER BY stock_code"
        )]
        updated = 0
        failed = 0
        for start in range(0, len(codes), 50):
            batch = codes[start:start + 50]
            url = 'https://qt.gtimg.cn/q=' + ','.join(_tencent_symbol(code) for code in batch)
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(request, timeout=20) as response:
                    text = response.read().decode('gbk', errors='replace')
                rows = []
                for _symbol, payload in re.findall(r'v_([a-z]+\d+)="([^"]*)"', text):
                    fields = payload.split('~')
                    if len(fields) > 2 and fields[1].strip() and fields[2].strip():
                        rows.append((fields[1].strip(), fields[2].strip()))
                conn.executemany(
                    "UPDATE stocks SET name=? WHERE stock_code=? AND (name IS NULL OR trim(name)='')",
                    rows,
                )
                updated += len(rows)
                conn.commit()
            except Exception as exc:  # 单批网络失败不阻断其余批次
                failed += len(batch)
                log('证券名称批次补全失败：%s' % exc)
        before = conn.total_changes
        conn.executemany(
            "UPDATE stocks SET name=? WHERE stock_code=? AND (name IS NULL OR trim(name)='')",
            [(name, code) for code, name in HISTORICAL_NAME_FALLBACKS.items()],
        )
        updated += conn.total_changes - before
        conn.commit()
        remaining = conn.execute(
            "SELECT COUNT(*) FROM stocks WHERE name IS NULL OR trim(name) = ''"
        ).fetchone()[0]
        result = {'requested': len(codes), 'updated': updated, 'failed': failed, 'remaining': remaining}
        log('证券名称补全：待补 %s，成功 %s，剩余 %s' % (len(codes), updated, remaining))
        return result
    finally:
        conn.close()


def log(message):
    line = '[%s] [统一同步] %s' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), message)
    print(line, flush=True)
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


def _range(conn, table):
    row = conn.execute('SELECT MIN(trade_date), MAX(trade_date), COUNT(*) FROM ' + table).fetchone()
    return {'from': row[0], 'to': row[1], 'rows': row[2]}


def finalize_database(sync_result=None):
    """把主行情日期传播给日历和证券资料，再形成统一状态。"""
    conn = sqlite3.connect(DB_PATH, timeout=60)
    try:
        conn.execute('PRAGMA busy_timeout=60000')
        before = conn.total_changes
        conn.execute(
            'INSERT OR IGNORE INTO trade_calendar (trade_date, is_trading_day, year, month) '
            'SELECT DISTINCT trade_date, 1, CAST(substr(trade_date,1,4) AS INTEGER), '
            'CAST(substr(trade_date,6,2) AS INTEGER) FROM stock_daily WHERE trade_date IS NOT NULL'
        )
        calendar_added = conn.total_changes - before
        conn.execute(
            'UPDATE stocks SET last_trade_date = (SELECT MAX(d.trade_date) FROM stock_daily d '
            'WHERE d.stock_code = stocks.stock_code) WHERE EXISTS '
            '(SELECT 1 FROM stock_daily d WHERE d.stock_code = stocks.stock_code)'
        )
        conn.commit()
        factor_count = 0
        try:
            with open(FACTOR_REGISTRY, encoding='utf-8') as f:
                factors = json.load(f)
            factor_count = len(factors if isinstance(factors, list) else factors.get('factors', []))
        except (OSError, ValueError, AttributeError):
            pass
        status = {
            'checked_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'database': DB_PATH,
            'stock_daily': _range(conn, 'stock_daily'),
            'index_daily': _range(conn, 'index_daily'),
            'trade_calendar': _range(conn, 'trade_calendar'),
            'stocks': conn.execute('SELECT COUNT(*) FROM stocks').fetchone()[0],
            'factors': factor_count,
            'calendar_added': calendar_added,
        }
        meta = {}
        try:
            with open(META_PATH, encoding='utf-8') as f:
                meta = json.load(f)
        except (OSError, ValueError):
            pass
        if sync_result is not None:
            meta['market_sync'] = sync_result
        meta['unified_status'] = status
        meta['last_sync'] = status['checked_at']
        with open(META_PATH, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        return status
    finally:
        conn.close()


def run(status_only=False, names_only=False):
    result = None
    if not status_only and not names_only:
        import backfill_daily_tx_sina as backfill
        log('开始同步股票日线（腾讯/新浪）')
        result = backfill.run_backfill(log_fn=log)
    name_result = None
    if not status_only:
        name_result = refresh_missing_stock_names()
    status = finalize_database(result)
    status['stock_names'] = name_result
    stock_to = status['stock_daily']['to']
    calendar_to = status['trade_calendar']['to']
    if stock_to != calendar_to:
        log('校验失败：行情日期 %s 与交易日历 %s 不一致' % (stock_to, calendar_to))
        return 2
    log('完成：行情/日历至 %s，指数至 %s，股票 %s 只，因子 %s 个'
        % (stock_to, status['index_daily']['to'], status['stocks'], status['factors']))
    if result and result.get('error'):
        return 1
    # 排除已知不支持市场后，少量网络失败留给次日断点续传，不把整项计划标红。
    if result and result.get('failed', 0) > 100:
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description='LocalStock unified data sync')
    parser.add_argument('--status-only', action='store_true', help='只补齐元数据并检查，不访问网络')
    parser.add_argument('--names-only', action='store_true', help='只补齐缺失的股票名称并检查')
    args = parser.parse_args()
    return run(args.status_only, args.names_only)


if __name__ == '__main__':
    sys.exit(main())
