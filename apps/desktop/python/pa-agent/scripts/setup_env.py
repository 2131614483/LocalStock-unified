# -*- coding: utf-8 -*-
"""价格行为 AI 运行环境自举：创建独立 venv 并安装依赖。

桌面端首次使用「价格行为 AI」时调用本脚本，把依赖装到用户数据目录
（打包后的 resources 是只读的，不能就地建 venv）。

用法::

    python scripts/setup_env.py --venv <目标venv目录>

输出：每行一个 JSON 对象（JSONL），与 download_full_data.py 约定一致。
    {"type": "progress", "stage": "create-venv", "message": "..."}
    {"type": "log", "message": "..."}
    {"type": "done", "venv": "...", "python": "...", "version": "..."}
    {"type": "error", "message": "..."}
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
SERVICE_ROOT = HERE.parent
REQUIREMENTS = SERVICE_ROOT / "requirements.txt"

#: 装完必须能导入的模块（tiktoken 可选，有字符数兜底）
REQUIRED_MODULES = ("openai", "pydantic", "jsonschema", "tzdata")

#: 默认 pip 源（清华镜像）。换台电脑时不能依赖本机 pip 配置，
#: 所以显式指定；可用 --index-url 或环境变量 PA_AGENT_PIP_INDEX 覆盖。
DEFAULT_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple"
DEFAULT_TRUSTED_HOST = "pypi.tuna.tsinghua.edu.cn"

#: 启动子进程时的环境：强制 UTF-8 并去掉可能干扰的 PYTHONPATH
CHILD_ENV = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
CHILD_ENV["PYTHONUTF8"] = "1"
CHILD_ENV["PYTHONIOENCODING"] = "utf-8"
# 让 pip 子进程也带上 PYTHONPATH 之外的原环境变量（含代理设置）
CHILD_ENV.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")


def pip_index_args(index_url: str) -> list[str]:
    """显式指定源；未传则用清华镜像，保证换机后仍可下载。"""
    url = (index_url or DEFAULT_INDEX_URL).strip()
    if not url:
        return []
    args = ["--index-url", url]
    # 从 URL 推出 host 作为 trusted-host（http 源或自签证书时需要）
    host = url.split("//", 1)[-1].split("/", 1)[0]
    if host:
        args += ["--trusted-host", host]
    return args


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def venv_usable(py: Path) -> bool:
    """已存在的 venv 是否真的可用（不能只看文件在不在：可能是残留/损坏的）。"""
    if not py.exists():
        return False
    try:
        proc = subprocess.run(
            [str(py), "-c", "import sys; print(sys.prefix)"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=CHILD_ENV,
            timeout=30,
        )
        return proc.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def run(cmd: list[str], stage: str) -> int:
    """跑子进程并把输出按行转成 log 事件。"""
    emit({"type": "progress", "stage": stage, "message": " ".join(cmd[:3])})
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=CHILD_ENV,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except OSError as exc:
        emit({"type": "log", "message": f"无法执行 {cmd[0]}: {exc}"})
        return 1
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            emit({"type": "log", "message": line})
    return proc.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description="创建价格行为 AI 的 Python 运行环境")
    parser.add_argument("--venv", required=True, help="venv 目标目录（须可写）")
    parser.add_argument("--requirements", default=str(REQUIREMENTS))
    parser.add_argument(
        "--index-url",
        default=os.environ.get("PA_AGENT_PIP_INDEX", "") or DEFAULT_INDEX_URL,
        help=f"pip 源，默认清华镜像 {DEFAULT_INDEX_URL}",
    )
    args = parser.parse_args()

    venv_dir = Path(args.venv).resolve()
    req = Path(args.requirements)
    if not req.exists():
        emit({"type": "error", "message": f"依赖清单不存在: {req}"})
        return 1

    py = venv_python(venv_dir)

    # 1. 建 venv（已存在且可用则复用；损坏则重建）
    if venv_usable(py):
        emit({"type": "log", "message": f"复用已有虚拟环境 {venv_dir}"})
    else:
        if venv_dir.exists():
            emit({"type": "log", "message": f"已有环境不可用，正在重建 {venv_dir}"})
            shutil.rmtree(venv_dir, ignore_errors=True)
        emit({"type": "progress", "stage": "create-venv", "message": f"创建虚拟环境 {venv_dir}"})
        venv_dir.parent.mkdir(parents=True, exist_ok=True)
        code = run([sys.executable, "-m", "venv", str(venv_dir)], "create-venv")
        if code != 0 or not venv_usable(py):
            emit({
                "type": "error",
                "message": (
                    f"创建虚拟环境失败（退出码 {code}）。请确认当前 Python 自带 venv 模块："
                    f"{sys.executable} -m venv --help"
                ),
            })
            return 1

    # 2. 装依赖（默认清华镜像）
    idx = pip_index_args(args.index_url)
    emit({
        "type": "progress",
        "stage": "pip-upgrade",
        "message": f"升级 pip（源：{(args.index_url or DEFAULT_INDEX_URL)}）",
    })
    run([str(py), "-m", "pip", "install", "--upgrade", "pip", "--disable-pip-version-check", *idx], "pip-upgrade")

    emit({"type": "progress", "stage": "install", "message": "安装依赖（首次可能需要几分钟）"})
    code = run(
        [str(py), "-m", "pip", "install", "-r", str(req), "--disable-pip-version-check", *idx],
        "install",
    )
    if code != 0:
        emit({
            "type": "error",
            "message": (
                f"安装依赖失败（退出码 {code}）。已使用源：{args.index_url or DEFAULT_INDEX_URL}。"
                "请检查网络/代理，或用 --index-url 指定其它源。"
            ),
        })
        return 1

    # 3. 验收：解释器能导入必需模块
    emit({"type": "progress", "stage": "verify", "message": "校验依赖"})
    check = (
        "import importlib.util, json, sys\n"
        f"missing = [m for m in {REQUIRED_MODULES!r} if importlib.util.find_spec(m) is None]\n"
        "sys.stdout.write(json.dumps(missing))\n"
    )
    try:
        out = subprocess.run(
            [str(py), "-c", check],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=CHILD_ENV,
        )
        missing = json.loads(out.stdout.strip() or "[]")
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "message": f"依赖校验失败: {exc}"})
        return 1

    if missing:
        emit({"type": "error", "message": f"以下依赖仍缺失: {', '.join(missing)}"})
        return 1

    version = subprocess.run(
        [str(py), "-c", "import sys;print('.'.join(map(str, sys.version_info[:3])))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=CHILD_ENV,
    ).stdout.strip()

    emit({"type": "done", "venv": str(venv_dir), "python": str(py), "version": version})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
