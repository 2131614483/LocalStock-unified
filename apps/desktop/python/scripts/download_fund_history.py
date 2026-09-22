# -*- coding: utf-8 -*-
"""Download complete exchange-traded fund daily history into LocalStock.

Uses Tencent's public BFQ K-line endpoint and only Python's standard library.
The job is additive and resumable through ``fund_sync_state``: completed codes
are skipped on later runs, while failures remain retryable.
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


KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?"


def emit(message: dict[str, Any]) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


def quote_symbol(code: str) -> str:
    return ("sh" if code.startswith(("5", "6", "9")) else "sz") + code


def fetch_page(code: str, start: str, end: str) -> list[list[str]] | None:
    symbol = quote_symbol(code)
    params = {"param": f"{symbol},day,{start},{end},2000,bfq"}
    request = Request(KLINE_URL + urlencode(params), headers={"User-Agent": "LocalStock/1.0"})
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed public quote endpoint
            payload = json.loads(response.read().decode("utf-8"))
        node = (payload.get("data") or {}).get(symbol)
        if not isinstance(node, dict):
            return None
        return node.get("day") or []
    except Exception:
        return None


def fetch_history(code: str, start: str, end: str, delay: float) -> dict[str, tuple[float, ...]] | None:
    history: dict[str, tuple[float, ...]] = {}
    cursor = end
    for _ in range(12):
        bars = fetch_page(code, start, cursor)
        if bars is None:
            return None
        if not bars:
            break
        oldest = None
        for bar in bars:
            try:
                day = str(bar[0])[:10]
                op, close, high, low = (float(bar[1]), float(bar[2]), float(bar[3]), float(bar[4]))
                volume = float(bar[5]) if len(bar) > 5 and bar[5] else 0.0
            except (IndexError, TypeError, ValueError):
                continue
            if close <= 0 or high <= 0 or low <= 0 or high < low:
                continue
            history[day] = (op, high, low, close, volume, 0.0)
            oldest = day if oldest is None or day < oldest else oldest
        if oldest is None or len(bars) < 1900 or oldest <= start:
            break
        cursor = (datetime.strptime(oldest, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
        time.sleep(delay)
    return history


def init_database(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TABLE IF NOT EXISTS fund_daily ("
        "fund_code TEXT NOT NULL, trade_date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, "
        "volume REAL, amount REAL, fq_type TEXT DEFAULT 'bfq', PRIMARY KEY (fund_code, trade_date)) WITHOUT ROWID"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS fund_sync_state ("
        "fund_code TEXT PRIMARY KEY, status TEXT NOT NULL, last_trade_date TEXT, rows INTEGER NOT NULL DEFAULT 0, "
        "updated_at TEXT NOT NULL)"
    )
    connection.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--start", default="1990-01-01")
    parser.add_argument("--delay", default=1.5, type=float, help="minimum delay between history pages")
    parser.add_argument("--limit", default=0, type=int, help="only process N funds; useful for diagnosis")
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error(f"database not found: {args.db}")

    connection = sqlite3.connect(args.db, timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    init_database(connection)
    try:
        codes = [row[0] for row in connection.execute("SELECT fund_code FROM fund_info ORDER BY fund_code")]
    except sqlite3.OperationalError:
        parser.error("fund_info is missing; run tools/sync-fund-names.py first")
    if args.limit:
        codes = codes[:args.limit]
    completed = {row[0] for row in connection.execute("SELECT fund_code FROM fund_sync_state WHERE status='complete'")}
    pending = [code for code in codes if code not in completed]
    total = len(codes)
    skipped = total - len(pending)
    inserted = 0
    failed: list[str] = []
    began = time.time()
    emit({"type": "log", "message": f"基金历史：共 {total} 只，已完成 {skipped} 只，待下载 {len(pending)} 只"})

    insert = (
        "INSERT OR IGNORE INTO fund_daily (fund_code, trade_date, open, high, low, close, volume, amount, fq_type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'bfq')"
    )
    for index, code in enumerate(pending, start=1):
        history = fetch_history(code, args.start, date.today().isoformat(), max(args.delay, 0.2))
        if history is None:
            failed.append(code)
            connection.execute(
                "INSERT INTO fund_sync_state (fund_code,status,updated_at) VALUES (?, 'failed', ?) "
                "ON CONFLICT(fund_code) DO UPDATE SET status='failed', updated_at=excluded.updated_at",
                (code, datetime.now().isoformat()),
            )
        else:
            rows = [(code, day, *values) for day, values in sorted(history.items())]
            changes_before = connection.total_changes
            connection.executemany(insert, rows)
            connection.execute(
                "INSERT INTO fund_sync_state (fund_code,status,last_trade_date,rows,updated_at) VALUES (?, 'complete', ?, ?, ?) "
                "ON CONFLICT(fund_code) DO UPDATE SET status='complete', last_trade_date=excluded.last_trade_date, "
                "rows=excluded.rows, updated_at=excluded.updated_at",
                (code, max(history, default=None), len(history), datetime.now().isoformat()),
            )
            inserted += connection.total_changes - changes_before
        connection.commit()
        done = skipped + index
        emit({"type": "progress", "done": done, "total": total, "rows": inserted, "failed": len(failed), "skipped": skipped})
        time.sleep(max(args.delay, 0.2))

    emit({"type": "done", "stocks": total, "rows": inserted, "skipped": skipped, "failed": failed, "elapsed_sec": int(time.time() - began)})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        emit({"type": "error", "message": "下载已取消；下次会从已完成基金继续。"})
        sys.exit(130)
