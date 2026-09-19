"""Event bus for inter-component communication.

原实现基于 PyQt6 的 ``pyqtSignal``；迁移到无 GUI 的服务端后，这里用等价的
纯 Python 信号实现，保持 ``connect`` / ``emit`` 的调用方式不变，因此所有
核心模块（orchestrator / ai / data）无需修改。
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Callable

from pa_agent.data.base import KlineFrame
from pa_agent.records.schema import AlarmPayload

logger = logging.getLogger(__name__)


class Signal:
    """Minimal stand-in for ``pyqtSignal``.

    Supports ``connect(slot)`` / ``disconnect(slot)`` / ``emit(*args)``.
    Slots are invoked synchronously in registration order; a slot that raises
    is logged and skipped so one bad listener cannot break the pipeline.
    """

    __slots__ = ("_slots", "_lock")

    def __init__(self) -> None:
        self._slots: list[Callable[..., Any]] = []
        self._lock = threading.RLock()

    def connect(self, slot: Callable[..., Any]) -> None:
        with self._lock:
            if slot not in self._slots:
                self._slots.append(slot)

    def disconnect(self, slot: Callable[..., Any] | None = None) -> None:
        with self._lock:
            if slot is None:
                self._slots.clear()
            elif slot in self._slots:
                self._slots.remove(slot)

    def emit(self, *args: Any) -> None:
        with self._lock:
            slots = list(self._slots)
        for slot in slots:
            try:
                slot(*args)
            except Exception:  # noqa: BLE001 — 监听方异常不应中断主流程
                logger.exception("事件监听器执行失败: %r", slot)


class EventBus:
    """Central signal hub shared across orchestrators and front-ends.

    Signals
    -------
    data_frame  : emitted by RefreshLoop with the latest KlineFrame
    status      : emitted with a human-readable status string
    exception   : emitted when a JSON-validation alarm fires (AlarmPayload)
    token_update: emitted with a dict of token/cost update data
    """

    def __init__(self) -> None:
        self.data_frame: Signal = Signal()    # KlineFrame
        self.status: Signal = Signal()        # str
        self.exception: Signal = Signal()     # AlarmPayload
        self.token_update: Signal = Signal()  # dict

    def emit_status(self, text: str) -> None:
        """Convenience wrapper — emit a status string."""
        self.status.emit(text)

    def emit_exception(self, payload: AlarmPayload) -> None:
        """Convenience wrapper — emit an AlarmPayload."""
        self.exception.emit(payload)

    def emit_data_frame(self, frame: KlineFrame) -> None:
        """Convenience wrapper — emit a KlineFrame."""
        self.data_frame.emit(frame)

    def emit_token_update(self, data: dict) -> None:
        """Convenience wrapper — emit a token/cost update dict."""
        self.token_update.emit(data)
