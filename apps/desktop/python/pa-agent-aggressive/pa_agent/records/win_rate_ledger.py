"""Win-rate calibration ledger for PA Agent trade records.

Settles pending order-opportunity rows in ``trade_records/*.csv`` against
subsequent K-line bars, then produces a calibration report that compares the
model's self-assessed ``estimated_win_rate`` against actual outcomes.

Result rules (documented in the project analysis docs)
------------------------------------------------------
For a long entry with prices (entry, stop, tp1[, tp2]):

* Scan closed bars with ``ts_open > entry_ts_ms``, oldest first.
* A bar whose high >= tp1 (or tp2) => win (TP hit). Whichever TP is nearest to
  entry is the trigger level for the same-bar both-hit disambiguation.
* A bar whose low <= stop => loss (SL hit).
* If one bar touches both TP and SL:
    - the closer level (in price distance from entry) is assumed hit first;
      ties go to TP (win).
* If no touch within ``max_hold_bars`` closed bars => expire; the side of the
  last close relative to entry is recorded in ``outcome_detail``.
* Bars that have not closed yet (``ts_open + duration > now_ms``) are skipped.

Short entries mirror the rules (low <= tp => win, high >= stop => loss).

Everything is best-effort: malformed prices, missing timestamps or no bars
after entry are recorded as ``insufficient`` with a reason in
``outcome_detail`` — never a false positive/negative.
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

# Default hold window in closed bars before a position is marked expired.
DEFAULT_MAX_HOLD_BARS = 30

# Timeframe string -> duration in seconds.
_TF_SECONDS = {
    "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800,
}


def bar_duration_seconds(timeframe: str) -> int | None:
    """Map a timeframe label to bar duration in seconds (best effort)."""
    tf = (timeframe or "").strip().lower()
    if tf in _TF_SECONDS:
        return _TF_SECONDS[tf]
    import re
    m = re.fullmatch(r"(\d+)([mhdw])", tf)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        base = {"m": 60, "h": 3600, "d": 86400, "w": 604800}[unit]
        return n * base
    return None


# ── Parsing helpers ──────────────────────────────────────────────────────────

def _f(value: object) -> float | None:
    """Parse a numeric value (also from strings / ranges)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return v if v > 0 else None
    text = str(value).strip()
    if not text:
        return None
    import re
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if not m:
        return None
    v = float(m.group(1))
    return v if v > 0 else None


def _direction_is_long(order_direction: object) -> bool:
    text = str(order_direction or "").lower()
    if "short" in text or "做空" in text or "sell" in text:
        return False
    if "long" in text or "做多" in text or "buy" in text:
        return True
    # Ambiguous/empty -> treat as long (best effort; documented).
    return True


def _bars_from_input(bars_newest_first: Iterable[Any]) -> list[dict]:
    """Normalize KlineBar / dict input into oldest->newest dict list."""
    out: list[dict] = []
    for b in bars_newest_first:
        if b is None:
            continue
        if hasattr(b, "ts_open"):
            out.append(
                {
                    "ts_open": float(b.ts_open),
                    "high": float(b.high),
                    "low": float(b.low),
                    "close": float(b.close),
                }
            )
        elif isinstance(b, dict):
            ts = b.get("ts_open")
            if ts is None:
                continue
            out.append(
                {
                    "ts_open": float(ts),
                    "high": float(b.get("high") or 0),
                    "low": float(b.get("low") or 0),
                    "close": float(b.get("close") or 0),
                }
            )
    out.sort(key=lambda x: x["ts_open"])  # oldest -> newest
    return out


# ── Core settlement ──────────────────────────────────────────────────────────

