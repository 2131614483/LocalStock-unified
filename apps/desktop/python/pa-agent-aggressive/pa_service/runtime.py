"""PA 分析会话运行时。

把原 GUI 里 `AppContext.bootstrap()` 的装配逻辑搬到服务端：
行情来自 LocalStock 统一行情库，大模型配置由桌面端按请求传入。
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Callable

from pa_agent.ai.deepseek_client import DeepSeekClient
from pa_agent.ai.json_validator import JsonValidator
from pa_agent.ai.prompt_assembler import PromptAssembler
from pa_agent.ai.router import route_strategy_files
from pa_agent.ai.session_ledger import SessionTokenLedger
from pa_agent.config.paths import (
    EXPERIENCE_DIR,
    LOGS_DIR,
    PROMPT_DIR,
    RECORDS_PENDING_DIR,
)
from pa_agent.config.settings import (
    AIProviderSettings,
    GeneralSettings,
    Settings,
    load_settings,
)
from pa_agent.data.localstock_source import LocalStockSource
from pa_agent.data.snapshot import INDICATOR_WARMUP_BARS, take_snapshot_from_bars
from pa_agent.orchestrator.two_stage import TwoStageOrchestrator
from pa_agent.records.experience_reader import ExperienceReader
from pa_agent.records.pending_writer import PendingWriter
from pa_agent.util.event_bus import EventBus
from pa_agent.util.threading import CancelToken

logger = logging.getLogger("pa_service")

#: 默认分析周期与「送入模型」的 K 线根数
DEFAULT_TIMEFRAME = "1d"
DEFAULT_BAR_COUNT = 100

#: 分析过程模式（与 prompt_assembler 的取值保持一致）
VALID_ANALYSIS_MODES = frozenset({"original", "optimized"})

#: Anthropic 官方提供 OpenAI SDK 兼容层，故仍走同一个 OpenAI 兼容客户端
_ANTHROPIC_COMPAT_BASE_URL = "https://api.anthropic.com/v1/"

#: OpenAI SDK 强制要求非空 api_key；本地 Ollama / LM Studio 等网关不校验，
#: 用占位符即可（与桌面端「仅在 apiKey 非空时带 Authorization 头」等价）。
_NO_AUTH_PLACEHOLDER = "not-needed"


def _is_local_base_url(base_url: str) -> bool:
    lowered = (base_url or "").lower()
    return any(h in lowered for h in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]"))


def ensure_runtime_dirs() -> None:
    """创建运行期需要的可写目录（记录、经验库、日志）。"""
    for path in (RECORDS_PENDING_DIR, EXPERIENCE_DIR, LOGS_DIR):
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:  # noqa: BLE001
            logger.warning("创建目录失败 %s: %s", path, exc)


@dataclass
class LlmConfig:
    """桌面端 settings 表里 ``ai.*`` 的映射。"""

    provider: str = "openai"
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    thinking: bool = False
    context_window: int = 32_768

    @classmethod
    def from_payload(cls, raw: dict[str, Any] | None) -> "LlmConfig":
        raw = raw or {}
        provider = str(raw.get("provider") or "openai").strip().lower()
        base_url = str(raw.get("baseUrl") or raw.get("base_url") or "").strip()
        if not base_url and provider == "anthropic":
            base_url = _ANTHROPIC_COMPAT_BASE_URL
        return cls(
            provider=provider,
            base_url=base_url,
            api_key=str(raw.get("apiKey") or raw.get("api_key") or "").strip(),
            model=str(raw.get("model") or "").strip(),
            thinking=bool(raw.get("thinking", False)),
            context_window=int(raw.get("contextWindow") or raw.get("context_window") or 32_768),
        )

    def to_provider_settings(self, base: AIProviderSettings | None = None) -> AIProviderSettings:
        """覆盖到服务默认 provider 设置上；未传的字段沿用默认值。"""
        settings = base.model_copy() if base is not None else AIProviderSettings()
        if self.base_url:
            settings.base_url = self.base_url
        if self.api_key:
            settings.api_key = self.api_key
        elif _is_local_base_url(settings.base_url):
            settings.api_key = _NO_AUTH_PLACEHOLDER
        if self.model:
            settings.model = self.model
        settings.thinking = self.thinking
        settings.context_window = self.context_window
        return settings

    def validate(self) -> None:
        if not self.model:
            raise ValueError("未配置模型名称（设置 → AI 后端）")
        if not self.base_url:
            raise ValueError("未配置 Base URL（设置 → AI 后端）")
        # 兼容本地 Ollama 等无鉴权网关
        if not self.api_key and not _is_local_base_url(self.base_url):
            raise ValueError("未配置 API Key（设置 → AI 后端）")


@dataclass
class AnalysisRequest:
    """一次分析请求。"""

    symbol: str
    timeframe: str = DEFAULT_TIMEFRAME
    bar_count: int = DEFAULT_BAR_COUNT
    llm: LlmConfig = field(default_factory=LlmConfig)
    analysis_mode: str = "original"
    db_path: str | None = None

    @classmethod
    def from_payload(cls, raw: dict[str, Any]) -> "AnalysisRequest":
        symbol = str(raw.get("symbol") or "").strip()
        if not symbol:
            raise ValueError("缺少 symbol（股票代码）")
        timeframe = str(raw.get("timeframe") or DEFAULT_TIMEFRAME).strip()
        try:
            bar_count = int(raw.get("barCount") or raw.get("bar_count") or DEFAULT_BAR_COUNT)
        except (TypeError, ValueError) as exc:
            raise ValueError("barCount 必须是整数") from exc
        mode = str(raw.get("analysisMode") or raw.get("analysis_mode") or "original").strip().lower()
        if mode not in VALID_ANALYSIS_MODES:
            raise ValueError(f"analysisMode 仅支持 {sorted(VALID_ANALYSIS_MODES)}")
        return cls(
            symbol=symbol,
            timeframe=timeframe,
            bar_count=bar_count,
            llm=LlmConfig.from_payload(raw.get("llm")),
            analysis_mode=mode,
            db_path=raw.get("dbPath") or raw.get("db_path"),
        )


class AnalysisSession:
    """一次分析执行：持有数据源、编排器与取消令牌。"""

    def __init__(self, request: AnalysisRequest) -> None:
        self.request = request
        self.cancel_token = CancelToken()
        self._source: LocalStockSource | None = None
        self._settings: Settings | None = None

    # ── 装配 ──────────────────────────────────────────────────────────────────

    def _service_settings(self) -> Settings:
        """服务级默认设置（config/settings.json 可选，缺失则用内置默认值）。"""
        if self._settings is not None:
            return self._settings
        try:
            from pa_agent.config.paths import SETTINGS_JSON_PATH

            settings = load_settings(SETTINGS_JSON_PATH) if SETTINGS_JSON_PATH.exists() else Settings()
        except Exception as exc:  # noqa: BLE001 — 配置损坏不应阻断分析
            logger.warning("加载服务配置失败，使用默认值: %s", exc)
            settings = Settings()

        general = settings.general
        settings.general = general.model_copy(
            update={
                "last_symbol": self.request.symbol,
                "last_timeframe": self.request.timeframe,
                "analysis_bar_count": self.request.bar_count,
                "analysis_mode": self.request.analysis_mode,
                # 统一行情库中的 OHLC 为不复权原始价，需如实告知模型
                "last_data_source": "localstock",
                "kline_adjust": "none",
            }
        )
        settings.provider = self.request.llm.to_provider_settings(settings.provider)
        self._settings = settings
        return settings

    def _data_source(self) -> LocalStockSource:
        if self._source is None:
            self._source = LocalStockSource(self.request.db_path)
            self._source.connect()
        return self._source

    # ── 执行 ──────────────────────────────────────────────────────────────────

    def build_frame(self):
        """读取行情并构造送交模型的 KlineFrame。"""
        source = self._data_source()
        source.subscribe(self.request.symbol, self.request.timeframe)
        raw = source.latest_snapshot(
            self.request.bar_count + INDICATOR_WARMUP_BARS + 5
        )
        return take_snapshot_from_bars(
            raw,
            self.request.bar_count,
            self.request.symbol,
            self.request.timeframe,
        )

    def run(
        self,
        on_event: Callable[[str, dict[str, Any]], None],
    ) -> dict[str, Any]:
        """执行两阶段分析，事件通过 *on_event(event_name, payload)* 回调抛出。"""
        from pa_agent.util.threading import OrchestratorEvent

        request = self.request
        request.llm.validate()
        settings = self._service_settings()

        ensure_runtime_dirs()

        event_bus = EventBus()
        exp_reader = ExperienceReader(experience_dir=EXPERIENCE_DIR, logger=logger)
        assembler = PromptAssembler(
            prompt_dir=PROMPT_DIR,
            experience_reader=exp_reader,
            prompt_settings=settings.prompt,
        )
        validator = JsonValidator(settings.validation)
        pending_writer = PendingWriter(
            pending_dir=RECORDS_PENDING_DIR,
            event_bus=event_bus,
            logger=logger,
            api_key=settings.provider.api_key,
        )
        ledger = SessionTokenLedger(
            context_window=settings.provider.context_window,
            warn_pct=settings.general.context_warning_threshold_pct,
        )
        ledger.updated.connect(lambda totals: on_event("token_update", totals))

        client = DeepSeekClient(settings=settings.provider, logger_=logger)
        orchestrator = TwoStageOrchestrator(
            client=client,
            assembler=assembler,
            router=route_strategy_files,
            validator=validator,
            pending_writer=pending_writer,
            exp_reader=exp_reader,
            settings=settings,
        )

        frame = self.build_frame()
        on_event(
            "frame_ready",
            {
                "symbol": frame.symbol,
                "timeframe": frame.timeframe,
                "barCount": len(frame.bars),
                "name": self._stock_name(),
                "lastClose": frame.bars[0].close if frame.bars else None,
                "lastBarTime": frame.bars[0].ts_open if frame.bars else None,
            },
        )

        def _event_name(event: OrchestratorEvent) -> str:
            return event.name

        result = orchestrator.submit(
            frame,
            self.cancel_token,
            lambda event: on_event("stage_event", {"event": _event_name(event)}),
            on_stage1_reasoning=lambda text: on_event("stage1_reasoning", {"text": text}),
            on_stage1_content=lambda text: on_event("stage1_content", {"text": text}),
            on_stage2_reasoning=lambda text: on_event("stage2_reasoning", {"text": text}),
            on_stage2_content=lambda text: on_event("stage2_content", {"text": text}),
            on_stage_prompt=lambda stage, prompt_name, text: on_event(
                "prompt", {"stage": stage, "name": prompt_name, "text": text}
            ),
            on_stage2_files=lambda files: on_event("stage2_files", {"files": files}),
        )

        payload = result.model_dump(mode="json") if hasattr(result, "model_dump") else {}
        return payload

    def _stock_name(self) -> str:
        try:
            return self._data_source().stock_name(self.request.symbol)
        except Exception:  # noqa: BLE001
            return ""

    def cancel(self) -> None:
        self.cancel_token.set()

    def close(self) -> None:
        if self._source is not None:
            try:
                self._source.disconnect()
            except Exception as exc:  # noqa: BLE001
                logger.debug("关闭数据源失败: %s", exc)
            self._source = None


def general_defaults() -> GeneralSettings:
    """供健康检查展示的默认通用设置。"""
    return GeneralSettings()


__all__ = [
    "AnalysisRequest",
    "AnalysisSession",
    "LlmConfig",
    "ensure_runtime_dirs",
]
