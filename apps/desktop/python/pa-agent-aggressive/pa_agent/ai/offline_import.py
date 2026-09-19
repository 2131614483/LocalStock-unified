"""Import model replies produced by the OFFLINE (no-API) workflow.

Offline packs (``导出离线包``) are pasted into a chat LLM, which replies with raw
JSON.  This module turns such a reply back into a first-class analysis record so
the result can be validated, archived and replayed in the GUI — instead of
staying as dead text.

Pipeline (shared by the GUI dialog and the ``tools/parse_offline_output.py`` CLI):

  1. Extract every JSON object from messy text (prose / ```json fences / several
     blocks concatenated are all tolerated).
  2. Classify each block as Stage 1 (diagnosis) or Stage 2 (decision).
  3. Validate + normalize through the project's own ``JsonValidator`` — identical
     treatment to the API path.
  4. Run the sanity checks the offline path skips (no program node-injection
     happened, so we re-derive those invariants by hand).
  5. Optionally rebuild a full ``AnalysisRecord``, recovering K-line data from
     the offline pack's own K-line table.

The K-line table's 时间 column is UTC ``%Y-%m-%d %H:%M`` (see
``pa_agent.data.datetime_ts.format_epoch_for_display``), so it round-trips back
to ``ts_open`` epoch-ms exactly.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Mirror of decision_nodes._CYCLE_ORDER_METHOD / router.py — used for the
# offline sanity check that the model picked a method consistent with the cycle.
_EXPECTED_ORDER_METHOD = {
    "spike": "市价单",
    "micro_channel": "突破单",
    "tight_channel": "突破单",
    "normal_channel": "突破单",
    "broad_channel": "限价单",
    "trending_tr": "突破单",
    "trading_range": "限价单",
    "extreme_tr": "不下单",
    "unknown": "不下单",
}

# Nodes the API path computes and injects; absent in offline output by design.
_PROGRAM_NODES = {"1.1", "2.3", "2.4", "9.1", "9.2", "9.3", "11.1", "11.2", "11.3", "11.4"}
_REPORTED_MISSING = {"9.2", "9.3", "11.1", "11.2", "11.3", "11.4"}

_ORDER_TYPES = ("限价单", "突破单", "市价单", "不下单")


# ── Extraction & classification ───────────────────────────────────────────────

def extract_json_objects(text: str) -> list[dict]:
    """Return every top-level JSON object found in *text*, in order.

    Scans for balanced braces while ignoring braces inside string literals and
    escapes, so prose and markdown fences around the JSON are harmless.
    """
    cleaned = re.sub(r"```[a-zA-Z]*\s*", "", text).replace("```", "")
    objects: list[dict] = []
    depth = 0
    start = -1
    in_str = False
    esc = False

    for i, ch in enumerate(cleaned):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    chunk = cleaned[start : i + 1]
                    try:
                        parsed = json.loads(chunk)
                    except json.JSONDecodeError:
                        parsed = None
                    if isinstance(parsed, dict):
                        objects.append(parsed)
                    start = -1
    return objects


def classify(obj: dict) -> str:
    """Return 'stage2' | 'stage1' | 'unknown' from distinctive top-level keys."""
    if any(k in obj for k in ("decision", "decision_trace", "terminal")):
        return "stage2"
    if "gate_trace" in obj or "gate_result" in obj:
        return "stage1"
    if "cycle_position" in obj:
        return "stage1"
    return "unknown"


# ── K-line recovery from a pack's K-line table ────────────────────────────────

_KLINE_ROW_RE = re.compile(
    r"^\s*(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*\|\s*"
    r"([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*"
    r"(\S+)\s*\|\s*(\d+)\s*\|"
)


def parse_pack_klines(pack_text: str) -> tuple[list[dict], dict]:
    """Recover ``kline_data`` (newest-first) plus pack metadata from pack text."""
    bars: list[dict] = []
    for line in pack_text.splitlines():
        m = _KLINE_ROW_RE.match(line)
        if not m:
            continue
        seq, ts_txt, o, h, l, c, _yinyang, vol = m.groups()
        dt = datetime.strptime(ts_txt, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        bars.append({
            "seq": int(seq),
            "ts_open": int(dt.timestamp() * 1000),
            "open": float(o),
            "high": float(h),
            "low": float(l),
            "close": float(c),
            "volume": float(vol),
            "amount": 0.0,
            "pct_chg": None,
            "closed": True,
        })

    meta: dict[str, Any] = {}
    for key, pattern in (
        ("symbol", r"品种\s*:\s*(\S+)"),
        ("timeframe", r"周期\s*:\s*(\S+)"),
        ("decision_stance", r"交易倾向\s*:\s*(\S+)"),
    ):
        m = re.search(pattern, pack_text)
        if m:
            meta[key] = m.group(1)
    meta["bar_count"] = len(bars)
    return bars, meta


def read_pack(path: str | Path) -> tuple[list[dict], dict]:
    """Read one pack file; never raises — returns ([], {}) on failure."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        logger.warning("无法读取离线包 %s: %s", path, exc)
        return [], {}
    return parse_pack_klines(text)