def settle_record(
    row: dict,
    bars_newest_first: Iterable[Any],
    *,
    now_ms: int | None = None,
    max_hold_bars: int = DEFAULT_MAX_HOLD_BARS,
    timeframe: str | None = None,
) -> dict:
    """Settle one CSV row against subsequent bars.

    Returns a dict with settle_status / outcome_detail / settle_bars /
    settle_price. Never mutates the input row.
    """
    import time as _time

    if now_ms is None:
        now_ms = int(_time.time() * 1000)

    entry_ts = _f(row.get("entry_ts_ms"))
    entry = _f(row.get("entry_price"))
    stop = _f(row.get("stop_loss_price"))
    tp1 = _f(row.get("take_profit_price"))
    tp2 = _f(row.get("take_profit_price_2"))
    is_long = _direction_is_long(row.get("order_direction"))

    missing = []
    if entry_ts is None:
        missing.append("entry_ts_ms")
    if entry is None:
        missing.append("entry_price")
    if stop is None:
        missing.append("stop_loss_price")
    if tp1 is None and tp2 is None:
        missing.append("take_profit_price")
    if missing:
        return {
            "settle_status": "insufficient",
            "outcome_detail": "no " + ",".join(missing),
            "settle_bars": "",
            "settle_price": "",
        }

    dur_s = bar_duration_seconds(timeframe or str(row.get("timeframe") or ""))
    bars = _bars_from_input(bars_newest_first)

    # Closed bars strictly after the entry bar.
    future: list[dict] = []
    for b in bars:
        if b["ts_open"] <= entry_ts:
            continue
        if dur_s and b["ts_open"] + dur_s * 1000 > now_ms:
            continue  # forming bar, not closed yet
        future.append(b)

    if not future:
        return {
            "settle_status": "insufficient",
            "outcome_detail": "no closed data after entry",
            "settle_bars": "",
            "settle_price": "",
        }

    # Effective TP: nearest TP above (long) / below (short) entry; use tp1 by
    # default when both exist unless tp2 is closer.
    tps = [t for t in (tp1, tp2) if t is not None]
    if is_long:
        tps = [t for t in tps if t > entry]
        tp = min(tps, key=lambda t: abs(t - entry)) if tps else None
    else:
        tps = [t for t in tps if t < entry]
        tp = min(tps, key=lambda t: abs(t - entry)) if tps else None

    if tp is None:
        return {
            "settle_status": "insufficient",
            "outcome_detail": "no TP on trade side",
            "settle_bars": "",
            "settle_price": "",
        }

    held = 0
    for b in future:
        held += 1
        hi, lo = b["high"], b["low"]
        if is_long:
            tp_hit = hi >= tp
            sl_hit = lo <= stop
            if tp_hit and sl_hit:
                d_tp, d_sl = abs(tp - entry), abs(stop - entry)
                if d_tp <= d_sl:  # nearer level assumed first; ties -> TP
                    return {
                        "settle_status": "win",
                        "outcome_detail": "TP hit (same bar touched SL, TP nearer)",
                        "settle_bars": str(held),
                        "settle_price": f"{tp:.6g}",
                    }
                return {
                    "settle_status": "loss",
                    "outcome_detail": "SL hit (same bar touched TP, SL nearer)",
                    "settle_bars": str(held),
                    "settle_price": f"{stop:.6g}",
                }
            if tp_hit:
                return {
                    "settle_status": "win",
                    "outcome_detail": "TP hit",
                    "settle_bars": str(held),
                    "settle_price": f"{tp:.6g}",
                }
            if sl_hit:
                return {
                    "settle_status": "loss",
                    "outcome_detail": "SL hit",
                    "settle_bars": str(held),
                    "settle_price": f"{stop:.6g}",
                }
        else:
            tp_hit = lo <= tp
            sl_hit = hi >= stop
            if tp_hit and sl_hit:
                d_tp, d_sl = abs(tp - entry), abs(stop - entry)
                if d_tp <= d_sl:
                    return {
                        "settle_status": "win",
                        "outcome_detail": "TP hit (same bar touched SL, TP nearer)",
                        "settle_bars": str(held),
                        "settle_price": f"{tp:.6g}",
                    }
                return {
                    "settle_status": "loss",
                    "outcome_detail": "SL hit (same bar touched TP, SL nearer)",
                    "settle_bars": str(held),
                    "settle_price": f"{stop:.6g}",
                }
            if tp_hit:
                return {
                    "settle_status": "win",
                    "outcome_detail": "TP hit",
                    "settle_bars": str(held),
                    "settle_price": f"{tp:.6g}",
                }
            if sl_hit:
                return {
                    "settle_status": "loss",
                    "outcome_detail": "SL hit",
                    "settle_bars": str(held),
                    "settle_price": f"{stop:.6g}",
                }
        if held >= max_hold_bars:
            last_close = b["close"]
            side = "above" if (last_close > entry) else ("below" if last_close < entry else "at")
            return {
                "settle_status": "expire",
                "outcome_detail": f"expire after {held} bars: close {side} entry",
                "settle_bars": str(held),
                "settle_price": f"{last_close:.6g}",
            }

    return {
        "settle_status": "expire",
        "outcome_detail": f"expire after {held} bars: no touch in window",
        "settle_bars": str(held),
        "settle_price": "",
    }


