"""Rule-based request routing and provider orchestration.

Routing precedence (first match wins):
    1. Sensitive phrase anywhere in the conversation  -> local (hard rule, overrides explicit 'cloud')
    2. Explicit route preference ('local' / 'cloud')  -> as requested
    3. Request marked simple                          -> local
    4. Complex phrase or long prompt                  -> cloud (local if cloud is disabled)
    5. Default                                        -> local
"""

import asyncio
import logging
import re
import time
from collections.abc import AsyncIterator, Iterable

from pydantic import BaseModel

from app.core.config import Settings
from app.schemas.chat import (
    ChatRequest,
    RouteDecision,
    RouteTarget,
    StreamDone,
    StreamError,
    StreamEventName,
    StreamMeta,
    Telemetry,
    TokenChunk,
)
from app.schemas.system import ModelsResponse
from app.services.providers import CloudProvider, LLMProvider, OllamaProvider, ProviderError

logger = logging.getLogger(__name__)

StreamEvent = tuple[StreamEventName, BaseModel]


def _compile_phrases(phrases: Iterable[str]) -> re.Pattern[str] | None:
    cleaned = sorted({p.strip() for p in phrases if p.strip()}, key=len, reverse=True)
    if not cleaned:
        return None
    alternation = "|".join(re.escape(p) for p in cleaned)
    return re.compile(rf"(?<!\w)(?:{alternation})(?!\w)", re.IGNORECASE)


def _matches(pattern: re.Pattern[str] | None, text: str) -> list[str]:
    if pattern is None:
        return []
    return sorted({m.group(0).lower() for m in pattern.finditer(text)})


class RequestClassifier:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._sensitive = _compile_phrases(settings.routing_sensitive_phrases)
        self._complex = _compile_phrases(settings.routing_complex_phrases)

    def classify(self, request: ChatRequest) -> RouteDecision:
        settings = self._settings
        # Scan the whole conversation: sensitive data in earlier turns must not leak to the cloud later.
        conversation = "\n".join(m.content for m in request.messages)
        sensitive_hits = _matches(self._sensitive, conversation)

        if sensitive_hits:
            override = " (explicit cloud request overridden)" if request.route == "cloud" else ""
            return self._decide(
                "local",
                request,
                reason=f"Sensitive content detected: {', '.join(sensitive_hits)}{override}",
                sensitive=True,
                rules=[f"sensitive:{hit}" for hit in sensitive_hits],
            )

        if request.route in ("local", "cloud"):
            if request.route == "cloud" and not settings.cloud_enabled:
                return self._decide("local", request, reason="Cloud requested but disabled", rules=["cloud_disabled"])
            return self._decide(request.route, request, reason=f"Explicit {request.route} route requested", rules=["explicit"])

        if request.is_simple:
            return self._decide("local", request, reason="Request marked as simple", rules=["marked_simple"])

        prompt = request.latest_prompt
        complex_hits = _matches(self._complex, prompt)
        is_long = len(prompt) >= settings.routing_complex_min_chars
        if complex_hits or is_long:
            rules = [f"complex:{hit}" for hit in complex_hits] + (["long_prompt"] if is_long else [])
            signals = ", ".join(complex_hits) if complex_hits else f"{len(prompt)} chars"
            if not settings.cloud_enabled:
                return self._decide("local", request, reason=f"Complex ({signals}) but cloud disabled", rules=rules)
            return self._decide("cloud", request, reason=f"Complex multi-step request: {signals}", rules=rules)

        return self._decide("local", request, reason="General request handled locally", rules=["default"])

    def _decide(
        self,
        target: RouteTarget,
        request: ChatRequest,
        *,
        reason: str,
        sensitive: bool = False,
        rules: list[str],
    ) -> RouteDecision:
        # The caller's model only applies when the decision lands on the provider they asked for.
        if request.model and request.route == target:
            model = request.model
        else:
            model = self.default_model(target)
        return RouteDecision(target=target, model=model, reason=reason, sensitive=sensitive, matched_rules=rules)

    def default_model(self, target: RouteTarget) -> str:
        if target == "local":
            return self._settings.ollama_default_model
        return self._settings.cloud_default_model


