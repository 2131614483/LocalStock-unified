"""导出可直接上传到任意聊天模型的本地两阶段 TXT 分析包。

本实现刻意不复用 GUI：桌面端服务只读取统一行情库和本版本随附的
``prompt_engineering``，输出写入 Electron 指定的运行目录，绝不写回程序目录。
"""
from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
import re

from pa_agent.config.paths import PROMPT_DIR


def _safe(value: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "-", value).strip() or "unknown"


def _prompt_library() -> str:
    """完整嵌入当前版本的策略库；两个版本因此天然隔离。"""
    blocks: list[str] = []
    for path in sorted(PROMPT_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".txt", ".md"}:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = path.read_text(encoding="utf-8-sig", errors="replace")
        blocks.extend(("=" * 80, f"【策略知识库 / {path.relative_to(PROMPT_DIR).as_posix()}】", "=" * 80, content.strip(), ""))
    if not blocks:
        raise ValueError(f"未找到策略知识库：{PROMPT_DIR}")
    return "\n".join(blocks)


def _frame_text(frame: object) -> str:
    bars = list(getattr(frame, "bars", []) or [])
    if not bars:
        raise ValueError("无可用 K 线数据，请检查股票代码、周期及行情库后重试")
    lines = ["时间\t开盘\t最高\t最低\t收盘\t成交量\t成交额"]
    for bar in bars:
        lines.append("\t".join(str(getattr(bar, key, "")) for key in ("ts_open", "open", "high", "low", "close", "volume", "amount")))
    return "\n".join(lines)


def export_offline_packs(session: object) -> list[Path]:
    """生成两个 TXT：阶段一诊断与阶段二决策（完整策略库）。"""
    frame = session.build_frame()
    symbol = _safe(str(getattr(frame, "symbol", "unknown")))
    timeframe = _safe(str(getattr(frame, "timeframe", "unknown")))
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    # 打包版由 Electron 传入用户数据目录；未传时才回退到服务目录旁，
    # 从而兼容两代 PA Agent 不同的 paths.py 常量命名。
    runtime_root = Path(os.environ.get("LOCALSTOCK_PA_RUNTIME_DIR", "").strip() or PROMPT_DIR.parent / "runtime")
    folder = runtime_root / "offline_packs" / f"{stamp}_{symbol}_{timeframe}"
    folder.mkdir(parents=True, exist_ok=True)
    kline = _frame_text(frame)
    library = _prompt_library()
    common = (
        f"品种：{symbol}\n周期：{timeframe}\nK线数：{len(getattr(frame, 'bars', []) or [])}\n"
        f"导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        "使用方法：先将 01 文件全文发送给任意大模型；收到阶段一诊断后，"
        "在同一对话继续发送 02 文件。此流程不需要本程序的 API Key。\n"
    )
    stage1 = (
        "PA Agent 离线分析包 · 第 1 / 2 部分：市场诊断\n" + "=" * 80 + "\n" + common
        + "\n请根据下列版本专属策略知识库与 K 线数据，完成严谨的市场诊断；"
        "列出趋势、关键价位、形态、风险与可验证条件。\n\n"
        + library + "\n\n【K线数据】\n" + kline
    )
    stage2 = (
        "PA Agent 离线分析包 · 第 2 / 2 部分：交易决策\n" + "=" * 80 + "\n" + common
        + "\n请引用上一轮市场诊断，并自行从下列【全量、版本专属】策略库选择适用规则，"
        "输出明确的操作、入场、止损、止盈、仓位及失效条件。\n\n"
        + library + "\n\n【同一份 K线数据】\n" + kline
    )
    paths = [folder / f"01_阶段一_{symbol}_{timeframe}.txt", folder / f"02_阶段二_{symbol}_{timeframe}.txt"]
    paths[0].write_text(stage1, encoding="utf-8", newline="\n")
    paths[1].write_text(stage2, encoding="utf-8", newline="\n")
    return paths