# ── Validation & sanity ───────────────────────────────────────────────────────

@dataclass
class BlockResult:
    """Outcome for a single extracted JSON object."""

    index: int
    stage: str
    ok: bool
    raw: dict
    normalized: dict | None = None
    error: str = ""
    category: str = ""
    missing_fields: list[str] = field(default_factory=list)
    invalid_fields: list[str] = field(default_factory=list)


def validate_blocks(blocks: list[dict], *, kline_frame: Any = None) -> list[BlockResult]:
    """Normalize + validate each block through the project's JsonValidator.

    A ``kline_frame`` is passed through when known so the validator can run its
    bar-reference checks (e.g. signal-bar ordering) against real bars.
    """
    from pa_agent.ai.json_validator import JsonValidator, Ok

    validator = JsonValidator()
    out: list[BlockResult] = []
    for idx, obj in enumerate(blocks, 1):
        stage = classify(obj)
        if stage == "unknown":
            out.append(BlockResult(
                index=idx, stage=stage, ok=False, raw=obj,
                error="无法识别为阶段一或阶段二 JSON（缺少 decision / gate_trace 等特征字段）",
            ))
            continue

        norm = validator.normalize_parsed(
            stage, obj, decision_stance=None,
            kline_frame=kline_frame, stage1_json=None,
        )
        res = validator.validate(
            stage, json.dumps(norm, ensure_ascii=False),
            decision_stance=None, kline_frame=kline_frame, stage1_json=None,
        )
        if isinstance(res, Ok):
            out.append(BlockResult(idx, stage, True, obj, norm))
        else:
            out.append(BlockResult(
                index=idx, stage=stage, ok=False, raw=obj, normalized=norm,
                error=str(getattr(res, "message", "校验失败")),
                category=str(getattr(res, "category", "?")),
                missing_fields=list(getattr(res, "missing_fields", []) or []),
                invalid_fields=list(getattr(res, "invalid_fields", []) or []),
            ))
    return out


def sanity_checks(obj: dict) -> list[str]:
    """Checks the API path performs via program nodes — recomputed by hand."""
    if not isinstance(obj, dict):
        return []
    out: list[str] = []
    dec = obj.get("decision") or {}
    if not isinstance(dec, dict):
        return ["❌ decision 字段不是对象"]

    order_type = str(dec.get("order_type") or "")
    direction = dec.get("order_direction")
    prices = {k: dec.get(k) for k in
              ("entry_price", "stop_loss_price", "take_profit_price")}

    # ① 无单铁律
    if order_type == "不下单":
        stray = [k for k, v in prices.items() if v is not None]
        if direction is not None:
            stray.append("order_direction")
        if stray:
            out.append(f"❌ 无单铁律违反：不下单但 {stray} 非 null")
    else:
        missing = [k for k, v in prices.items() if v is None]
        if missing:
            out.append(f"❌ 下单但价格缺失：{missing}")
        if direction is None:
            out.append("❌ 下单但 order_direction 为 null")

    # ② 盈亏比 + 交易者方程复算
    if order_type != "不下单" and not any(v is None for v in prices.values()):
        try:
            e = float(prices["entry_price"])
            s = float(prices["stop_loss_price"])
            t = float(prices["take_profit_price"])
            is_long = "做多" in str(direction)
            risk = (e - s) if is_long else (s - e)
            reward = (t - e) if is_long else (e - t)
            if risk <= 0:
                out.append(f"❌ 止损方向错误：entry={e} stop={s}（{direction}）")
            else:
                rr = reward / risk
                out.append(f"{'✅' if 1.0 <= rr <= 1.5 else '⚠️'} 盈亏比 RR = {rr:.2f}（要求 1.0–1.5）")
                wr = dec.get("estimated_win_rate")
                if isinstance(wr, (int, float)):
                    p = float(wr) / 100.0
                    lhs, rhs = p * reward, (1 - p) * risk
                    out.append(
                        f"{'✅' if lhs > rhs else '❌'} 交易者方程："
                        f"{p:.2f}×{reward:.4g}={lhs:.4g} {'>' if lhs > rhs else '≤'} "
                        f"{1 - p:.2f}×{risk:.4g}={rhs:.4g}"
                    )
        except (TypeError, ValueError):
            out.append("⚠️ 三价无法转为数值，跳过盈亏比/方程复算")

    # ③ 下单方式 vs 周期（程序 §11 路由）
    cp = (obj.get("diagnosis_summary") or {}).get("cycle_position")
    if cp and order_type and order_type != "不下单":
        expected = _EXPECTED_ORDER_METHOD.get(str(cp))
        if expected and expected != order_type:
            out.append(
                f"⚠️ 下单方式与周期不匹配：cycle_position={cp} 程序应路由到"
                f"「{expected}」，但模型给了「{order_type}」"
            )

    # ④ trace 缺少程序节点
    trace = obj.get("decision_trace") or []
    present = {str(t.get("node_id")) for t in trace if isinstance(t, dict)}
    missing_prog = sorted(_REPORTED_MISSING - present)
    if missing_prog:
        out.append(
            f"ℹ️ 缺少程序节点 {missing_prog} —— 离线路径无程序注入，API 路径会自动补齐"
        )

    # ⑤ terminal 一致性
    outcome = (obj.get("terminal") or {}).get("outcome")
    if order_type == "不下单" and outcome == "trade":
        out.append("❌ terminal.outcome=trade 但 order_type=不下单")
    if order_type and order_type != "不下单" and outcome in ("wait", "reject"):
        out.append(f"❌ 有下单但 terminal.outcome={outcome}")

    return out


