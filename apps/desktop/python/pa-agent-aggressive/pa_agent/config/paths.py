"""Centralised path constants for PA Agent.

All runtime directories are rooted at PROJECT_ROOT.
Import this module everywhere instead of hard-coding paths.
"""
from __future__ import annotations
import os
from pathlib import Path

# ── Root ──────────────────────────────────────────────────────────────────────
# Resolve dynamically: this file is pa_agent/config/paths.py, so go up 3 levels.
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent.parent


def _find_workspace_root() -> Path | None:
    """开发态定位统一工作区；打包态则由 Electron 显式传入运行目录。"""
    for parent in PROJECT_ROOT.parents:
        if (parent / "data" / "market").is_dir():
            return parent
    return None


WORKSPACE_ROOT: Path | None = _find_workspace_root()


def _runtime_root() -> Path:
    """与稳定版一致：可写数据不能落在打包后的程序资源目录。"""
    override = os.environ.get("LOCALSTOCK_PA_RUNTIME_DIR", "").strip()
    if override:
        return Path(override)
    if WORKSPACE_ROOT is not None:
        return WORKSPACE_ROOT / "data" / "runtime" / "pa-agent-aggressive"
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

# Exported offline prompt packs (manual copy/paste analysis, no API key needed)
OFFLINE_PACK_DIR: Path = RUNTIME_ROOT / "offline_packs"

# ── Individual file paths ─────────────────────────────────────────────────────
FEISHU_JSON_LEGACY_PATH: Path = CONFIG_DIR / "feishu.json"
SETTINGS_JSON_PATH: Path = CONFIG_DIR / "settings.json"
LOG_FILE_PATH: Path = LOGS_DIR / "pa_agent.log"
CRASH_LOG_PATH: Path = LOGS_DIR / "crash.log"
