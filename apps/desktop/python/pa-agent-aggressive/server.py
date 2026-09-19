"""pa-agent HTTP + SSE 服务端。

把 TwoStageOrchestrator 的两阶段分析包装成流式接口，供 LocalStock 桌面端调用。

接口
----
``GET  /api/health``            健康检查（行情库、股票数、数据范围）
``GET  /api/symbols?q=&limit=``  证券搜索
``GET  /api/kline?symbol=&timeframe=&bars=``  K 线（供图表叠加参考线）
``POST /api/analyze``           提交分析，返回 ``text/event-stream``
``POST /api/cancel``            取消一次分析

启动::

    python server.py                # 默认 127.0.0.1:3210
    PA_AGENT_PORT=3211 python server.py
"""
from __future__ import annotations

import json
import logging
import os
import queue
import sys
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from pa_agent.config.paths import LOG_FILE_PATH, RUNTIME_ROOT
from pa_agent.data.localstock_source import SUPPORTED_TIMEFRAMES, LocalStockSource
from pa_service.runtime import AnalysisRequest, AnalysisSession, ensure_runtime_dirs

#: 单个日志文件上限与保留份数（滚动覆盖，避免无限增长）
_LOG_MAX_BYTES = 2 * 1024 * 1024
_LOG_BACKUPS = 3

_LOG_FORMAT = "[%(asctime)s] [%(levelname)s] %(name)s: %(message)s"


def _setup_logging() -> None:
    """同时输出到 stderr 与日志文件。

    只写 stderr 的话，桌面端结束后日志就没了 —— 用户报障时无从查证。
    """
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    try:
        from logging.handlers import RotatingFileHandler

        LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(
            RotatingFileHandler(
                LOG_FILE_PATH,
                maxBytes=_LOG_MAX_BYTES,
                backupCount=_LOG_BACKUPS,
                encoding="utf-8",
            )
        )
    except OSError as exc:  # 目录不可写等：退化为只写 stderr，不影响服务
        print(f"[warn] 无法写入日志文件 {LOG_FILE_PATH}: {exc}", file=sys.stderr, flush=True)

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt="%Y-%m-%d %H:%M:%S", handlers=handlers)


_setup_logging()
logger = logging.getLogger("pa_service.server")

#: 启动时把关键环境写进日志 —— 排查"为什么连不上"时第一时间要看的就是这些
logger.info(
    "启动: python=%s cwd=%s runtime=%s 行情库=%s 日志=%s",
    sys.version.split()[0],
    os.getcwd(),
    RUNTIME_ROOT,
    os.environ.get("LOCALSTOCK_MARKET_DB") or "(默认)",
    LOG_FILE_PATH,
)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3210

#: 活跃分析任务：jobId -> AnalysisSession
_JOBS: dict[str, AnalysisSession] = {}
_JOBS_LOCK = threading.Lock()


def _register(session: AnalysisSession) -> str:
    job_id = uuid.uuid4().hex[:12]
    with _JOBS_LOCK:
        _JOBS[job_id] = session
    return job_id


def _pop(job_id: str) -> AnalysisSession | None:
    with _JOBS_LOCK:
        return _JOBS.pop(job_id, None)


def _find(job_id: str) -> AnalysisSession | None:
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def _friendly_error(exc: Exception) -> str:
    """把网关的原始报错转成可操作的中文提示。"""
    message = str(exc)
    lowered = message.lower()
    if "exceed_context_size" in lowered or "exceeds the available context size" in lowered:
        return (
            "提示词超出模型上下文长度。可减少「K线数」、改用上下文更大的模型，"
            f"或在设置中调大模型上下文。原始报错：{message[:300]}"
        )
    if "connection" in lowered and ("refused" in lowered or "error" in lowered):
        return f"无法连接大模型服务，请确认它已启动。原始报错：{message[:300]}"
    if "401" in message or "invalid api key" in lowered or "unauthorized" in lowered:
        return "大模型鉴权失败，请检查设置 → AI 后端的 API Key。"
    if "404" in message or "model not found" in lowered or "does not exist" in lowered:
        return f"模型不存在或名称有误，请检查设置 → AI 后端的模型名称。原始报错：{message[:200]}"
    return message