# ── Summaries ─────────────────────────────────────────────────────────────────

def summarize_stage1(obj: dict) -> list[str]:
    return [
        f"  周期/方向   : {obj.get('cycle_position', '?')} / {obj.get('direction', '?')}",
        f"  闸门结果    : {obj.get('gate_result', '?')}",
        f"  置信度      : {obj.get('diagnosis_confidence', '?')}",
        f"  形态        : {', '.join(obj.get('detected_patterns') or []) or '（无）'}",
        f"  gate 节点数  : {len(obj.get('gate_trace') or [])}",
    ]


def summarize_stage2(obj: dict) -> list[str]:
    dec = obj.get("decision") or {}
    diag = obj.get("diagnosis_summary") or {}
    term = obj.get("terminal") or {}
    lines = [
        f"  周期/方向   : {diag.get('cycle_position', '?')} / {diag.get('direction', '?')}",
        f"  下单        : {dec.get('order_type', '?')}  {dec.get('order_direction') or ''}".rstrip(),
        f"  入场/止损/止盈: {dec.get('entry_price')} / "
        f"{dec.get('stop_loss_price')} / {dec.get('take_profit_price')}",
        f"  信心/胜率   : trade_confidence={dec.get('trade_confidence')}  "
        f"estimated_win_rate={dec.get('estimated_win_rate')}",
        f"  终局        : §{term.get('node_id', '?')} → {term.get('outcome', '?')}",
        f"  trace 节点数 : {len(obj.get('decision_trace') or [])}",
    ]
    ncp = obj.get("next_cycle_prediction")
    if isinstance(ncp, dict) and ncp.get("cycle"):
        lines.append(f"  下周期预测   : {ncp.get('cycle')} / {ncp.get('direction')}")
    return lines


# ── Record assembly ───────────────────────────────────────────────────────────

def build_record(
    stage1: dict | None,
    stage2: dict | None,
    kline_data: list[dict],
    *,
    symbol: str,
    timeframe: str,
    decision_stance: str = "balanced",
    model_name: str = "offline/manual-upload",
):
    """Assemble a loadable AnalysisRecord (replayable via 演示模式)."""
    from pa_agent.records.schema import AnalysisRecord, RecordMeta

    return AnalysisRecord(
        meta=RecordMeta(
            timestamp_local_iso=datetime.now().isoformat(),
            timestamp_local_ms=int(datetime.now().timestamp() * 1000),
            symbol=symbol,
            timeframe=timeframe,
            bar_count=len(kline_data),
            ai_provider={
                "model": model_name,
                "base_url": "offline://manual",
                "api_key": "",
                "thinking": False,
                "reasoning_effort": "-",
                "context_window": 0,
            },
            decision_stance=decision_stance,
        ),
        kline_data=kline_data,
        htf_text="",
        stage1_messages=[],
        stage1_response=None,
        stage1_diagnosis=stage1,
        stage2_messages=[],
        stage2_response=None,
        stage2_decision=stage2,
        strategy_files_used=[],
        experience_loaded=[],
        exception=None,
        usage_total={},
    )


