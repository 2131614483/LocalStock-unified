"""LocalStock 统一行情库数据源。

直接读取 ``data/market/stock_data.db``（LocalStock 唯一权威行情库），
替代原项目的 MT5 / TradingView / 新浪腾讯 等外部数据源。

价格口径说明
------------
``stock_daily`` 的 OHLC 为**不复权原始价**（bfq），与库内 CSMAR/baostock
存量一致（见 ``services/joinquant-local/scripts/backfill_daily_tx_sina.py``）。
这也正是桌面端 K 线图显示的价格，因此 AI 输出的入场/止损/止盈价格可以直接
叠加到图上。代价是除权日会出现价格缺口，可能被误判为跳空信号；
``adj_close_nd`` 为后复权收盘，但其复权因子在部分区间缺失（约 7.8% 的行
因子为 1.0），暂不足以可靠还原前复权。
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from datetime import date
from typing import Any

from pa_agent.data.ashare_common import (
    ashare_head_bar_live,
    is_index_symbol,
    normalize_ashare_symbol,
    row_time_to_ts_ms,
    rows_to_kline_bars,
)
from pa_agent.data.base import DataSource, DataSourceTransientError, KlineBar

logger = logging.getLogger(__name__)

#: 环境变量名 —— 与 ``tools/workspace-env.ps1`` 保持一致
ENV_DB_PATH = "LOCALSTOCK_MARKET_DB"

#: 相对工作区根目录的默认库位置
_DEFAULT_RELATIVE_DB = os.path.join("data", "market", "stock_data.db")

#: 日线为权威数据；周/月线由日线聚合而来
SUPPORTED_TIMEFRAMES: tuple[str, ...] = ("1d", "1w", "1M")

#: 指数在 stock_daily 中不存在，单独走 index_daily
_INDEX_TIMEFRAMES: tuple[str, ...] = ("1d",)


def resolve_db_path(explicit: str | None = None) -> str:
    """按 显式参数 → 环境变量 → 工作区默认位置 的顺序定位行情库。"""
    if explicit:
        return os.path.abspath(explicit)
    env = os.environ.get(ENV_DB_PATH, "").strip()
    if env:
        return os.path.abspath(env)
    # services/pa-agent/pa_agent/data/ -> 工作区根
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
    return os.path.join(root, _DEFAULT_RELATIVE_DB)


def _date_str(value: Any) -> str:
    """把 sqlite 返回的日期值统一成 ``YYYY-MM-DD``。"""
    text = str(value).strip()
    return text[:10]


def _aggregate(rows_asc: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    """把升序日线聚合成周线/月线（open=首、close=末、high=max、low=min、量额=sum）。

    *key* 为 ``'%Y-%W'``（周）或 ``'%Y-%m'``（月）形式的 strftime 分组键。
    """
    out: list[dict[str, Any]] = []
    bucket: list[dict[str, Any]] = []
    current: str | None = None

    def flush() -> None:
        if not bucket:
            return
        first, last = bucket[0], bucket[-1]
        out.append(
            {
                # 用该周期最后一个交易日作为 K 线日期与开盘时间戳
                "trade_date": _date_str(last["trade_date"]),
                "ts_open": last["ts_open"],
                "open": first["open"],
                "high": max(r["high"] for r in bucket),
                "low": min(r["low"] for r in bucket),
                "close": last["close"],
                "volume": sum(r["volume"] for r in bucket),
                "amount": sum(r["amount"] for r in bucket),
                # 聚合 K 线不携带官方涨跌幅，交由 prev_trading_day_close 推算
                "pct_chg": None,
                "closed": True,
            }
        )

    for row in rows_asc:
        group = date.fromisoformat(_date_str(row["trade_date"])).strftime(key)
        if current is None:
            current = group
        elif group != current:
            flush()
            bucket = []
            current = group
        bucket.append(row)
    flush()
    return out


class LocalStockSource(DataSource):
    """A股 K 线数据源，数据来自 LocalStock 统一行情库 ``stock_data.db``。"""

    def __init__(self, db_path: str | None = None) -> None:
        self._db_path = resolve_db_path(db_path)
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.RLock()
        self._symbol: str = ""
        self._timeframe: str = ""
        self._snap_cache_n: int = 0
        self._snap_cache_ts: float = 0.0
        self._snap_cache_bars: list[KlineBar] = []
        self._name_cache: dict[str, str] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    @property
    def db_path(self) -> str:
        return self._db_path

    def connect(self) -> None:
        if not os.path.exists(self._db_path):
            raise DataSourceTransientError(f"行情库不存在: {self._db_path}")
        with self._lock:
            if self._conn is None:
                # 只读打开，绝不写回权威库；refresh loop 在独立线程中查询
                self._conn = sqlite3.connect(
                    f"file:{self._db_path}?mode=ro",
                    uri=True,
                    check_same_thread=False,
                    timeout=30.0,
                )
                self._conn.row_factory = sqlite3.Row
        # 健康检查会高频触发；用 debug 避免把诊断信息挤出日志窗口
        logger.debug("LocalStockSource connected: %s", self._db_path)

    def disconnect(self) -> None:
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except Exception as exc:  # noqa: BLE001
                    logger.debug("关闭行情库连接失败: %s", exc)
                self._conn = None
        logger.debug("LocalStockSource disconnected")

    def _require_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            raise DataSourceTransientError("LocalStock 数据源未连接")
        return self._conn

    # ── Symbols ───────────────────────────────────────────────────────────────

    def list_symbols(self) -> list[str]:
        conn = self._require_conn()
        with self._lock:
            rows = conn.execute(
                "SELECT stock_code FROM stocks ORDER BY stock_code"
            ).fetchall()
        return [r[0] for r in rows]

    def stock_name(self, symbol: str) -> str:
        """返回证券简称（用于 prompt 与提示文案）。"""
        code = normalize_ashare_symbol(symbol)
        if not code:
            return ""
        cached = self._name_cache.get(code)
        if cached is not None:
            return cached
        conn = self._require_conn()
        with self._lock:
            row = conn.execute(
                "SELECT name FROM stocks WHERE stock_code = ?", (code,)
            ).fetchone()
        name = (row[0] or "") if row else ""
        self._name_cache[code] = name
        return name

    def search_symbols(
        self, keyword: str = "", limit: int = 50
    ) -> list[tuple[str, str]]:
        """按代码/名称模糊搜索，返回 ``[(code, name), ...]``。"""
        conn = self._require_conn()
        limit = max(1, min(500, int(limit)))
        with self._lock:
            if keyword:
                rows = conn.execute(
                    "SELECT stock_code, name FROM stocks "
                    "WHERE stock_code LIKE ? OR name LIKE ? "
                    "ORDER BY stock_code LIMIT ?",
                    (f"%{keyword}%", f"%{keyword}%", limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT stock_code, name FROM stocks ORDER BY stock_code LIMIT ?",
                    (limit,),
                ).fetchall()
        return [(r[0], r[1] or "") for r in rows]

    def supported_timeframes(self) -> list[str]:
        return list(SUPPORTED_TIMEFRAMES)

    # ── Subscription ──────────────────────────────────────────────────────────

    def subscribe(self, symbol: str, timeframe: str) -> None:
        if timeframe not in SUPPORTED_TIMEFRAMES:
            raise ValueError(
                f"不支持周期 {timeframe!r}，本地行情库支持 {list(SUPPORTED_TIMEFRAMES)}"
            )
        code = normalize_ashare_symbol(symbol)
        if not code:
            raise ValueError("A股代码无效，请输入 6 位数字（如 600519）")
        if is_index_symbol(code) and timeframe not in _INDEX_TIMEFRAMES:
            raise ValueError("指数仅支持日线（1d）")
        if code != self._symbol or timeframe != self._timeframe:
            self._snap_cache_bars = []
            self._snap_cache_n = 0
        self._symbol = code
        self._timeframe = timeframe
        logger.info("LocalStockSource subscribed: %s %s", code, timeframe)

    def unsubscribe(self) -> None:
        self._symbol = ""
        self._timeframe = ""
        self._snap_cache_bars = []
        self._snap_cache_n = 0

    # ── Snapshot ──────────────────────────────────────────────────────────────

    def latest_snapshot(self, n: int) -> list[KlineBar]:
        if not self._symbol or not self._timeframe:
            raise DataSourceTransientError("LocalStock 未订阅品种/周期")

        now = time.monotonic()
        with self._lock:
            if (
                self._snap_cache_bars
                and self._snap_cache_n == n
                and now - self._snap_cache_ts < _cache_ttl_s(self._timeframe)
            ):
                return list(self._snap_cache_bars)

        rows_asc = self.fetch_history(self._symbol, self._timeframe, n)
        if not rows_asc:
            raise DataSourceTransientError(
                f"本地行情库无数据: {self._symbol} {self._timeframe}"
            )

        rows_newest = list(reversed(rows_asc[-n:]))
        for i, row in enumerate(rows_newest):
            # 库内为收盘后落库的日线，全部视为已收盘；
            # 若在交易时段运行且最新一根就是当日，则标记为未收盘。
            row["closed"] = not (i == 0 and _head_bar_is_forming(self._timeframe, row))

        bars = rows_to_kline_bars(rows_newest, n)
        with self._lock:
            self._snap_cache_n = n
            self._snap_cache_ts = time.monotonic()
            self._snap_cache_bars = list(bars)
        return bars

    # ── History ───────────────────────────────────────────────────────────────

    def fetch_history(
        self, symbol: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        """返回升序（最旧在前）的 OHLCV 行。"""
        code = normalize_ashare_symbol(symbol)
        conn = self._require_conn()

        if is_index_symbol(code):
            return self._fetch_index_daily(code, n)

        if timeframe == "1d":
            return self._fetch_daily(code, n)
        if timeframe in ("1w", "1M"):
            # 周/月线需要足够多的日线来聚合出 n 根
            factor = 5 if timeframe == "1w" else 22
            daily = self._fetch_daily(code, n * factor + factor)
            key = "%Y-%W" if timeframe == "1w" else "%Y-%m"
            return _aggregate(daily, key)[-n:]
        raise ValueError(f"不支持周期: {timeframe!r}")

    def _fetch_daily(self, code: str, n: int) -> list[dict[str, Any]]:
        conn = self._require_conn()
        with self._lock:
            rows = conn.execute(
                """
                SELECT trade_date, open_price, high_price, low_price, close_price,
                       volume, amount, change_ratio
                  FROM stock_daily
                 WHERE stock_code = ?
                 ORDER BY trade_date DESC
                 LIMIT ?
                """,
                (code, int(n)),
            ).fetchall()
        return [_row_to_ohlcv(r) for r in reversed(rows)]

    def _fetch_index_daily(self, code: str, n: int) -> list[dict[str, Any]]:
        conn = self._require_conn()
        with self._lock:
            rows = conn.execute(
                """
                SELECT trade_date, open_index, high_index, low_index, close_index,
                       volume, amount
                  FROM index_daily
                 WHERE index_code = ?
                 ORDER BY trade_date DESC
                 LIMIT ?
                """,
                (code, int(n)),
            ).fetchall()
        return [_row_to_ohlcv(r) for r in reversed(rows)]

    # ── Diagnostics ───────────────────────────────────────────────────────────

    def data_range(self, symbol: str) -> tuple[str, str, int]:
        """返回某只股票的 ``(最早日, 最新日, 行数)``，用于健康检查。"""
        code = normalize_ashare_symbol(symbol)
        conn = self._require_conn()
        with self._lock:
            row = conn.execute(
                "SELECT min(trade_date), max(trade_date), count(*) "
                "FROM stock_daily WHERE stock_code = ?",
                (code,),
            ).fetchone()
        return (row[0] or "", row[1] or "", row[2] or 0)


# ── helpers ───────────────────────────────────────────────────────────────────


def _row_to_ohlcv(row: sqlite3.Row) -> dict[str, Any]:
    """把 index_daily / stock_daily 的行统一成 ashare_common 期望的 dict。"""
    keys = row.keys()
    ohlc = [k for k in keys if k.endswith(("_price", "_index"))]
    by_role = {}
    for k in ohlc:
        for role in ("open", "high", "low", "close"):
            if k.startswith(role):
                by_role[role] = row[k]
    pct = row["change_ratio"] if "change_ratio" in keys else None
    return {
        "trade_date": _date_str(row["trade_date"]),
        "ts_open": row_time_to_ts_ms(_date_str(row["trade_date"])),
        "open": float(by_role.get("open") or 0.0),
        "high": float(by_role.get("high") or 0.0),
        "low": float(by_role.get("low") or 0.0),
        "close": float(by_role.get("close") or 0.0),
        "volume": float(row["volume"] or 0.0),
        "amount": float(row["amount"] or 0.0),
        # change_ratio 是小数（-0.0149），pct_chg 约定为百分数（-1.49）
        "pct_chg": None if pct is None else float(pct) * 100.0,
    }


def _head_bar_is_forming(timeframe: str, row: dict[str, Any]) -> bool:
    """最新一根是否为「当日未收盘」——仅在交易时段内且日期为今天时成立。"""
    from pa_agent.data.ashare_common import cn_now

    if not ashare_head_bar_live(timeframe):
        return False
    return _date_str(row["trade_date"]) == cn_now().strftime("%Y-%m-%d")


def _cache_ttl_s(timeframe: str) -> float:
    """日线库为收盘后落库，缓存 60s 足够；周/月线放宽到 300s。"""
    return 300.0 if timeframe in ("1w", "1M") else 60.0
