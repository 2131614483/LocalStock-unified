# -*- coding: utf-8 -*-
"""Incrementally synchronize and repair the existing LocalStock market DB.

This maintenance task uses Tencent's public K-line endpoint plus the local
symbol directory. Unlike the first-time full downloader it has no AkShare or
pandas dependency, so it can run from the desktop application's normal Python
environment. It checks SQLite, repairs recent missing/malformed K-lines and
refreshes the latest A-share, index and already-downloaded fund data.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from download_fund_history import fetch_history, init_database


KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?"
RECENT_TRADING_DAYS = 400
OVERLAP_DAYS = 10
INDEXES = (("sh000300", "000300"), ("sh000001", "000001"), ("sz399001", "399001"), ("sz399006", "399006"))


def emit(message: dict[str, Any]) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


def force_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def fetch_symbol_history(symbol: str, start: str, end: str, delay: float = 0.15) -> dict[str, tuple[float, float, float, float, float]] | None:
    """Fetch a bounded BFQ daily range, paging backwards when necessary."""
    history: dict[str, tuple[float, float, float, float, float]] = {}
    cursor = end
    for _ in range(12):
        request = Request(
            KLINE_URL + urlencode({"param": f"{symbol},day,{start},{cursor},2000,bfq"}),
            headers={"User-Agent": "LocalStock/1.0"},
        )
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed public quote endpoint
                payload = json.loads(response.read().decode("utf-8"))
            node = (payload.get("data") or {}).get(symbol)
            bars = node.get("day") if isinstance(node, dict) else None
            if bars is None:
                return None
        except Exception:
            return None
        if not bars:
            break
        oldest: str | None = None
        for bar in bars:
            try:
                day = str(bar[0])[:10]
                op, close, high, low = (float(bar[1]), float(bar[2]), float(bar[3]), float(bar[4]))
                volume = float(bar[5]) if len(bar) > 5 and bar[5] else 0.0
            except (IndexError, TypeError, ValueError):
                continue
            if min(op, close, high, low) <= 0 or high < low or high < max(op, close) or low > min(op, close):
                continue
            history[day] = (op, high, low, close, volume)
            oldest = day if oldest is None or day < oldest else oldest
        if oldest is None or len(bars) < 1900 or oldest <= start:
            break
        cursor = (datetime.strptime(oldest, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
        time.sleep(delay)
    return history


def symbol_of(code: str) -> str:
    return ("sh" if code.startswith(("5", "6", "9")) else "sz") + code


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS trade_calendar (
          trade_date TEXT PRIMARY KEY, is_trading_day INTEGER, year INTEGER, month INTEGER
        );
        CREATE TABLE IF NOT EXISTS sync_state (
          stock_code TEXT PRIMARY KEY, last_trade_date TEXT, status TEXT,
          failed_count INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
          key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS index_daily (
          index_code TEXT, trade_date TEXT, close_index REAL, return_index REAL,
          PRIMARY KEY (index_code, trade_date)
        );
    """)
    conn.commit()


def require_healthy_database(conn: sqlite3.Connection) -> None:
    result = conn.execute("PRAGMA quick_check").fetchone()
    if not result or result[0] != "ok":
        raise RuntimeError(f"SQLite 完整性校验失败：{result[0] if result else '无返回'}；请从备份恢复数据库后再同步。")


def refresh_calendar_and_indexes(conn: sqlite3.Connection) -> int:
    start = (date.today() - timedelta(days=800)).isoformat()
    benchmark = fetch_symbol_history("sh000001", start, date.today().isoformat())
    if not benchmark:
        raise RuntimeError("无法获取上证指数，交易日历无法更新")
    conn.executemany(
        "INSERT OR REPLACE INTO trade_calendar (trade_date,is_trading_day,year,month) VALUES (?,?,?,?)",
        [(day, 1, int(day[:4]), int(day[5:7])) for day in benchmark],
    )
    updated = 0
    for symbol, code in INDEXES:
        history = benchmark if symbol == "sh000001" else fetch_symbol_history(symbol, start, date.today().isoformat())
        if not history:
            emit({"type": "log", "message": f"指数 {code} 更新失败，保留本地旧数据"})
            continue
        previous: float | None = None
        rows = []
        for day, (_op, _high, _low, close, _volume) in sorted(history.items()):
            ret = close / previous - 1 if previous else 0.0
            rows.append((code, day, close, ret))
            previous = close
        conn.executemany("INSERT OR REPLACE INTO index_daily (index_code,trade_date,close_index,return_index) VALUES (?,?,?,?)", rows)
        updated += len(rows)
        time.sleep(0.15)
    conn.commit()
    return updated