class RouterService:
    def __init__(self, settings: Settings, ollama: OllamaProvider, cloud: CloudProvider) -> None:
        self._settings = settings
        self._providers: dict[RouteTarget, LLMProvider] = {"local": ollama, "cloud": cloud}
        self.classifier = RequestClassifier(settings)

    @property
    def ollama(self) -> OllamaProvider:
        return self._providers["local"]  # type: ignore[return-value]

    @property
    def cloud(self) -> CloudProvider:
        return self._providers["cloud"]  # type: ignore[return-value]

    def classify(self, request: ChatRequest) -> RouteDecision:
        return self.classifier.classify(request)

    def _fallback_for(self, decision: RouteDecision) -> RouteDecision | None:
        if not self._settings.routing_allow_fallback or decision.sensitive:
            return None
        if decision.target == "local" and not self._settings.cloud_enabled:
            return None
        target: RouteTarget = "cloud" if decision.target == "local" else "local"
        return RouteDecision(
            target=target,
            model=self.classifier.default_model(target),
            reason=f"Fallback from {decision.target}",
            sensitive=False,
            matched_rules=[*decision.matched_rules, "fallback"],
        )

    async def stream(self, request: ChatRequest, decision: RouteDecision, request_id: str) -> AsyncIterator[StreamEvent]:
        """Yield typed stream events. Never raises for provider failures; they become `error` events."""
        started = time.perf_counter()
        attempts = [decision]
        if fallback := self._fallback_for(decision):
            attempts.append(fallback)

        def elapsed_ms() -> float:
            return round((time.perf_counter() - started) * 1000, 1)

        previous_failure: str | None = None
        for index, attempt in enumerate(attempts):
            is_fallback = index > 0
            yield "meta", StreamMeta(
                request_id=request_id,
                route=attempt.target,
                model=attempt.model,
                reason=f"{attempt.reason} ({previous_failure})" if previous_failure else attempt.reason,
                sensitive=attempt.sensitive,
                fallback=is_fallback,
            )

            ttft_ms: float | None = None
            chunks = 0
            chars = 0

            def telemetry() -> Telemetry:
                return Telemetry(
                    request_id=request_id,
                    route=attempt.target,
                    model=attempt.model,
                    ttft_ms=ttft_ms,
                    latency_ms=elapsed_ms(),
                    output_chunks=chunks,
                    output_chars=chars,
                    fallback_used=is_fallback,
                )

            provider = self._providers[attempt.target]
            try:
                async for token in provider.stream_chat(request.messages, attempt.model, request.temperature):
                    if ttft_ms is None:
                        ttft_ms = elapsed_ms()
                    chunks += 1
                    chars += len(token)
                    yield "token", TokenChunk(content=token)
            except ProviderError as exc:
                has_next = index + 1 < len(attempts)
                logger.warning(
                    "request=%s provider=%s model=%s failed (%s): %s",
                    request_id, attempt.target, attempt.model, exc.code, exc.message,
                )
                # Only fall back before any output reached the client, so answers are never spliced.
                if chunks == 0 and has_next:
                    previous_failure = exc.message
                    continue
                yield "telemetry", telemetry()
                yield "error", StreamError(
                    code=exc.code, message=exc.message, route=attempt.target, retryable=exc.retryable
                )
                return
            except asyncio.CancelledError:
                logger.info("request=%s cancelled by client after %s chunks", request_id, chunks)
                raise
            except Exception:
                logger.exception("request=%s unexpected failure in %s provider", request_id, attempt.target)
                yield "telemetry", telemetry()
                yield "error", StreamError(
                    code="internal_error",
                    message="An unexpected error occurred while generating the response.",
                    route=attempt.target,
                )
                return

            if chunks == 0:
                yield "telemetry", telemetry()
                yield "error", StreamError(
                    code="empty_response", message="The model returned an empty response.", route=attempt.target
                )
                return

            yield "telemetry", telemetry()
            yield "done", StreamDone(request_id=request_id)
            logger.info(
                "request=%s route=%s model=%s ttft_ms=%s latency_ms=%s chars=%s",
                request_id, attempt.target, attempt.model, ttft_ms, elapsed_ms(), chars,
            )
            return

    async def list_models(self) -> ModelsResponse:
        local, cloud = await asyncio.gather(self.ollama.list_models(), self.cloud.list_models())
        return ModelsResponse(
            models=[*local, *cloud],
            default_local=self._settings.ollama_default_model,
            default_cloud=self._settings.cloud_default_model if self._settings.cloud_enabled else None,
        )
