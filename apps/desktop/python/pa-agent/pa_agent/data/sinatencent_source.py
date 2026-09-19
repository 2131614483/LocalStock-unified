"""Sina / Tencent (新浪/腾讯) A-share K-line data source.

Dual-channel design for stability: **Tencent** quote/kline HTTP APIs are the
primary channel, **Sina** is an automatic fallback when Tencent fails. Both
channels are plain HTTP endpoints (no WebSocket, no login), which makes this
source far more stable than TradingView for A-share data.

Channel coverage (all timeframes on both channels):

+----------+---------------------------------------------+----------------------------------------------+
| timeframe| Tencent (primary)                            | Sina (fallback)                             |
+==========+=============================================+==============================================+
| 1m-1h    | appstock/app/kline/mkline (m1..m60)         | CN_MarketDataService.getKLineData scale=1..60|
| 4h       | m60 resampled x4                            | getKLineData scale=240                      |
| 1d       | fqkline day (qfq/hfq/none)                  | getKLineData scale=240 (unadjusted)         |
| 1w/1M    | fqkline week/month (qfq/hfq/none)           | getKLineData scale=1200/7200 (unadjusted)   |
+----------+---------------------------------------------+----------------------------------------------+

Live quote refresh (forming bar) also prefers Tencent ``qt.gtimg.cn`` and
falls back to Sina ``hq.sinajs.cn``.

Notes
-----
- Tencent kline rows are ``[date, open, close, high, low, volume_lots]`` —
  open/close come BEFORE high/low. Volume unit is 手 (lots); converted to
  shares via ``quote_volume_lots_to_shares`` for non-index symbols.
- Sina ``getKLineData`` returns unadjusted data only. As a fallback this is
  acceptable; the primary Tencent channel honors ``get_kline_adjust()``.
- No extra pip dependency: uses ``requests`` (already present in the venv).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from pa_agent.data.ashare_common import (
    PRESET_SYMBOLS,
    apply_session_quote_to_forming_row,
    ashare_head_bar_live,
    ashare_trading_day,
    cn_now,
    ensure_today_forming_daily_bar,
    index_symbol_for_api,
    is_index_symbol,
    normalize_ashare_symbol,
    quote_volume_lots_to_shares,
    resample_rows_to_4h,
    row_time_to_ts_ms,
    rows_to_kline_bars,
)
from pa_agent.data.base import DataSource, DataSourceTransientError, KlineBar
from pa_agent.data.kline_adjust import get_kline_adjust
from pa_agent.data.refresh_policy import snapshot_cache_ttl_s

logger = logging.getLogger(__name__)

_CN_TZ = ZoneInfo("Asia/Shanghai")

# ── HTTP client tuning ────────────────────────────────────────────────────────
_TIMEOUT_S = 8.0
_CHANNEL_RETRIES = 2
_RETRY_SLEEP_S = 0.5

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}
# hq.sinajs.cn rejects requests without a finance.sina.com.cn Referer.
_SINA_QUOTE_HEADERS = {**_HEADERS, "Referer": "https://finance.sina.com.cn"}

# ── Endpoints ─────────────────────────────────────────────────────────────────
_QT_QUOTE_URL = "https://qt.gtimg.cn/q={codes}"
_TENCENT_FQKLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
_TENCENT_MKLINE_URL = "https://ifzq.gtimg.cn/appstock/app/kline/mkline"
_SINA_QUOTE_URL = "https://hq.sinajs.cn/list={codes}"
_SINA_KLINE_URL = (
    "https://quotes.sina.cn/cn/api/json_v2.php/"
    "CN_MarketDataService.getKLineData"
)

# ── Timeframe maps ────────────────────────────────────────────────────────────
_SUPPORTED_TIMEFRAMES: tuple[str, ...] = (
    "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M",
)

# Tencent fqkline period keyword -> response key suffix
_TENCENT_PERIOD: dict[str, str] = {"1d": "day", "1w": "week", "1M": "month"}
# Tencent mkline period keyword (minute bars)
_TENCENT_MINUTE: dict[str, str] = {
    "1m": "m1", "5m": "m5", "15m": "m15", "30m": "m30", "1h": "m60",
}
# Sina getKLineData scale (minutes): 240 = daily, 1200 = weekly, 7200 = monthly
_SINA_SCALE: dict[str, int] = {
    "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60,
    "4h": 240, "1d": 240, "1w": 1200, "1M": 7200,
}
# kline_adjust -> Tencent fqkline adjust token; "" means unadjusted (key = period)
_TENCENT_ADJUST: dict[str, str] = {"qfq": "qfq", "hfq": "hfq", "none": ""}


class SinaTencentSource(DataSource):
    """A-share K-line source: Tencent primary, Sina fallback (both HTTP)."""

    def __init__(self) -> None:
        self._symbol: str = ""
        self._timeframe: str = ""
        self._connected: bool = False
        self._snap_cache_n: int = 0
        self._snap_cache_ts: float = 0.0
        self._snap_cache_bars: list[KlineBar] = []
        self._http_lock = threading.Lock()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def connect(self) -> None:
        self._connected = True
        logger.info("SinaTencentSource connected")

    def disconnect(self) -> None:
        self._connected = False
        logger.info("SinaTencentSource disconnected")

    def list_symbols(self) -> list[str]:
        return list(PRESET_SYMBOLS)

    def supported_timeframes(self) -> list[str]:
        return list(_SUPPORTED_TIMEFRAMES)

    def subscribe(self, symbol: str, timeframe: str) -> None:
        if timeframe not in _SUPPORTED_TIMEFRAMES:
            raise ValueError(
                f"Unsupported timeframe: {timeframe!r}. "
                f"Use one of {list(_SUPPORTED_TIMEFRAMES)}"
            )
        code = normalize_ashare_symbol(symbol)
        if not code:
            raise ValueError("A股代码无效，请输入 6 位数字（如 600519）或指数 sh000300")
        if code != self._symbol or timeframe != self._timeframe:
            self._snap_cache_bars = []
            self._snap_cache_n = 0
        self._symbol = code
        self._timeframe = timeframe
        logger.info("SinaTencentSource subscribed: %s %s", code, timeframe)

    def unsubscribe(self) -> None:
        self._symbol = ""
        self._timeframe = ""
        self._snap_cache_bars = []
        self._snap_cache_n = 0
        logger.info("SinaTencentSource unsubscribed")

    # ── Snapshot ──────────────────────────────────────────────────────────────

    def latest_snapshot(self, n: int) -> list[KlineBar]:
        if not self._connected:
            raise DataSourceTransientError("新浪/腾讯数据源未连接")
        if not self._symbol or not self._timeframe:
            raise DataSourceTransientError("新浪/腾讯未订阅品种/周期")

        now = time.monotonic()
        cache_ttl = snapshot_cache_ttl_s(self._timeframe)
        if (
            self._snap_cache_bars
            and self._snap_cache_n == n
            and now - self._snap_cache_ts < cache_ttl
        ):
            return list(self._snap_cache_bars)

        with self._http_lock:
            fetch_n = max(n + 5, 30)
            rows_asc = self._fetch_history(self._symbol, self._timeframe, fetch_n)
            if not rows_asc:
                raise DataSourceTransientError(
                    f"新浪/腾讯未返回数据: {self._symbol} {self._timeframe}"
                )
            self._ensure_forming_daily_bar(rows_asc)
            if ashare_head_bar_live(self._timeframe):
                self._apply_spot_to_forming(rows_asc)

        rows_newest = list(reversed(rows_asc[-fetch_n:]))
        for i, row in enumerate(rows_newest):
            row["closed"] = not (i == 0 and ashare_head_bar_live(self._timeframe))

        bars = rows_to_kline_bars(rows_newest, n)
        self._snap_cache_n = n
        self._snap_cache_ts = time.monotonic()
        self._snap_cache_bars = list(bars)
        return bars

    # ── History fetch (dual channel) ──────────────────────────────────────────

    def _fetch_history(
        self, symbol: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        """Return ascending OHLCV rows; Tencent first, then Sina fallback."""
        errors: list[str] = []
        try:
            return self._fetch_tencent(symbol, timeframe, n)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"腾讯: {exc}")
            logger.info("Tencent fetch failed for %s %s (%s); trying Sina", symbol, timeframe, exc)
        try:
            return self._fetch_sina(symbol, timeframe, n)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"新浪: {exc}")
            logger.info("Sina fetch failed for %s %s (%s)", symbol, timeframe, exc)
        raise DataSourceTransientError(
            f"K线拉取失败（新浪与腾讯均不可用）：{symbol} {timeframe}；"
            f"({'；'.join(errors)})"
        )

    # ── Tencent channel ───────────────────────────────────────────────────────

    def _fetch_tencent(
        self, symbol: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        code = _api_symbol(symbol)
        if timeframe in _TENCENT_PERIOD:
            return self._fetch_tencent_period(code, timeframe, n)
        if timeframe == "4h":
            return self._fetch_tencent_4h(code, n)
        return self._fetch_tencent_minute(code, timeframe, n)

    def _fetch_tencent_period(
        self, code: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        period = _TENCENT_PERIOD[timeframe]
        adjust = _TENCENT_ADJUST.get(get_kline_adjust(), "")
        params = {"param": f"{code},{period},,,{n + 5},{adjust}"}
        payload = self._tencent_get(_TENCENT_FQKLINE_URL, params)
        node = ((payload.get("data") or {}).get(code) or {})
        # 指数等无复权数据忽略 adjust 参数，key 回退为 period。
        key = f"{adjust}{period}" if adjust else period
        raw_rows = node.get(key) or node.get(period) or []
        if not raw_rows:
            raise DataSourceTransientError(
                f"腾讯 {period} 无数据（{code}，复权={adjust or 'none'}）"
            )
        rows: list[dict[str, Any]] = []
        for item in raw_rows:
            if not isinstance(item, (list, tuple)) or len(item) < 6:
                continue
            rows.append(
                {
                    "ts_open": row_time_to_ts_ms(str(item[0])),
                    "open": float(item[1]),
                    "close": float(item[2]),
                    "high": float(item[3]),
                    "low": float(item[4]),
                    "volume": quote_volume_lots_to_shares(
                        float(item[5] or 0.0), symbol=code
                    ),
                    "amount": 0.0,
                }
            )
        return self._normalize_asc_rows(rows)

    def _fetch_tencent_4h(self, code: str, n: int) -> list[dict[str, Any]]:
        want = n * 4 + 8
        params = {"param": f"{code},m60,,{want}"}
        payload = self._tencent_get(_TENCENT_MKLINE_URL, params)
        node = ((payload.get("data") or {}).get(code) or {})
        raw_rows = node.get("m60") or []
        rows = self._parse_tencent_minute_rows(raw_rows, symbol=code)
        return resample_rows_to_4h(rows)[-n:]

    def _fetch_tencent_minute(
        self, code: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        period = _TENCENT_MINUTE[timeframe]
        params = {"param": f"{code},{period},,{n + 8}"}
        payload = self._tencent_get(_TENCENT_MKLINE_URL, params)
        node = ((payload.get("data") or {}).get(code) or {})
        raw_rows = node.get(period) or []
        rows = self._parse_tencent_minute_rows(raw_rows, symbol=code)
        if not rows:
            raise DataSourceTransientError(f"腾讯 {period} 无数据（{code}）")
        return rows[-(n + 5) :]

    @staticmethod
    def _parse_tencent_minute_rows(
        raw_rows: list[Any], *, symbol: str = ""
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for item in raw_rows:
            if not isinstance(item, (list, tuple)) or len(item) < 6:
                continue
            ts_text = str(item[0])
            try:
                dt = datetime.strptime(ts_text, "%Y%m%d%H%M").replace(tzinfo=_CN_TZ)
                ts_ms = int(dt.timestamp() * 1000)
            except ValueError:
                ts_ms = row_time_to_ts_ms(ts_text)
            rows.append(
                {
                    "ts_open": ts_ms,
                    "open": float(item[1]),
                    "close": float(item[2]),
                    "high": float(item[3]),
                    "low": float(item[4]),
                    "volume": quote_volume_lots_to_shares(
                        float(item[5] or 0.0), symbol=symbol
                    ),
                    "amount": 0.0,
                }
            )
        return rows

    def _tencent_get(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        """GET a Tencent JSON endpoint with bounded retries."""
        last_exc: Exception | None = None
        for i in range(_CHANNEL_RETRIES):
            try:
                resp = requests.get(
                    url, params=params, headers=_HEADERS, timeout=_TIMEOUT_S
                )
                resp.raise_for_status()
                payload = resp.json()
                if payload.get("code") not in (0, None):
                    raise DataSourceTransientError(
                        f"腾讯接口返回异常: code={payload.get('code')} msg={payload.get('msg')}"
                    )
                return payload
            except (requests.RequestException, ValueError) as exc:
                last_exc = exc
                if i + 1 < _CHANNEL_RETRIES:
                    time.sleep(_RETRY_SLEEP_S)
        raise DataSourceTransientError(f"腾讯接口请求失败: {last_exc}") from last_exc

    # ── Sina channel ──────────────────────────────────────────────────────────

    def _fetch_sina(
        self, symbol: str, timeframe: str, n: int
    ) -> list[dict[str, Any]]:
        code = _api_symbol(symbol)
        scale = _SINA_SCALE[timeframe]
        params = {
            "symbol": code,
            "scale": str(scale),
            "ma": "no",
            "datalen": str(n + 5),
        }
        raw = self._sina_get_json(_SINA_KLINE_URL, params)
        rows: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                rows.append(
                    {
                        "ts_open": row_time_to_ts_ms(str(item.get("day", ""))),
                        "open": float(item["open"]),
                        "high": float(item["high"]),
                        "low": float(item["low"]),
                        "close": float(item["close"]),
                        "volume": float(item.get("volume", 0.0) or 0.0),
                        "amount": float(item.get("amount", 0.0) or 0.0),
                    }
                )
            except (KeyError, TypeError, ValueError):
                continue
        if not rows:
            raise DataSourceTransientError(f"新浪 scale={scale} 无数据（{code}）")
        return self._normalize_asc_rows(rows)

    def _sina_get_json(self, url: str, params: dict[str, str]) -> Any:
        last_exc: Exception | None = None
        for i in range(_CHANNEL_RETRIES):
            try:
                resp = requests.get(
                    url, params=params, headers=_HEADERS, timeout=_TIMEOUT_S
                )
                resp.raise_for_status()
                return resp.json()
            except (requests.RequestException, ValueError) as exc:
                last_exc = exc
                if i + 1 < _CHANNEL_RETRIES:
                    time.sleep(_RETRY_SLEEP_S)
        raise DataSourceTransientError(f"新浪接口请求失败: {last_exc}") from last_exc

    # ── Shared helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _normalize_asc_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Sort ascending by ts_open, drop dups, ensure sane high/low."""
        if not rows:
            return []
        rows.sort(key=lambda r: int(r["ts_open"]))
        seen: set[int] = set()
        out: list[dict[str, Any]] = []
        for row in rows:
            ts = int(row["ts_open"])
            if ts in seen:
                continue
            seen.add(ts)
            o, h, lo, c = (
                float(row["open"]),
                float(row["high"]),
                float(row["low"]),
                float(row["close"]),
            )
            h, lo = max(h, lo), min(h, lo)
            c = max(lo, min(h, c))
            out.append(
                {
                    "ts_open": ts,
                    "open": o,
                    "high": h,
                    "low": lo,
                    "close": c,
                    "volume": float(row.get("volume", 0.0) or 0.0),
                    "amount": float(row.get("amount", 0.0) or 0.0),
                }
            )
        return out

    def _ensure_forming_daily_bar(self, rows_asc: list[dict[str, Any]]) -> None:
        """盘中若日线仍停在上一交易日，补一根当日未收盘 K 线。"""
        if self._timeframe != "1d" or not ashare_trading_day():
            return
        if not rows_asc:
            return
        today = cn_now().date()
        if (
            datetime.fromtimestamp(int(rows_asc[-1]["ts_open"]) / 1000, tz=_CN_TZ).date()
            >= today
        ):
            return
        spot = self._fetch_spot(self._symbol)
        if spot is None:
            return
        ensure_today_forming_daily_bar(
            rows_asc,
            symbol=self._symbol,
            spot_price=spot.get("price"),
            session_open=spot.get("open", 0.0),
            session_high=spot.get("high", 0.0),
            session_low=spot.get("low", 0.0),
            session_volume_lots=spot.get("volume_lots", 0.0),
            session_amount=spot.get("amount", 0.0),
        )

    def _apply_spot_to_forming(self, rows_asc: list[dict[str, Any]]) -> None:
        """刷新最新（未收盘）K 线为实时行情。"""
        if not rows_asc:
            return
        spot = self._fetch_spot(self._symbol)
        if spot is None:
            return
        last = rows_asc[-1]
        daily = self._timeframe == "1d"
        if daily and not ashare_trading_day():
            return
        if not daily and not ashare_head_bar_live(self._timeframe):
            return
        # 腾讯快照量为手（volume_is_lots=True，需转股）；新浪快照量已是股。
        apply_session_quote_to_forming_row(
            last,
            price=spot["price"],
            open_=spot.get("open", 0.0),
            high=spot.get("high", 0.0),
            low=spot.get("low", 0.0),
            volume=(
                spot.get("volume_lots", 0.0)
                if spot.get("volume_is_lots")
                else spot.get("volume", 0.0)
            ),
            amount=spot.get("amount", 0.0),
            prev_close=spot.get("prev_close", 0.0),
            daily=daily,
            volume_lots=bool(spot.get("volume_is_lots")),
            symbol=self._symbol,
        )

    def _fetch_spot(self, symbol: str) -> dict[str, float] | None:
        """Live quote dict (price/open/high/low/volume/volume_lots/amount/prev_close)."""
        code = _api_symbol(symbol)
        spot = self._fetch_tencent_spot(code)
        if spot is not None:
            return spot
        return self._fetch_sina_spot(code)

    def _fetch_tencent_spot(self, code: str) -> dict[str, float] | None:
        try:
            resp = requests.get(
                _QT_QUOTE_URL.format(codes=code),
                headers=_HEADERS,
                timeout=_TIMEOUT_S,
            )
            resp.raise_for_status()
            text = resp.content.decode("gbk", errors="replace")
        except (requests.RequestException, UnicodeDecodeError) as exc:
            logger.debug("Tencent quote failed for %s: %s", code, exc)
            return None
        m = re.search(r'="([^"]*)"', text)
        if m is None:
            return None
        fields = m.group(1).split("~")
        if len(fields) < 38:
            return None
        try:
            price = float(fields[3])
        except (TypeError, ValueError):
            return None
        if price <= 0:
            return None
        volume_lots = _safe_float(fields[6])
        return {
            "price": price,
            "prev_close": _safe_float(fields[4]),
            "open": _safe_float(fields[5]),
            "high": _safe_float(fields[33]),
            "low": _safe_float(fields[34]),
            "volume": quote_volume_lots_to_shares(volume_lots, symbol=code),
            "volume_lots": volume_lots,
            "volume_is_lots": True,
            "amount": _safe_float(fields[37]) * 10000.0,  # 万元 -> 元
        }

    def _fetch_sina_spot(self, code: str) -> dict[str, float] | None:
        try:
            resp = requests.get(
                _SINA_QUOTE_URL.format(codes=code),
                headers=_SINA_QUOTE_HEADERS,
                timeout=_TIMEOUT_S,
            )
            resp.raise_for_status()
            text = resp.content.decode("gbk", errors="replace")
        except (requests.RequestException, UnicodeDecodeError) as exc:
            logger.debug("Sina quote failed for %s: %s", code, exc)
            return None
        m = re.search(r'="([^"]*)"', text)
        if m is None:
            return None
        fields = m.group(1).split(",")
        if len(fields) < 32:
            return None
        try:
            price = float(fields[3])
        except (TypeError, ValueError):
            return None
        if price <= 0:
            return None
        # Sina quote volume is already in shares (股) for stocks.
        volume = _safe_float(fields[8])
        return {
            "price": price,
            "prev_close": _safe_float(fields[2]),
            "open": _safe_float(fields[1]),
            "high": _safe_float(fields[4]),
            "low": _safe_float(fields[5]),
            "volume": volume,
            "volume_lots": 0.0,
            "volume_is_lots": False,
            "amount": _safe_float(fields[9]),
        }


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _api_symbol(symbol: str) -> str:
    """Full exchange-prefixed symbol for Sina/Tencent APIs.

    Distinguishes index codes (000300 -> sh000300, 399006 -> sz399006) from
    stocks (000001 -> sz000001 平安银行, 600519 -> sh600519).
    """
    sym = normalize_ashare_symbol(symbol)
    if sym.startswith(("sh", "sz")):
        return sym
    if is_index_symbol(sym):
        return index_symbol_for_api(sym)
    if sym[:1] in ("6", "9"):
        return f"sh{sym}"
    return f"sz{sym}"