def recent_trade_dates(conn: sqlite3.Connection) -> list[str]:
    return [row[0] for row in conn.execute(
        "SELECT trade_date FROM trade_calendar WHERE is_trading_day=1 ORDER BY trade_date DESC LIMIT ?",
        (RECENT_TRADING_DAYS,),
    )][::-1]


def repair_start_date(conn: sqlite3.Connection, code: str, window_start: str, window_end: str) -> str:
    last = conn.execute("SELECT MAX(trade_date) FROM stock_daily WHERE stock_code=?", (code,)).fetchone()[0]
    missing = conn.execute("""
        SELECT MIN(c.trade_date) FROM trade_calendar c
        LEFT JOIN stock_daily d ON d.stock_code=? AND d.trade_date=c.trade_date
        WHERE c.is_trading_day=1 AND c.trade_date BETWEEN ? AND ? AND d.trade_date IS NULL
    """, (code, window_start, window_end)).fetchone()[0]
    invalid = conn.execute("""
        SELECT MIN(trade_date) FROM stock_daily WHERE stock_code=? AND trade_date BETWEEN ? AND ?
          AND (open_price<=0 OR high_price<=0 OR low_price<=0 OR close_price<=0
               OR high_price<low_price OR high_price<open_price OR high_price<close_price
               OR low_price>open_price OR low_price>close_price)
    """, (code, window_start, window_end)).fetchone()[0]
    candidates = [item for item in (missing, invalid) if item]
    candidates.append(
        (datetime.strptime(last, "%Y-%m-%d").date() - timedelta(days=OVERLAP_DAYS)).isoformat()
        if last else window_start
    )
    return min(candidates)


def sync_stocks(conn: sqlite3.Connection, window_start: str, window_end: str) -> tuple[int, list[str], int]:
    stocks = conn.execute("SELECT stock_code FROM stocks WHERE status=1 ORDER BY stock_code").fetchall()
    if not stocks:
        raise RuntimeError("本地股票目录为空，请先使用“全量补齐”建立行情库")
    insert = """
      INSERT OR REPLACE INTO stock_daily
      (stock_code,trade_date,open_price,high_price,low_price,close_price,pre_close_price,
       change_ratio,volume,amount,dretwd,dretnd,adj_close_wd,adj_close_nd,market_type,trade_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """
    updated = 0
    failed: list[str] = []
    for index, (code,) in enumerate(stocks, start=1):
        start = repair_start_date(conn, code, window_start, window_end)
        history = fetch_symbol_history(symbol_of(code), start, date.today().isoformat())
        if history is None:
            failed.append(code)
            conn.execute("""
              INSERT INTO sync_state (stock_code,status,failed_count,updated_at) VALUES (?, 'failed', 1, datetime('now','localtime'))
              ON CONFLICT(stock_code) DO UPDATE SET status='failed',failed_count=sync_state.failed_count+1,updated_at=excluded.updated_at
            """, (code,))
            conn.commit()
            continue
        previous = conn.execute(
            "SELECT close_price FROM stock_daily WHERE stock_code=? AND trade_date<? ORDER BY trade_date DESC LIMIT 1",
            (code, start),
        ).fetchone()
        pre_close = float(previous[0]) if previous else 0.0
        rows = []
        for day, (op, high, low, close, volume) in sorted(history.items()):
            ret = round(close / pre_close - 1, 6) if pre_close > 0 else 0.0
            market_type = 32 if code.startswith("688") else 16 if code.startswith("300") else 1 if code.startswith("6") else 4
            rows.append((code, day, op, high, low, close, pre_close, ret, int(volume), 0.0, ret, ret, close, close, market_type, 1))
            pre_close = close
        conn.executemany(insert, rows)
        last = max(history, default=None)
        conn.execute("""
          INSERT INTO sync_state (stock_code,last_trade_date,status,failed_count,updated_at)
          VALUES (?, ?, 'ok', 0, datetime('now','localtime'))
          ON CONFLICT(stock_code) DO UPDATE SET last_trade_date=excluded.last_trade_date,status='ok',failed_count=0,updated_at=excluded.updated_at
        """, (code, last))
        conn.commit()
        updated += len(rows)
        if index % 10 == 0 or index == len(stocks):
            emit({"type": "progress", "done": index, "total": len(stocks), "rows": updated, "failed": len(failed), "skipped": 0})
        time.sleep(0.15)
    return updated, failed, len(stocks)