# ── CSV batch settlement ─────────────────────────────────────────────────────

def settle_csv(
    csv_path: str | Path,
    bars_newest_first: Iterable[Any],
    *,
    now_ms: int | None = None,
    max_hold_bars: int = DEFAULT_MAX_HOLD_BARS,
) -> dict:
    """Settle every unsolved row in one trade CSV and rewrite it in place.

    Returns a small summary dict. Only rows whose ``settle_status`` is empty
    or 'pending' are touched; already settled rows are left untouched.
    """
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(path)
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = reader.fieldnames or []
    if not fieldnames:
        return {"total": 0, "settled": 0, "skipped": 0}

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    settled = skipped = 0
    for row in rows:
        status = (row.get("settle_status") or "").strip()
        if status in ("win", "loss", "expire"):
            skipped += 1
            continue
        result = settle_record(
            row,
            bars_newest_first,
            now_ms=now_ms,
            max_hold_bars=max_hold_bars,
        )
        row["settle_status"] = result["settle_status"]
        row["outcome_detail"] = result["outcome_detail"]
        row["settle_bars"] = result["settle_bars"]
        row["settle_price"] = result["settle_price"]
        row["settled_at"] = now
        settled += 1

    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        # Ensure settlement columns exist in the header even for legacy CSVs,
        # otherwise DictWriter would silently drop the settled values.
        merged_fields = list(fieldnames)
        for col in (
            "settle_status", "outcome_detail",
            "settle_bars", "settle_price", "settled_at",
        ):
            if col not in merged_fields:
                merged_fields.append(col)
        writer = csv.DictWriter(f, fieldnames=merged_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return {"total": len(rows), "settled": settled, "skipped": skipped}


# ── Calibration report ───────────────────────────────────────────────────────

def _win_rate_bucket(ewr: object) -> str:
    """Bucket a self-assessed win rate (%) into coarse bands."""
    v = _f(ewr)
    if v is None:
        return "未填"
    if v < 40:
        return "<40%"
    if v < 55:
        return "40–55%"
    if v < 70:
        return "55–70%"
    return "≥70%"


def build_calibration_report(csv_dir: str | Path) -> str:
    """Aggregate all settled rows across trade_records CSV files.

    Returns a markdown calibration report comparing self-assessed win rate
    vs actual outcome, plus breakdowns by direction / cycle position.
    """
    directory = Path(csv_dir)
    if not directory.is_dir():
        raise NotADirectoryError(directory)

    settled: list[dict] = []
    for csv_path in sorted(directory.glob("*.csv")):
        with open(csv_path, encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        for r in rows:
            st = (r.get("settle_status") or "").strip()
            if st in ("win", "loss"):
                settled.append(r)

    lines: list[str] = []
    lines.append("# PA Agent 胜率校准报告")
    lines.append("")
    lines.append(f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"- 已结算样本数（win/loss）：**{len(settled)}**")
    lines.append(
        "- 口径：仅统计已触发 TP（win）或 SL（loss）的样本；expire/insufficient 不计入胜率"
    )
    lines.append("")

    if not settled:
        lines.append("> 暂无已结算样本。决策后随 K 线滚动更新，或手动运行 settle。")
        return "\n".join(lines)

    # ── Overall ────────────────────────────────────────────────────────────
    wins = sum(1 for r in settled if r.get("settle_status") == "win")
    overall = wins / len(settled) * 100
    lines.append("## 总览")
    lines.append("")
    lines.append(f"| 指标 | 值 |")
    lines.append(f"|------|-----|")
    lines.append(f"| 样本数 | {len(settled)} |")
    lines.append(f"| 实际胜率 | {overall:.1f}% |")
    lines.append(f"| 平均自评胜率 | {sum(float(_f(r.get('estimated_win_rate')) or 0) for r in settled) / len(settled):.1f}% |")
    lines.append("")

    # ── By self-assessed bucket ────────────────────────────────────────────
    lines.append("## 自评胜率 vs 实际胜率（校准表）")
    lines.append("")
    lines.append("| 自评区间 | 样本 | 实际胜率 | 偏差 |")
    lines.append("|----------|------|----------|------|")
    order = ["<40%", "40–55%", "55–70%", "≥70%", "未填"]
    buckets: dict[str, list[dict]] = {b: [] for b in order}
    for r in settled:
        buckets[_win_rate_bucket(r.get("estimated_win_rate"))].append(r)
    for b in order:
        rows_b = buckets.get(b, [])
        if not rows_b:
            continue
        bw = sum(1 for r in rows_b if r.get("settle_status") == "win")
        bwr = bw / len(rows_b) * 100
        mid = {"<40%": 35.0, "40–55%": 47.5, "55–70%": 62.5, "≥70%": 80.0}.get(b)
        dev = f"{bwr - mid:+.1f}pp" if mid is not None else "—"
        lines.append(f"| {b} | {len(rows_b)} | {bwr:.1f}% | {dev} |")
    lines.append("")
    lines.append("> 偏差 = 实际胜率 − 桶中值。**正偏差** = 模型低估自己；**负偏差** = 模型高估自己。")
    lines.append("")

    # ── By direction ───────────────────────────────────────────────────────
    lines.append("## 按方向")
    lines.append("")
    lines.append("| 方向 | 样本 | 实际胜率 |")
    lines.append("|------|------|----------|")
    for label, key in (("做多", True), ("做空", False)):
        grp = [r for r in settled if _direction_is_long(r.get("order_direction")) == key]
        if not grp:
            continue
        gw = sum(1 for r in grp if r.get("settle_status") == "win")
        lines.append(f"| {label} | {len(grp)} | {gw / len(grp) * 100:.1f}% |")
    lines.append("")

    # ── By cycle position ──────────────────────────────────────────────────
    lines.append("## 按结构位（diag_cycle_position）")
    lines.append("")
    lines.append("| 结构位 | 样本 | 实际胜率 |")
    lines.append("|--------|------|----------|")
    by_cp: dict[str, list[dict]] = {}
    for r in settled:
        cp = (r.get("diag_cycle_position") or "未知").strip() or "未知"
        by_cp.setdefault(cp, []).append(r)
    for cp, grp in sorted(by_cp.items(), key=lambda kv: -len(kv[1])):
        cw = sum(1 for r in grp if r.get("settle_status") == "win")
        lines.append(f"| {cp} | {len(grp)} | {cw / len(grp) * 100:.1f}% |")
    lines.append("")

    # ── Recent settled rows (trace) ────────────────────────────────────────
    lines.append("## 最近已结算明细")
    lines.append("")
    lines.append("| 时间 | 品种/周期 | 方向 | 自评胜率 | 结果 | 明细 |")
    lines.append("|------|-----------|------|----------|------|------|")
    recent = sorted(settled, key=lambda r: r.get("record_time", ""), reverse=True)[:15]
    for r in recent:
        lines.append(
            "| {} | {} / {} | {} | {}% | {} | {} |".format(
                r.get("record_time", ""),
                r.get("symbol", ""),
                r.get("timeframe", ""),
                "多" if _direction_is_long(r.get("order_direction")) else "空",
                _f(r.get("estimated_win_rate")) or "—",
                r.get("settle_status", ""),
                (r.get("outcome_detail") or "").replace("|", "\\|"),
            )
        )
    lines.append("")
    return "\n".join(lines)


# ── CLI ──────────────────────────────────────────────────────────────────────

def _load_bars_json(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("bars"), list):
        return data["bars"]
    raise ValueError("bars-json must be a list of bars or {bars: [...]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="win_rate_ledger")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_settle = sub.add_parser("settle", help="Settle pending rows in one CSV")
    p_settle.add_argument("--csv", required=True, help="trade_records/<sym>_<tf>.csv")
    p_settle.add_argument("--bars-json", required=True, help="JSON file with bars (newest-first OK)")
    p_settle.add_argument("--max-hold-bars", type=int, default=DEFAULT_MAX_HOLD_BARS)

    p_report = sub.add_parser("report", help="Build calibration report from a trade_records dir")
    p_report.add_argument("--csv-dir", required=True)
    p_report.add_argument("--out", default="", help="Optional .md output path")

    args = parser.parse_args(argv)
    if args.cmd == "settle":
        summary = settle_csv(args.csv, _load_bars_json(args.bars_json),
                             max_hold_bars=args.max_hold_bars)
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    if args.cmd == "report":
        text = build_calibration_report(args.csv_dir)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
            print(f"report saved: {args.out}")
        else:
            print(text)
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