# ── High-level entry point ────────────────────────────────────────────────────

@dataclass
class ImportResult:
    """Everything the caller needs to report and archive an imported reply."""

    blocks: list[BlockResult]
    sanity: list[str]
    kline_data: list[dict]
    symbol: str
    timeframe: str
    decision_stance: str
    pack_path: Path | None = None

    @property
    def stage1(self) -> dict | None:
        for b in self.blocks:
            if b.stage == "stage1" and b.normalized is not None:
                return b.normalized
        return None

    @property
    def stage2(self) -> dict | None:
        for b in self.blocks:
            if b.stage == "stage2" and b.normalized is not None:
                return b.normalized
        return None

    @property
    def all_ok(self) -> bool:
        return bool(self.blocks) and all(b.ok for b in self.blocks)

    def report_lines(self) -> list[str]:
        """Human-readable report body (shared by GUI dialog and CLI)."""
        lines: list[str] = []
        for b in self.blocks:
            head = "✅ 校验通过" if b.ok else "❌ 校验失败"
            lines.append(f"[{b.index}] {b.stage}   {head}")
            if not b.ok:
                lines.append(f"    错误类别 : {b.category or '-'}")
                lines.append(f"    说明     : {b.error}")
                if b.missing_fields:
                    lines.append(f"    缺字段   : {', '.join(b.missing_fields)}")
                if b.invalid_fields:
                    lines.append(f"    非法字段 : {', '.join(b.invalid_fields)}")
                continue
            obj = b.normalized or {}
            lines.extend(
                summarize_stage1(obj) if b.stage == "stage1" else summarize_stage2(obj)
            )
        if self.sanity:
            lines.append("")
            lines.append("离线路径补充检查（API 路径由程序节点自动完成）：")
            lines.extend(f"    {c}" for c in self.sanity)
        elif self.stage2 is not None:
            lines.append("")
            lines.append("离线路径补充检查：✅ 未发现问题")
        return lines


def find_latest_pack(*, base: Path | None = None) -> Path | None:
    """Return the newest ``01_阶段一_*.txt`` in offline_packs/, or None."""
    from pa_agent.config.paths import OFFLINE_PACK_DIR

    root = Path(base) if base is not None else OFFLINE_PACK_DIR
    if not root.is_dir():
        return None
    candidates = sorted(
        (p for d in root.iterdir() if d.is_dir() for p in d.glob("01_*.txt")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def import_model_reply(
    text: str,
    *,
    pack_path: Path | str | None = None,
    symbol: str = "",
    timeframe: str = "",
) -> ImportResult:
    """Parse *text*, validate it, and recover K-lines from *pack_path*.

    Raises ``ValueError`` when no JSON object can be found.
    """
    blocks = extract_json_objects(text)
    if not blocks:
        raise ValueError("未找到任何 JSON 对象——请确认已粘贴大模型返回的完整内容")

    kline_data: list[dict] = []
    pack_meta: dict[str, Any] = {}
    pack_used: Path | None = None
    if pack_path:
        kline_data, pack_meta = read_pack(pack_path)
        if kline_data:
            pack_used = Path(pack_path)

    frame = None
    if kline_data:
        try:
            from pa_agent.demo.record_loader import frame_from_record_klines

            frame = frame_from_record_klines(
                kline_data,
                symbol=symbol or pack_meta.get("symbol", "unknown"),
                timeframe=timeframe or pack_meta.get("timeframe", "unknown"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("从离线包重建 KlineFrame 失败，降级为不校验 K 线引用: %s", exc)

    results = validate_blocks(blocks, kline_frame=frame)
    stage2 = next((b.normalized for b in results if b.stage == "stage2" and b.normalized), None)

    stance = str(pack_meta.get("decision_stance", "") or "")
    if stance not in ("conservative", "balanced", "aggressive", "extreme_aggressive"):
        stance = "balanced"

    return ImportResult(
        blocks=results,
        sanity=sanity_checks(stage2) if isinstance(stage2, dict) else [],
        kline_data=kline_data,
        symbol=symbol or str(pack_meta.get("symbol", "unknown")),
        timeframe=timeframe or str(pack_meta.get("timeframe", "unknown")),
        decision_stance=stance,
        pack_path=pack_used,
    )
