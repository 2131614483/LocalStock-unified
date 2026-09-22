"""Import ETF K-line snapshots embedded in PA Agent 624 analysis records.

The importer is additive: an existing primary key in LocalStock is never
replaced.  It deliberately handles only mainland exchange ETF/fund codes and
the 1d / 1m data formats that can be mapped without loss to LocalStock tables.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ETF_PREFIXES = ("15", "16", "50", "51", "52", "56", "58")


def is_exchange_fund(code: str) -> bool:
    return len(code) == 6 and code.isdigit() and code.startswith(ETF_PREFIXES)


def trade_day(timestamp_ms: Any) -> str:
    return datetime.fromtimestamp(int(timestamp_ms) / 1000, UTC).date().isoformat()


def import_records(source: Path, database: Path) -> Counter[str]:
    counters: Counter[str] = Counter()
    daily_rows: dict[tuple[str, str], tuple[Any, ...]] = {}
    minute_rows: dict[tuple[str, int, str], tuple[Any, ...]] = {}

    for record_file in source.glob("*.json"):
        try:
            record = json.loads(record_file.read_text(encoding="utf-8"))
            meta = record.get("meta") or {}
            code = str(meta.get("symbol") or "")
            timeframe = str(meta.get("timeframe") or "")
            bars = record.get("kline_data") or []
        except (OSError, json.JSONDecodeError, TypeError):
            counters["invalid_records"] += 1
            continue
        if not is_exchange_fund(code):
            continue
        counters["fund_records"] += 1
        for bar in bars:
            try:
                timestamp = int(bar["ts_open"])
                values = (
                    float(bar["open"]), float(bar["high"]), float(bar["low"]),
                    float(bar["close"]), float(bar.get("volume") or 0),
                    float(bar.get("amount") or 0),
                )
            except (KeyError, TypeError, ValueError):
                counters["invalid_bars"] += 1
                continue
            if timeframe == "1d":
                key = (code, trade_day(timestamp))
                daily_rows.setdefault(key, (code, key[1], *values, "bfq"))
            elif timeframe == "1m":
                bar_time = datetime.fromtimestamp(timestamp / 1000, UTC).strftime("%Y-%m-%d %H:%M:%S")
                key = (code, 1, bar_time)
                minute_rows.setdefault(key, (code, 1, bar_time, *values))
            else:
                counters["unsupported_bars"] += 1

    connection = sqlite3.connect(database)
    try:
        for row in daily_rows.values():
            result = connection.execute(
                "INSERT OR IGNORE INTO fund_daily "
                "(fund_code, trade_date, open, high, low, close, volume, amount, fq_type) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", row,
            )
            counters["daily_inserted" if result.rowcount else "daily_existing"] += 1
        for row in minute_rows.values():
            result = connection.execute(
                "INSERT OR IGNORE INTO stock_minute_kline "
                "(stock_code, klt, bar_time, open, high, low, close, volume, amount) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", row,
            )
            counters["minute_inserted" if result.rowcount else "minute_existing"] += 1
        connection.commit()
    finally:
        connection.close()
    counters["daily_candidates"] = len(daily_rows)
    counters["minute_candidates"] = len(minute_rows)
    return counters


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="PA Agent 624 records/pending directory")
    parser.add_argument("--database", type=Path, required=True, help="LocalStock stock_data.db")
    args = parser.parse_args()
    if not args.source.is_dir():
        parser.error(f"source directory not found: {args.source}")
    if not args.database.is_file():
        parser.error(f"database not found: {args.database}")
    summary = import_records(args.source, args.database)
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
