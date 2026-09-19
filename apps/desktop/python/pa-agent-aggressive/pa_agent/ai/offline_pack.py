"""Offline prompt-pack exporter — run the two-stage analysis without an API key.

Produces two self-contained ``.txt`` files that can be uploaded/pasted straight
into any chat LLM (web UI, another vendor, a local model):

    01_阶段一_<symbol>_<tf>.txt   Stage 1 — system rules + diagnosis framework + K-line data
    02_阶段二_<symbol>_<tf>.txt   Stage 2 — system rules + FULL strategy library + routing table

Why the full library: the API path routes strategy files from the Stage 1
diagnosis, but that diagnosis does not exist when the pack is exported — the
model itself produces it in part 1.  So part 2 ships every strategy file plus a
self-routing cheat-sheet, and the model picks the applicable ones from its own
Stage 1 output (which is in the same conversation).

Both files share the identical system prompt, so pasting part 2 into the same
conversation reuses whatever prefix caching the target UI provides.

This module is deliberately side-effect free apart from writing the pack files;
it never touches records/, experience/ or the network.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from pa_agent.config.paths import OFFLINE_PACK_DIR

logger = logging.getLogger(__name__)

_RULE_WIDTH = 80
_RULE = "=" * _RULE_WIDTH
_THIN = "-" * _RULE_WIDTH


# ── Small text helpers ────────────────────────────────────────────────────────

def _blocks(*sections: tuple[str, str]) -> str:
    """Join (title, body) pairs under a rule-separated heading."""
    out: list[str] = []
    for title, body in sections:
        out.append(_RULE)
        out.append(f"【{title}】")
        out.append(_RULE)
        out.append("")
        out.append(body.rstrip("\n"))
        out.append("")
    return "\n".join(out)


def _kv(label: str, value: Any) -> str:
    return f" {label:<12}: {value}"


def _safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "-", str(name or "")).strip() or "unknown"


def _inventory() -> tuple[list[str], list[str], list[str]]:
    """(system files, stage1 task files, stage2 task files) actually embedded."""
    from pa_agent.ai.prompt_assembler import (
        COMMON_SYSTEM_STAGE2_TXT_FILES,
        STAGE1_TASK_PROMPT_TXT_FILES,
        stage2_user_task_txt_files,
    )

    system_files = list(COMMON_SYSTEM_STAGE2_TXT_FILES)
    stage1_task = list(STAGE1_TASK_PROMPT_TXT_FILES)
    stage2_task = list(stage2_user_task_txt_files(load_full_strategy_library=True))
    return system_files, stage1_task, stage2_task


def _bullet_files(files: list[str]) -> str:
    return "\n".join(f"   · {f}" for f in files)


# ── Pack text builders ────────────────────────────────────────────────────────

def build_stage1_text(assembler: Any, frame: Any) -> str:
    """Full Stage-1 pack: header + system prompt + task turn + K-line data."""
    system = assembler.stage1_system_prompt_only()
    user = assembler.build_offline_stage1_user(frame)
    system_files, stage1_task, _ = _inventory()
    n_bars = len(getattr(frame, "bars", []) or [])

    header = "\n".join([
        _RULE,
        " PA Agent 离线分析包 · 第 1 / 2 部分：市场诊断（阶段一）",
        _RULE,
        _kv("品种", assembler.instrument_label(frame)),
        _kv("周期", frame.timeframe),
        _kv("K线数量", f"{n_bars} （K1 = 最新已收盘）"),
        _kv("生成时间", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        _THIN,
        " 使用方法",
        "   1. 把本文件【全文】作为第 1 条消息发给大模型（网页版可直接上传附件）",
        "   2. 大模型会输出「阶段一诊断 JSON」",
        "   3. 接着发送第 2 部分（02_阶段二_*.txt），它会继续输出「阶段二决策 JSON」",
        "   4. 全程不需要 API Key，不消耗本程序额度",
        _THIN,
        " 本文件包含",
        "   · 系统指令（人设 + 二元决策树 §0–§15 + 语言/术语/禁工具/思考分离 硬约束）",
        "   · K 线数据表（10 列）+ 程序预计算几何特征表（16 列）",
        "   · 阶段一输出契约",
        "   · 下列提示词文件：",
        _bullet_files([*system_files, *stage1_task]),
        _THIN,
        " 若模型把 JSON 只写在「思考」里、正文为空：",
        "   回复「请把完整 JSON 输出在正文中，不要只写在思考区」即可。",
    ])

    return header + "\n\n" + _blocks(
        ("系统指令 · 原文", system),
        ("阶段一任务与数据", user),
    )


def build_stage2_text(
    assembler: Any,
    frame: Any,
    *,
    decision_stance: str = "balanced",
    enable_next_bar_prediction: bool = False,
) -> str:
    """Full Stage-2 pack: header + system prompt + full strategy library + data."""
    system = assembler.stage2_system_prompt_only([], [])
    user = assembler.build_offline_stage2_user(
        frame,
        decision_stance=decision_stance,
        enable_next_bar_prediction=enable_next_bar_prediction,
    )
    system_files, _, stage2_task = _inventory()
    n_bars = len(getattr(frame, "bars", []) or [])

    header = "\n".join([
        _RULE,
        " PA Agent 离线分析包 · 第 2 / 2 部分：交易决策（阶段二）",
        _RULE,
        _kv("品种", assembler.instrument_label(frame)),
        _kv("周期", frame.timeframe),
        _kv("K线数量", f"{n_bars} （K1 = 最新已收盘）"),
        _kv("交易倾向", decision_stance),
        _kv("生成时间", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        _THIN,
        " 使用方法",
        "   1. 在同一个对话里，紧接第 1 部分之后发送本文件全文",
        "   2. 大模型先读「策略文件路由表」自行选定策略文件，再输出阶段二决策 JSON",
        "   3. 它应当直接引用自己上一条回复里的阶段一诊断结果（无需你再次粘贴）",
        _THIN,
        " 本文件包含",
        "   · 系统指令（与第 1 部分完全相同）",
        "   · 策略文件路由表（离线自路由速查表）",
        "   · K 线数据表 + 几何特征表 + 阶段二输出契约",
        f"   · 下列提示词文件（策略库为【全量】，共 {len(stage2_task)} 个，由模型自行路由）：",
        _bullet_files([*system_files, *stage2_task]),
        _THIN,
        " 说明：离线导出时还没有阶段一结论，无法像程序那样精确路由，",
        "       所以这里装载全部策略文件，改由模型按诊断结果自行筛选。",
    ])

    return header + "\n\n" + _blocks(
        ("系统指令 · 原文", system),
        ("阶段二任务 · 全量策略库 · K线数据", user),
    )


# ── Export entry point ────────────────────────────────────────────────────────

def export_offline_packs(
    assembler: Any,
    frame: Any,
    *,
    out_dir: Path | None = None,
    decision_stance: str = "balanced",
    enable_next_bar_prediction: bool = False,
) -> list[Path]:
    """Write both pack files into a fresh timestamped folder; return their paths.

    Raises ValueError if *frame* is empty (so the GUI can show a real reason
    instead of silently writing a pack with no K-line data).
    """
    if frame is None or not getattr(frame, "bars", None):
        raise ValueError("无可用 K 线数据，请先获取行情再导出离线包")

    symbol = _safe(getattr(frame, "symbol", "unknown"))
    timeframe = _safe(getattr(frame, "timeframe", "unknown"))
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    base = Path(out_dir) if out_dir is not None else OFFLINE_PACK_DIR
    folder = base / f"{stamp}_{symbol}_{timeframe}"
    folder.mkdir(parents=True, exist_ok=True)

    stage1_path = folder / f"01_阶段一_{symbol}_{timeframe}.txt"
    stage2_path = folder / f"02_阶段二_{symbol}_{timeframe}.txt"

    stage1_path.write_text(
        build_stage1_text(assembler, frame), encoding="utf-8", newline="\n"
    )
    stage2_path.write_text(
        build_stage2_text(
            assembler,
            frame,
            decision_stance=decision_stance,
            enable_next_bar_prediction=enable_next_bar_prediction,
        ),
        encoding="utf-8",
        newline="\n",
    )

    logger.info(
        "Offline packs exported: %s (stage1 %.1f KB, stage2 %.1f KB)",
        folder,
        stage1_path.stat().st_size / 1024,
        stage2_path.stat().st_size / 1024,
    )
    return [stage1_path, stage2_path]
