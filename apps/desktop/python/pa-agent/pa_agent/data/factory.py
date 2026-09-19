"""Construct :class:`DataSource` implementations by kind id."""
from __future__ import annotations

from typing import Literal

from pa_agent.data.base import DataSource
from pa_agent.data.market_defaults import (
    A_SHARE_DEFAULT_SYMBOL,
    GOLD_MT5_SYMBOL,
    GOLD_TV_SYMBOL,
)

DataSourceKind = Literal[
    "localstock",
    "mt5",
    "tradingview",
    "akshare",
    "eastmoney",
    "sinatencent",
    "baostock",
    "yfinance",
]

# UI-visible sources — ``localstock`` 读 LocalStock 统一行情库（本项目默认）；
# ``sinatencent`` (新浪/腾讯) 和 ``baostock`` 是 A 股 HTTP/socket 源，
# 无 WebSocket 登录；``eastmoney``/``akshare``/``yfinance`` 为配置/程序化入口。
DATA_SOURCE_CHOICES: tuple[tuple[DataSourceKind, str], ...] = (
    ("localstock", "本地行情库"),
    ("mt5", "MT5"),
    ("tradingview", "TradingView"),
    ("sinatencent", "新浪腾讯"),
    ("baostock", "Baostock"),
)

_HIDDEN_KINDS: frozenset[DataSourceKind] = frozenset(
    {"akshare", "eastmoney", "yfinance"}
)

_DEFAULT_SYMBOLS: dict[DataSourceKind, str] = {
    "localstock": A_SHARE_DEFAULT_SYMBOL,
    "mt5": GOLD_MT5_SYMBOL,
    "tradingview": GOLD_TV_SYMBOL,
    "akshare": A_SHARE_DEFAULT_SYMBOL,
    "eastmoney": A_SHARE_DEFAULT_SYMBOL,
    "sinatencent": A_SHARE_DEFAULT_SYMBOL,
    "baostock": A_SHARE_DEFAULT_SYMBOL,
    "yfinance": "GC=F",
}


def default_tradingview_exchange() -> str:
    """Empty string = UI «（自动）» — probe all TV preset venues."""
    return ""


def normalize_data_source_kind(kind: str | None) -> DataSourceKind:
    """Return a supported data-source kind, defaulting to the local market DB."""
    supported = {k for k, _ in DATA_SOURCE_CHOICES} | _HIDDEN_KINDS
    if kind in supported:
        return kind  # type: ignore[return-value]
    return "localstock"


def data_source_label(kind: str | None) -> str:
    """Human-readable label for *kind*."""
    normalized = normalize_data_source_kind(kind)
    for key, label in DATA_SOURCE_CHOICES:
        if key == normalized:
            return label
    if normalized == "eastmoney":
        return "东方财富"
    if normalized == "akshare":
        return "AkShare"
    if normalized == "yfinance":
        return "YFinance"
    return "MT5"


def default_symbol_for_kind(kind: str | None) -> str:
    return _DEFAULT_SYMBOLS[normalize_data_source_kind(kind)]


def create_data_source(kind: str | None) -> DataSource:
    """Instantiate a fresh data source for *kind* (not connected)."""
    normalized = normalize_data_source_kind(kind)
    if normalized == "localstock":
        from pa_agent.data.localstock_source import LocalStockSource

        return LocalStockSource()
    if normalized == "tradingview":
        from pa_agent.data.tradingview import TradingViewSource

        return TradingViewSource()
    if normalized == "sinatencent":
        from pa_agent.data.sinatencent_source import SinaTencentSource

        return SinaTencentSource()
    if normalized == "baostock":
        from pa_agent.data.baostock_source import BaostockSource

        return BaostockSource()
    if normalized == "eastmoney":
        from pa_agent.data.eastmoney_source import EastMoneySource

        return EastMoneySource()
    if normalized == "akshare":
        from pa_agent.data.akshare_source import AkShareSource

        return AkShareSource()
    if normalized == "yfinance":
        from pa_agent.data.yfinance_source import YFinanceSource

        return YFinanceSource()
    from pa_agent.data.mt5 import MT5Source

    return MT5Source()
