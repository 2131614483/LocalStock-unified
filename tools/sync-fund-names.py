"""Fetch ETF/fund display names once and store them in LocalStock's local DB.

Price data remains wholly local.  This utility only refreshes the small fund
metadata table; the desktop UI then reads names from that local table offline.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from datetime import UTC, datetime
from itertools import islice
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


QUOTE_URL = "https://qt.gtimg.cn/q="
QUOTE_RE = re.compile(r'v_(?:sh|sz)(\d{6})="([^"]*)";')
DIRECTORY_URL = "https://push2.eastmoney.com/api/qt/clist/get?"
DIRECTORY_PARAMS = {
    "pn": 1, "pz": 100, "po": 1, "np": 1, "fltt": 2, "invt": 2, "fid": "f3",
    # 沪深场内基金（ETF、LOF、封闭式等）板块集合。
    "fs": "b:MK0021,b:MK0022,b:MK0023,b:MK0024", "fields": "f12,f13,f14",
}


def market_prefix(code: str) -> str:
    return "sh" if code.startswith(("5", "6", "9")) else "sz"


T0_KEYWORDS = (
    # 交易所规则明确的债券、货币、黄金、商品期货和跨境基金特征。
    "债", "货币", "现金", "日利", "添益", "黄金", "白银", "原油", "石油", "豆粕", "商品",
    "纳斯达克", "纳指", "标普", "道琼斯", "恒生", "港股", "港币", "H股", "日经", "德国", "法国",
    "欧洲", "美国", "全球", "世界", "亚太", "越南", "印度", "沙特", "巴西", "韩国", "新加坡",
    "QDII", "跨境",
)


def settlement_of(name: str) -> tuple[str, str]:
    """Classify exchange fund round-trip settlement from its published product name."""
    for keyword in T0_KEYWORDS:
        if keyword.lower() in name.lower():
            return "t0", f"名称匹配：{keyword}"
    return "t1", "境内权益基金（默认）"


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


def fetch_fund_directory() -> dict[str, tuple[str, str]]:
    """Fetch the complete exchange-traded fund directory (code → name, market)."""
    result: dict[str, tuple[str, str]] = {}
    page = 1
    total = None
    while total is None or (page - 1) * int(DIRECTORY_PARAMS["pz"]) < total:
        params = {**DIRECTORY_PARAMS, "pn": page}
        request = Request(
            DIRECTORY_URL + urlencode(params),
            headers={"User-Agent": "LocalStock/1.0"},
        )
        with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed public directory endpoint
            payload = json.loads(response.read().decode("utf-8"))
        data = payload.get("data") or {}
        total = int(data.get("total") or 0)
        rows = data.get("diff") or []
        if not rows:
            break
        for row in rows:
            code = str(row.get("f12") or "").strip()
            name = str(row.get("f14") or "").strip()
            if len(code) == 6 and code.isdigit() and name:
                result[code] = (name, "sh" if str(row.get("f13")) == "1" else "sz")
        page += 1
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error(f"database not found: {args.database}")

    connection = sqlite3.connect(args.database, timeout=30)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS fund_info ("
            "fund_code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL, "
            "source TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(fund_info)")}
        if "settlement" not in columns:
            connection.execute("ALTER TABLE fund_info ADD COLUMN settlement TEXT NOT NULL DEFAULT 't1'")
        if "settlement_reason" not in columns:
            connection.execute("ALTER TABLE fund_info ADD COLUMN settlement_reason TEXT NOT NULL DEFAULT '未分类'")
        directory = fetch_fund_directory()
        existing_codes = [row[0] for row in connection.execute("SELECT DISTINCT fund_code FROM fund_daily ORDER BY fund_code")]
        missing = sorted(set(existing_codes) - set(directory))
        fallback_names = fetch_names(missing)
        for code, name in fallback_names.items():
            directory[code] = (name, market_prefix(code))
        now = datetime.now(UTC).isoformat()
        connection.executemany(
            "INSERT INTO fund_info (fund_code, name, market, source, updated_at, settlement, settlement_reason) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(fund_code) DO UPDATE SET name=excluded.name, market=excluded.market, "
            "source=excluded.source, updated_at=excluded.updated_at, settlement=excluded.settlement, "
            "settlement_reason=excluded.settlement_reason",
            [(code, name, market, "EastMoney" if code not in fallback_names else "Tencent", now, *settlement_of(name))
             for code, (name, market) in directory.items()],
        )
        connection.commit()
        t0_count = sum(1 for name, _market in directory.values() if settlement_of(name)[0] == "t0")
        print(f"场内基金目录: {len(directory)}；T+0: {t0_count}；T+1: {len(directory) - t0_count}；本地日线已有: {len(existing_codes)}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
