"""Fetch ETF/fund display names once and store them in LocalStock's local DB.

Price data remains wholly local.  This utility only refreshes the small fund
metadata table; the desktop UI then reads names from that local table offline.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
from datetime import UTC, datetime
from itertools import islice
from pathlib import Path
from urllib.request import Request, urlopen


QUOTE_URL = "https://qt.gtimg.cn/q="
QUOTE_RE = re.compile(r'v_(?:sh|sz)(\d{6})="([^"]*)";')


def market_prefix(code: str) -> str:
    return "sh" if code.startswith(("5", "6", "9")) else "sz"


def chunks(values: list[str], size: int):
    iterator = iter(values)
    while batch := list(islice(iterator, size)):
        yield batch


def fetch_names(codes: list[str]) -> dict[str, str]:
    names: dict[str, str] = {}
    for batch in chunks(codes, 80):
        symbols = ",".join(f"{market_prefix(code)}{code}" for code in batch)
        request = Request(QUOTE_URL + symbols, headers={"User-Agent": "LocalStock/1.0"})
        with urlopen(request, timeout=20) as response:  # noqa: S310 - fixed public quote endpoint
            text = response.read().decode("gbk", errors="replace")
        for code, payload in QUOTE_RE.findall(text):
            fields = payload.split("~")
            if len(fields) > 2 and fields[1].strip() and fields[2] == code:
                names[code] = fields[1].strip()
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error(f"database not found: {args.database}")

    connection = sqlite3.connect(args.database)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS fund_info ("
            "fund_code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL, "
            "source TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        codes = [row[0] for row in connection.execute("SELECT DISTINCT fund_code FROM fund_daily ORDER BY fund_code")]
        names = fetch_names(codes)
        now = datetime.now(UTC).isoformat()
        connection.executemany(
            "INSERT INTO fund_info (fund_code, name, market, source, updated_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(fund_code) DO UPDATE SET name=excluded.name, market=excluded.market, "
            "source=excluded.source, updated_at=excluded.updated_at",
            [(code, name, market_prefix(code), "Tencent", now) for code, name in names.items()],
        )
        connection.commit()
        print(f"基金总数: {len(codes)}；已同步名称: {len(names)}；未匹配: {len(codes) - len(names)}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
