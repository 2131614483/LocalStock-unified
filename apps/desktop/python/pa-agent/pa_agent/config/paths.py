"""Centralised path constants for PA Agent.

All runtime directories are rooted at PROJECT_ROOT.
Import this module everywhere instead of hard-coding paths.

LocalStock 集成：本服务随桌面端分发（``apps/desktop/python/pa-agent``，打包后位于
``resources/python/pa-agent``）。**可写**产物（分析记录、经验库、日志）默认写到
工作区的 ``data/runtime/pa-agent``；打包运行时该路径为只读，由 Electron 通过
``LOCALSTOCK_PA_RUNTIME_DIR`` 指向用户数据目录。只读的策略提示词随服务目录分发。
"""
from __future__ import annotations
import os
from pathlib import Path

# ── Root ──────────────────────────────────────────────────────────────────────
# Resolve dynamically: this file is pa_agent/config/paths.py, so go up 3 levels.
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent.parent


def _find_workspace_root() -> Path | None:
    """从 PROJECT_ROOT 逐级上溯，找到含 ``data/market`` 的工作区根。

    开发布局为 ``<workspace>/apps/desktop/python/pa-agent``；打包后
    ``resources/python/pa-agent`` 周围没有 data 目录，返回 None。
    """
    for parent in PROJECT_ROOT.parents:
        if (parent / "data" / "market").is_dir():
            return parent
    return None


WORKSPACE_ROOT: Path | None = _find_workspace_root()


def _runtime_root() -> Path:
    """可写运行目录：环境变量 → 工作区 → 服务目录旁的 runtime/（兜底）。"""
    override = os.environ.get("LOCALSTOCK_PA_RUNTIME_DIR", "").strip()
    if override:
        return Path(override)
    if WORKSPACE_ROOT is not None:
        return WORKSPACE_ROOT / "data" / "runtime" / "pa-agent"
    return PROJECT_ROOT / "runtime"


RUNTIME_ROOT: Path = _runtime_root()

# ── Prompt engineering assets (read-only at runtime) ─────────────────────────
PROMPT_DIR: Path = PROJECT_ROOT / "prompt_engineering"

# Alias kept for backward compat with design doc
PA_AGENT_DIR: Path = PROJECT_ROOT

# ── Runtime write directories ─────────────────────────────────────────────────
RECORDS_PENDING_DIR: Path = RUNTIME_ROOT / "records" / "pending"
EXPERIENCE_DIR: Path = RUNTIME_ROOT / "experience"
CONFIG_DIR: Path = PROJECT_ROOT / "config"
LOGS_DIR: Path = RUNTIME_ROOT / "logs"

# ── Individual file paths ─────────────────────────────────────────────────────
FEISHU_JSON_LEGACY_PATH: Path = CONFIG_DIR / "feishu.json"
SETTINGS_JSON_PATH: Path = CONFIG_DIR / "settings.json"
LOG_FILE_PATH: Path = LOGS_DIR / "pa_agent.log"

