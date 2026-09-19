"""BaostockSource — A-share K-line data source built on the baostock library.

Baostock (https://baostock.com) provides free A-share historical data over a
plain socket protocol. No WebSocket / login-window constraints, which makes it
a stable choice for A-share daily/weekly/monthly and minute bars.

Supported timeframes (all on stocks; indices are daily/weekly/monthly only):
    5m, 15m, 30m, 1h, 4h (resampled from 1h), 1d, 1w, 1M

Adjustment follows the global ``get_kline_adjust()`` setting
(qfq -> adjustflag=2, hfq -> 1, none -> 3).

Notes
-----
- Baostock has no realtime tick/quote API: the forming (unclosed) bar is
  whatever the last query returned. The RefreshLoop re-queries periodically,
  which serves as a coarse "polling snapshot".
- Baostock minute timestamps are bar END times; they are shifted back by one
  period so ``ts_open`` matches Tencent/Sina minute bars (bar start time).
- Volume is already in shares (股) for stocks and indices.
- Session management / retry / error classification is reused from
  ``eastmoney_baostock`` (thread-safe, auto re-login on socket errors).
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from pa_agent.data.ashare_common import (
    PRESET_SYMBOLS,
    ashare_head_bar_live,
    cn_now,
    is_index_symbol,
    normalize_ashare_symbol,
    resample_rows_to_4h,
    row_time_to_ts_ms,
    rows_to_kline_bars,
)
from pa_agent.data.base import DataSource, DataSourceTransientError, KlineBar
from pa_agent.data.eastmoney_baostock import (
    _BaostockSession,
    _baostock_code,
    _collect_baostock_rows,
)
from pa_agent.data.kline_adjust import get_kline_adjust
from pa_agent.data.refresh_policy import snapshot_cache_ttl_s

logger = logging.getLogger(__name__)

_SUPPORTED_TIMEFRAMES: tuple[str, ...] = (
    "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M",
)

# timeframe -> baostock frequency token
_FREQ: dict[str, str] = {
    "5m": "5", "15m": "15", "30m": "30", "1h": "60",
    "1d": "d", "1w": "w", "1M": "m",
}
_MINUTE_FREQ_MINUTES: dict[str, int] = {"5": 5, "15": 15, "30": 30, "60": 60}
# kline_adjust -> baostock adjustflag (2=qfq, 1=hfq, 3=none)
_ADJUST_FLAG: dict[str, str] = {"qfq": "2", "hfq": "1", "none": "3"}

_FIELDS_DAILY = "date,code,open,high,low,close,volume,amount"
_FIELDS_MINUTE = "date,time,code,open,high,low,close,volume,amount"


class BaostockSource(DataSource):
    """A-share K-line source backed by the baostock free data service."""

    def __init__(self) -> None:
        self._symbol: str = ""
        self._timeframe: str = ""
        self._connected: bool = False
        self._snap_cache_n: int = 0
        self._snap_cache_ts: float = 0.0
        self._snap_cache_bars: list[KlineBar] = []

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def connect(self) -> None:
        # Login is lazy (first query auto-logs-in); do not block connect on the
        # network. Failures surface as transient errors on first snapshot.
        self._connected = True
        logger.info("BaostockSource connected")

    def disconnect(self) -> None:
        self._connected = False
        try:
            _BaostockSession.logout()
        except Exception as exc:  # noqa: BLE001
            logger.debug("Baostock logout on disconnect: %s", exc)
        logger.info("BaostockSource disconnected")

    def list_symbols(self) -> list[str]:
        return list(PRESET_SYMBOLS)

    def supported_timeframes(self) -> list[str]:
        return list(_SUPPORTED_TIMEFRAMES)

    def subscribe(self, symbol: str, timeframe: str) -> None:
        if timeframe not in _SUPPORTED_TIMEFRAMES:
            raise ValueError(
                f"Unsupported timeframe: {timeframe!r}. "
                f"Baostock 支持 {list(_SUPPORTED_TIMEFRAMES)}（无 1m）"
            )
        code = normalize_ashare_symbol(symbol)
        if not code:
            raise ValueError("A股代码无效，请输入 6 位数字（如 600519）或指数 sh000300")
        if is_index_symbol(code) and timeframe not in ("1d", "1w", "1M"):
            raise ValueError("Baostock 指数仅支持日线/周线/月线（1d/1w/1M）")
        if code != self._symbol or timeframe != self._timeframe:
            self._snap_cache_bars = []
            self._snap_cache_n = 0
        self._symbol = code
        self._timeframe = timeframe
        logger.info("BaostockSource subscribed: %s %s", code, timeframe)

    def unsubscribe(self) -> None:
        self._symbol = ""
        self._timeframe = ""
        self._snap_cache_bars = []
        self._snap_cache_n = 0
        logger.info("BaostockSource unsubscribed")

    # ── Snapshot ──────────────────────────────────────────────────────────────

    def latest_snapshot(self, n: int) -> list[KlineBar]:
        if not self._connected:
            raise DataSourceTransientError("Baostock 数据源未连接")
        if not self._symbol or not self._timeframe:
            raise DataSourceTransientError("Baostock 未订阅品种/周期")

        import time

        now = time.monotonic()
        cache_ttl = snapshot_cache_ttl_s(self._timeframe)
        if (
            self._snap_cache_bars
            and self._snap_cache_n == n
            and now - self._snap_cache_ts < cache_ttl
        ):
            return list(self._snap_cache_bars)

        fetch_n = max(n + 5, 30)
        rows_asc = self._fetch_history(self._symbol, self._timeframe, fetch_n)
        if not rows_asc:
            raise DataSourceTransientError(
                f"Baostock 未返回数据: {self._symbol} {self._timeframe}"
            )

        rows_newest = list(reversed(rows_asc[-fetch_n:]))
        for i, row in enumerate(rows_newest):
            row["closed"] = not (i == 0 and ashare_head_bar_live(self._timeframe))

        bars = rows_to_kline_bars(rows_newest, n)
        self._snap_cache_n = n
        self._snap_cache_ts = time.monotonic()
        self._snap_cache_bars = list(bars)
        return bars

    # ── History fetch ─────────────────────────────────────────────────────────

    def _fetch_history(
        self, symbol: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        code = _baostock_code(symbol)
        if timeframe == "4h":
            hourly = self._fetch_freq(code, "1h", n * 4 + 8)
            return resample_rows_to_4h(hourly)[-n:]
        return self._fetch_freq(code, timeframe, n)

    def _fetch_freq(
        self, code: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        freq = _FREQ[timeframe]
        adjust = _ADJUST_FLAG.get(get_kline_adjust(), "2")
        start, end = self._query_window(timeframe, n)

        fields = _FIELDS_MINUTE if freq in _MINUTE_FREQ_MINUTES else _FIELDS_DAILY

        def _query() -> list[list[str]]:
            import baostock as bs

            rs = bs.query_history_k_data_plus(
                code,
                fields,
                start_date=start,
                end_date=end,
                frequency=freq,
                adjustflag=adjust,
            )
            return _collect_baostock_rows(rs)

        data = _BaostockSession.execute(f"Baostock {timeframe}", _query)
        if not data:
            raise DataSourceTransientError(
                f"Baostock {timeframe} 无数据（{code}，复权={adjust}）"
            )

        if freq in _MINUTE_FREQ_MINUTES:
            rows = self._rows_from_minute(data, _MINUTE_FREQ_MINUTES[freq])
        else:
            rows = self._rows_from_daily(data)
        if not rows:
            raise DataSourceTransientError(f"Baostock {timeframe} 解析后无数据（{code}）")
        return rows[-(n + 5) :]

    @staticmethod
    def _rows_from_daily(data: list[list[str]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for item in data:
            if len(item) < 7:
                continue
            try:
                ts = row_time_to_ts_ms(str(item[0]))
                o, h, lo, c = (float(item[2]), float(item[3]), float(item[4]), float(item[5]))
                vol = float(item[6] or 0.0)
                amount = float(item[7] or 0.0) if len(item) > 7 else 0.0
            except (TypeError, ValueError):
                continue
            rows.append(
                {
                    "ts_open": ts,
                    "open": o,
                    "high": max(h, lo),
                    "low": min(h, lo),
                    "close": c,
                    "volume": vol,
                    "amount": amount,
                }
            )
        rows.sort(key=lambda r: int(r["ts_open"]))
        return rows

    @staticmethod
    def _rows_from_minute(
        data: list[list[str]], freq_minutes: int
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for item in data:
            if len(item) < 8:
                continue
            try:
                # Baostock minute time is the bar END time; shift back so
                # ts_open matches Tencent/Sina (bar start time).
                ts = row_time_to_ts_ms(str(item[1])[:14]) - freq_minutes * 60_000
                o, h, lo, c = (float(item[3]), float(item[4]), float(item[5]), float(item[6]))
                vol = float(item[7] or 0.0)
            except (TypeError, ValueError):
                continue
            rows.append(
                {
                    "ts_open": ts,
                    "open": o,
                    "high": max(h, lo),
                    "low": min(h, lo),
                    "close": c,
                    "volume": vol,
                    "amount": 0.0,
                }
            )
        rows.sort(key=lambda r: int(r["ts_open"]))
        return rows

    @staticmethod
    def _query_window(timeframe: str, n: int) -> tuple[str, str]:
        now = cn_now()
        end = now.strftime("%Y-%m-%d")
        if timeframe == "1M":
            start = (now - timedelta(days=n * 32 + 40)).strftime("%Y-%m-%d")
        elif timeframe == "1w":
            start = (now - timedelta(days=n * 8 + 30)).strftime("%Y-%m-%d")
        elif timeframe == "1d":
            start = (now - timedelta(days=int(n * 1.6) + 20)).strftime("%Y-%m-%d")
        else:
            # Minute bars: size the window by bars needed (4h per trading day),
            # with buffer for weekends/holidays — a huge window makes the
            # baostock server stream tens of thousands of rows (very slow).
            freq_min = _MINUTE_FREQ_MINUTES[_FREQ[timeframe]]
            trading_days = (n * freq_min) / 240.0
            cal_days = int(trading_days * 1.7) + 12
            start = (now - timedelta(days=cal_days)).strftime("%Y-%m-%d")
        return start, end