class Handler(BaseHTTPRequestHandler):
    server_version = "PAAgentService/0.1"
    protocol_version = "HTTP/1.1"

    # ── 基础工具 ──────────────────────────────────────────────────────────────

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        logger.debug("%s - %s", self.address_string(), fmt % args)

    def _send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"请求体不是合法 JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return data

    def _query(self) -> dict[str, list[str]]:
        return parse_qs(urlparse(self.path).query)

    # ── 路由 ──────────────────────────────────────────────────────────────────

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path == "/api/health":
                return self._handle_health()
            if path == "/api/symbols":
                return self._handle_symbols()
            if path == "/api/kline":
                return self._handle_kline()
        except Exception as exc:  # noqa: BLE001
            logger.exception("GET %s 失败", path)
            return self._send_json({"code": -1, "message": str(exc)}, HTTPStatus.BAD_REQUEST)
        return self._send_json({"code": -1, "message": "未知接口"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path == "/api/analyze":
                return self._handle_analyze()
            if path == "/api/cancel":
                return self._handle_cancel()
            if path == "/api/export-offline":
                return self._handle_export_offline()
        except ValueError as exc:
            return self._send_json({"code": -1, "message": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001
            logger.exception("POST %s 失败", path)
            return self._send_json({"code": -1, "message": str(exc)}, HTTPStatus.BAD_REQUEST)
        return self._send_json({"code": -1, "message": "未知接口"}, HTTPStatus.NOT_FOUND)

    # ── 处理函数 ──────────────────────────────────────────────────────────────

    def _handle_health(self) -> None:
        source = LocalStockSource()
        try:
            source.connect()
            symbols = source.list_symbols()
            sample = symbols[0] if symbols else ""
            first, last, count = source.data_range(sample) if sample else ("", "", 0)
            payload = {
                "code": 0,
                "data": {
                    "ok": True,
                    "dbPath": source.db_path,
                    "symbolCount": len(symbols),
                    "timeframes": list(SUPPORTED_TIMEFRAMES),
                    "sample": {"symbol": sample, "from": first, "to": last, "rows": count},
                },
            }
            _note_health_ok()
        except Exception as exc:  # noqa: BLE001
            # 健康检查会被高频轮询（启动探活 10 秒内约 40 次）。同一个原因只记一次，
            # 否则日志被同一句话刷满，反而看不出真正的问题。
            payload = {"code": -1, "message": _friendly_db_error(exc, source.db_path)}
            _note_health_failure(source.db_path, exc)
            return self._send_json(payload, HTTPStatus.SERVICE_UNAVAILABLE)
        finally:
            source.disconnect()
        self._send_json(payload)

    def _handle_symbols(self) -> None:
        query = self._query()
        keyword = (query.get("q", [""])[0] or "").strip()
        try:
            limit = max(1, min(200, int(query.get("limit", ["50"])[0])))
        except ValueError:
            limit = 50

        source = LocalStockSource()
        try:
            source.connect()
            rows = source.search_symbols(keyword, limit)
            data = [{"symbol": code, "name": name} for code, name in rows]
        finally:
            source.disconnect()
        self._send_json({"code": 0, "data": data, "total": len(data)})

    def _handle_kline(self) -> None:
        query = self._query()
        symbol = (query.get("symbol", [""])[0] or "").strip()
        if not symbol:
            raise ValueError("缺少 symbol 参数")
        timeframe = (query.get("timeframe", ["1d"])[0] or "1d").strip()
        try:
            bars = max(1, min(2000, int(query.get("bars", ["300"])[0])))
        except ValueError:
            bars = 300

        source = LocalStockSource()
        try:
            source.connect()
            source.subscribe(symbol, timeframe)
            rows = source.fetch_history(symbol, timeframe, bars)
            name = source.stock_name(symbol)
        finally:
            source.disconnect()
        data = [
            {
                "time": r["trade_date"],
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
                "amount": r["amount"],
            }
            for r in rows
        ]
        self._send_json(
            {"code": 0, "data": {"symbol": symbol, "name": name, "timeframe": timeframe, "bars": data}}
        )

    def _handle_cancel(self) -> None:
        payload = self._read_json()
        job_id = str(payload.get("jobId") or payload.get("job_id") or "")
        session = _find(job_id)
        if session is None:
            return self._send_json({"code": -1, "message": "任务不存在或已结束"}, HTTPStatus.NOT_FOUND)
        session.cancel()
        self._send_json({"code": 0, "data": {"cancelled": True}})

    def _handle_export_offline(self) -> None:
        """导出当前服务版本的两阶段 TXT 包，不经网络也不调用 LLM。"""
        from pa_service.offline_export import export_offline_packs

        request = AnalysisRequest.from_payload(self._read_json())
        session = AnalysisSession(request)
        try:
            paths = export_offline_packs(session)
            self._send_json({"code": 0, "data": {
                "directory": str(paths[0].parent), "files": [str(path) for path in paths]
            }})
        finally:
            session.close()

    # ── SSE 分析流 ────────────────────────────────────────────────────────────

    def _handle_analyze(self) -> None:
        payload = self._read_json()
        request = AnalysisRequest.from_payload(payload)
        request.llm.validate()

        session = AnalysisSession(request)
        job_id = _register(session)

        # SSE 头：不设 Content-Length，靠 Connection: close 结束流
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self._send_cors()
        self.end_headers()

        events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()

        def emit(name: str, data: dict[str, Any]) -> None:
            events.put((name, data))

        def worker() -> None:
            try:
                record = session.run(emit)
                # 分析失败时异常被记录在 record.exception 里（而非抛出），
                # 这里同样做一次友好化，保证界面看到的是可操作的提示。
                exc = record.get("exception") if isinstance(record, dict) else None
                if isinstance(exc, dict) and exc.get("message"):
                    exc["message"] = _friendly_error(RuntimeError(str(exc["message"])))
                emit("done", {"record": record})
            except Exception as exc:  # noqa: BLE001 — 统一转成 error 事件
                logger.exception("分析失败 job=%s", job_id)
                emit("error", {"message": _friendly_error(exc), "type": type(exc).__name__})
            finally:
                emit("__close__", {})
                events.put(None)

        thread = threading.Thread(target=worker, name=f"pa-job-{job_id}", daemon=True)
        thread.start()

        self._write_sse("started", {"jobId": job_id})
        disconnected = False
        try:
            while True:
                item = events.get()
                if item is None:
                    break
                name, data = item
                if name == "__close__":
                    continue
                self._write_sse(name, data)
        except (BrokenPipeError, ConnectionResetError):
            disconnected = True
            logger.info("客户端断开，取消任务 job=%s", job_id)
            session.cancel()
        finally:
            if not disconnected:
                self._write_sse("closed", {"jobId": job_id})
            _pop(job_id)
            session.close()

    def _write_sse(self, name: str, data: dict[str, Any]) -> None:
        body = json.dumps(data, ensure_ascii=False)
        chunk = f"event: {name}\ndata: {body}\n\n".encode("utf-8")
        self.wfile.write(chunk)
        self.wfile.flush()


#: 上一次的健康检查失败原因，用于抑制重复日志
_last_health_error: str | None = None


def _note_health_failure(db_path: str, exc: Exception) -> None:
    """健康检查失败：同一原因只记一次（INFO 级），避免刷屏。"""
    global _last_health_error
    key = f"{db_path}|{type(exc).__name__}:{exc}"
    if key == _last_health_error:
        logger.debug("健康检查仍失败（行情库 %s）：%s", db_path, exc)
        return
    _last_health_error = key
    logger.error(
        "健康检查失败（行情库 %s）：%s。若这是用户数据目录下的空库，"
        "请在桌面端「设置 → 行情库位置」指定真正的行情库。",
        db_path,
        exc,
    )


def _note_health_ok() -> None:
    """健康检查恢复正常时提示一次，便于对照。"""
    global _last_health_error
    if _last_health_error is not None:
        logger.info("健康检查已恢复正常")
        _last_health_error = None


def _friendly_db_error(exc: Exception, db_path: str) -> str:
    """把行情库的底层报错翻成可操作的中文提示。"""
    text = str(exc)
    if "no such table" in text:
        return (
            f"行情库缺少必要的数据表（{text}）：{db_path}。"
            "这通常意味着该文件不是 LocalStock 的权威行情库"
            "（可能是桌面端在用户数据目录下自动建的空库）。"
            "请把 LOCALSTOCK_MARKET_DB 指向 data/market/stock_data.db，"
            "或在设置中指定正确的行情库路径。"
        )
    if "unable to open database file" in text.lower():
        return f"无法打开行情库：{db_path}（文件不存在或没有访问权限）"
    if "malformed" in text.lower():
        return f"行情库文件已损坏：{db_path}，请从同步源重新生成。"
    if "not a database" in text.lower() or "encrypted" in text.lower():
        return (
            f"该文件不是 SQLite 数据库（或已加密）：{db_path}。"
            "请确认选的是 LocalStock 的 stock_data.db，而不是它的 -wal/-shm 附属文件、"
            "压缩包或其它程序的数据文件。"
        )
    return f"行情库 {db_path} 读取失败：{text}"


def _parent_process_alive(pid: int) -> bool:
    """父进程是否仍存活；用于桌面端被强制结束时自动退出，避免留下孤儿服务。"""
    if os.name == "nt":
        import ctypes

        SYNCHRONIZE = 0x00100000
        WAIT_TIMEOUT = 0x00000102  # 仍在运行
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _start_parent_watchdog() -> None:
    """桌面端托管启动时（PA_AGENT_PARENT_PID）监视父进程，父进程没了就自退。

    只在该环境变量存在时启用：手动 `python server.py` 不应受影响。
    """
    raw = os.environ.get("PA_AGENT_PARENT_PID", "").strip()
    if not raw.isdigit():
        return
    parent_pid = int(raw)

    def watch() -> None:
        while True:
            time.sleep(3.0)
            if not _parent_process_alive(parent_pid):
                logger.info("父进程 %d 已退出，服务随之关闭", parent_pid)
                # serve_forever 阻塞在主线程，用 _exit 立即结束
                os._exit(0)

    threading.Thread(target=watch, name="pa-parent-watchdog", daemon=True).start()
    logger.info("已启用父进程守护（PID %d）", parent_pid)


def main() -> int:
    ensure_runtime_dirs()
    host = os.environ.get("PA_AGENT_HOST", DEFAULT_HOST).strip() or DEFAULT_HOST
    try:
        # PA_AGENT_PORT=0 表示由系统分配空闲端口（桌面端托管时用，避免端口冲突）
        port = int(os.environ.get("PA_AGENT_PORT", str(DEFAULT_PORT)))
    except ValueError:
        port = DEFAULT_PORT

    httpd = ThreadingHTTPServer((host, port), Handler)
    actual_port = httpd.server_address[1]

    # 由 Electron 指定文件路径：绑定成功后把真实端口写进去，避免双方抢同端口的竞态。
    port_file = os.environ.get("PA_AGENT_PORT_FILE", "").strip()
    if port_file:
        try:
            with open(port_file, "w", encoding="utf-8") as fh:
                fh.write(str(actual_port))
        except OSError as exc:
            logger.warning("写入端口文件失败 %s: %s", port_file, exc)

    # 机器可读的就绪标记，便于父进程等待
    print(f"PA_AGENT_LISTENING {actual_port}", flush=True)
    logger.info("pa-agent 服务已启动: http://%s:%d", host, actual_port)
    logger.info("行情库: %s", os.environ.get("LOCALSTOCK_MARKET_DB") or "(默认工作区路径)")
    _start_parent_watchdog()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("收到中断，正在关闭…")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