def sync_funds(conn: sqlite3.Connection) -> tuple[int, list[str]]:
    try:
        codes = [row[0] for row in conn.execute("SELECT DISTINCT fund_code FROM fund_daily ORDER BY fund_code")]
    except sqlite3.OperationalError:
        return 0, []
    if not codes:
        return 0, []
    init_database(conn)
    insert = "INSERT OR REPLACE INTO fund_daily (fund_code,trade_date,open,high,low,close,volume,amount,fq_type) VALUES (?,?,?,?,?,?,?,?, 'bfq')"
    updated, failed = 0, []
    for index, code in enumerate(codes, start=1):
        last = conn.execute("SELECT MAX(trade_date) FROM fund_daily WHERE fund_code=?", (code,)).fetchone()[0]
        start = (datetime.strptime(last, "%Y-%m-%d").date() - timedelta(days=OVERLAP_DAYS)).isoformat() if last else "1990-01-01"
        history = fetch_history(code, start, date.today().isoformat(), 0.2)
        if history is None:
            failed.append(code)
            continue
        conn.executemany(insert, [(code, day, *values) for day, values in sorted(history.items())])
        conn.commit()
        updated += len(history)
        if index % 10 == 0 or index == len(codes):
            emit({"type": "log", "message": f"基金增量同步：{index}/{len(codes)}，更新 {updated} 行，失败 {len(failed)}"})
        time.sleep(0.2)
    return updated, failed


def main() -> None:
    force_utf8_stdio()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--no-funds", action="store_true")
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error(f"数据库不存在：{args.db}")
    began = time.time()
    conn = sqlite3.connect(args.db, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        ensure_tables(conn)
        emit({"type": "log", "message": "正在校验 SQLite 完整性并更新交易日历、指数…"})
        require_healthy_database(conn)
        index_rows = refresh_calendar_and_indexes(conn)
        dates = recent_trade_dates(conn)
        if not dates:
            raise RuntimeError("交易日历为空，无法执行增量校验")
        emit({"type": "log", "message": f"开始校验并更新本地 A 股近 {len(dates)} 个交易日…"})
        stock_rows, stock_failed, stock_count = sync_stocks(conn, dates[0], dates[-1])
        fund_rows, fund_failed = (0, []) if args.no_funds else sync_funds(conn)
        now = datetime.now().isoformat(timespec="seconds")
        conn.execute("INSERT OR REPLACE INTO sync_meta (key,value,updated_at) VALUES ('last_incremental_sync',?,?)", (now, now))
        conn.execute("INSERT OR REPLACE INTO sync_meta (key,value,updated_at) VALUES ('last_integrity_check',?,?)", (now, now))
        conn.commit()
        failures = stock_failed + fund_failed
        emit({"type": "done", "stocks": stock_count, "rows": stock_rows + fund_rows, "skipped": 0, "failed": failures, "elapsed_sec": int(time.time() - began)})
        emit({"type": "log", "message": f"同步完成：指数 {index_rows} 行；失败 {len(failures)} 项。"})
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
