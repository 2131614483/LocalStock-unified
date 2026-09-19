"""Instrument classes (品种类别) — 股票 / 指数 / 外汇 / 期货 / 加密货币.

The toolbar's 「代码」 box holds a concrete instrument id (``600519``,
``XAUUSDm``, ``BTC-USD`` …).  This module supplies the *category* dimension:
a small, stable vocabulary plus best-effort auto-detection, so the UI can

* offer category-appropriate preset codes, and
* warn when a typed code clearly belongs to a different category.

Detection is deliberately conservative: anything not confidently recognised
returns ``None`` and produces no warning, so unusual broker symbols never
trigger false alarms.
"""
from __future__ import annotations

import re
from typing import Literal

InstrumentClass = Literal["stock", "index", "forex", "futures", "crypto"]

#: Order matters — this is the order shown in the UI dropdown.
INSTRUMENT_CLASSES: tuple[InstrumentClass, ...] = (
    "stock",
    "index",
    "forex",
    "futures",
    "crypto",
)

INSTRUMENT_CLASS_LABELS: dict[str, str] = {
    "stock": "股票",
    "index": "指数",
    "forex": "外汇",
    "futures": "期货",
    "crypto": "加密货币",
}

DEFAULT_INSTRUMENT_CLASS: InstrumentClass = "stock"

#: Starting-point codes per class.  The toolbar's code box stays editable, so
#: these are suggestions rather than a hard whitelist.
CLASS_PRESET_SYMBOLS: dict[str, tuple[str, ...]] = {
    "stock": ("000001", "600519", "600015", "002594", "300750", "601398"),
    "index": ("000300", "399006", "000016", "000905", "000852", "399001"),
    "forex": ("XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAGUSD"),
    "futures": ("GC=F", "CL=F", "ES=F", "NQ=F", "SI=F"),
    "crypto": ("BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"),
}

# A-share index codes that are NOT covered by ashare_common._is_index_digits —
# the 399xxx family (深证成指/创业板指) is index-only, while 000xxx is shared
# with Shenzhen stocks, so the common ones are enumerated explicitly.
_ASHARE_INDEX_RE = re.compile(r"^(000300|000016|000905|000852|000010|000009|399\d{3})$")
_ASHARE_CODE_RE = re.compile(r"^\d{6}$")
_MARKET_PREFIX_RE = re.compile(r"^(sh|sz)(\d{6})$", re.IGNORECASE)

#: Quote currencies seen in broker FX/metals symbols (XAUUSD, EURUSDm, …).
_FX_QUOTES = ("USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF", "CNH", "HKD")

_CRYPTO_TOKENS = ("BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "USDT", "USDC")


def class_label(inst_class: str) -> str:
    """Chinese label for *inst_class* (falls back to the raw value)."""
    return INSTRUMENT_CLASS_LABELS.get(str(inst_class), str(inst_class))


def normalize_class(value: object) -> InstrumentClass:
    """Coerce *value* into a valid class, defaulting when unknown."""
    text = str(value or "").strip().lower()
    if text in INSTRUMENT_CLASS_LABELS:
        return text  # type: ignore[return-value]
    return DEFAULT_INSTRUMENT_CLASS


def preset_symbols(inst_class: str) -> tuple[str, ...]:
    """Preset codes suggested for *inst_class*."""
    return CLASS_PRESET_SYMBOLS.get(normalize_class(inst_class), ())


def detect_instrument_class(symbol: object) -> InstrumentClass | None:
    """Best-effort category for *symbol*; ``None`` when not confident.

    Returning ``None`` is the safe default — callers only warn on a confident
    mismatch, so exotic broker tickers stay silent.
    """
    raw = str(symbol or "").strip()
    if not raw:
        return None

    # ── A-share / CSI ────────────────────────────────────────────────────────
    m = _MARKET_PREFIX_RE.match(raw)
    digits = m.group(2) if m else raw
    if _ASHARE_CODE_RE.match(digits):
        if m is not None:
            return "index"          # sh000300 / sz399006 style
        return "index" if _ASHARE_INDEX_RE.match(digits) else "stock"

    up = raw.upper()

    # ── Crypto ───────────────────────────────────────────────────────────────
    if up.endswith(("-USD", "-USDT", "USDT", "/USDT", "-PERP")):
        return "crypto"
    if any(tok in up for tok in _CRYPTO_TOKENS) and any(
        q in up for q in ("USD", "USDT", "USDC")
    ):
        return "crypto"

    # ── Futures (yfinance continuous contracts) ──────────────────────────────
    if up.endswith("=F") or up.endswith("=X"):
        return "futures"

    # ── Forex / metals (broker style: base+quote, optional suffix) ───────────
    core = up.rstrip("M") if up.endswith("M") else up
    if 6 <= len(core) <= 8 and core.isalpha():
        for quote in _FX_QUOTES:
            if core.endswith(quote) and len(core) > len(quote):
                return "forex"

    return None


def class_mismatch_reason(symbol: object, selected_class: object) -> str | None:
    """Human-readable warning when *symbol* clearly isn't *selected_class*.

    ``None`` means "fine, or not confidently classifiable".
    """
    detected = detect_instrument_class(symbol)
    if detected is None:
        return None
    want = normalize_class(selected_class)
    if detected == want:
        return None
    return (
        f"代码「{str(symbol).strip()}」看起来属于"
        f"「{class_label(detected)}」，与所选品种「{class_label(want)}」不一致"
    )
