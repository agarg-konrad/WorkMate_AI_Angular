"""Inference provider clients.

Every provider exposes the same surface: `stream_chat` yields text deltas and raises
`ProviderError` (never raw httpx errors) so the router can translate failures into SSE events.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Sequence
from typing import Any, Protocol

import httpx

from app.core.config import Settings
from app.schemas.chat import ChatMessage, RouteTarget
from app.schemas.system import ComponentHealth, ModelInfo

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class LLMProvider(Protocol):
    target: RouteTarget

    def stream_chat(
        self, messages: Sequence[ChatMessage], model: str, temperature: float
    ) -> AsyncIterator[str]: ...

    async def list_models(self) -> list[ModelInfo]: ...

    async def health(self) -> ComponentHealth: ...


def _elapsed_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)


def _extract_error_message(body: bytes) -> str:
    text = body.decode("utf-8", errors="replace").strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text[:500] or "empty response body"
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return str(error.get("message", error))
    return str(error or text)[:500]


class OllamaProvider:
    target: RouteTarget = "local"

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    async def stream_chat(
        self, messages: Sequence[ChatMessage], model: str, temperature: float
    ) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": [m.model_dump() for m in messages],
            "stream": True,
            "options": {"temperature": temperature},
        }
        try:
            async with self._client.stream("POST", "/api/chat", json=payload) as response:
                if response.status_code != 200:
                    detail = _extract_error_message(await response.aread())
                    if response.status_code == 404:
                        raise ProviderError(
                            "model_not_found",
                            f"Local model '{model}' is not available: {detail}. "
                            f"Run `ollama pull {model}`.",
                        )
                    raise ProviderError(
                        "ollama_http_error",
                        f"Ollama returned HTTP {response.status_code}: {detail}",
                        retryable=response.status_code >= 500,
                    )

                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk: dict[str, Any] = json.loads(line)
                    except json.JSONDecodeError:
                        logger.warning("Skipping malformed Ollama stream line: %r", line[:200])
                        continue
                    if error := chunk.get("error"):
                        raise ProviderError("ollama_error", str(error))
                    content = (chunk.get("message") or {}).get("content") or ""
                    if content:
                        yield content
                    if chunk.get("done"):
                        return
        except httpx.ConnectError as exc:
            raise ProviderError(
                "ollama_unreachable",
                f"Cannot reach Ollama at {self._settings.ollama_base_url}. Is the service running?",
                retryable=True,
            ) from exc
        except httpx.TimeoutException as exc:
            raise ProviderError("ollama_timeout", "Ollama did not respond in time.", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("ollama_transport_error", f"Ollama connection failed: {exc}", retryable=True) from exc

    async def list_models(self) -> list[ModelInfo]:
        default = self._settings.ollama_default_model
        try:
            response = await self._client.get("/api/tags", timeout=5.0)
            response.raise_for_status()
            installed = response.json().get("models", [])
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Could not list Ollama models: %s", exc)
            return [
                ModelInfo(
                    id=default,
                    name=default,
                    provider="local",
                    available=False,
                    is_default=True,
                    details="Ollama unreachable",
                )
            ]

        models: list[ModelInfo] = []
        default_found = False
        for entry in installed:
            name: str = entry.get("name") or entry.get("model", "")
            if not name:
                continue
            is_default = name in (default, f"{default}:latest")
            default_found = default_found or is_default
            info = entry.get("details") or {}
            details = " · ".join(
                str(v) for v in (info.get("parameter_size"), info.get("quantization_level")) if v
            )
            models.append(
                ModelInfo(
                    id=name,
                    name=name.removesuffix(":latest"),
                    provider="local",
                    available=True,
                    is_default=is_default,
                    details=details or None,
                )
            )
        if not default_found:
            models.insert(
                0,
                ModelInfo(
                    id=default,
                    name=default,
                    provider="local",
                    available=False,
                    is_default=True,
                    details=f"Not pulled — run `ollama pull {default}`",
                ),
            )
        return models

    async def health(self) -> ComponentHealth:
        started = time.perf_counter()
        try:
            response = await self._client.get("/api/version", timeout=3.0)
            response.raise_for_status()
            version = response.json().get("version", "unknown")
        except (httpx.HTTPError, ValueError) as exc:
            return ComponentHealth(status="down", latency_ms=_elapsed_ms(started), detail=str(exc) or type(exc).__name__)
        return ComponentHealth(status="ok", latency_ms=_elapsed_ms(started), detail=f"Ollama {version}")


class CloudProvider:
    """OpenAI-compatible Chat Completions client. Simulates responses when no API key is configured."""

    target: RouteTarget = "cloud"

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    @property
    def _headers(self) -> dict[str, str]:
        key = self._settings.cloud_api_key.get_secret_value() if self._settings.cloud_api_key else ""
        return {"Authorization": f"Bearer {key}"}

    async def stream_chat(
        self, messages: Sequence[ChatMessage], model: str, temperature: float
    ) -> AsyncIterator[str]:
        if not self._settings.cloud_enabled:
            raise ProviderError("cloud_disabled", "Cloud inference is disabled by configuration.")
        if self._settings.cloud_mock_mode:
            async for token in self._mock_stream(messages, model):
                yield token
            return

        payload = {
            "model": model,
            "messages": [m.model_dump() for m in messages],
            "stream": True,
            "temperature": temperature,
        }
        try:
            async with self._client.stream(
                "POST", "/chat/completions", json=payload, headers=self._headers
            ) as response:
                if response.status_code != 200:
                    detail = _extract_error_message(await response.aread())
                    status = response.status_code
                    if status in (401, 403):
                        raise ProviderError("cloud_auth_failed", f"Cloud provider rejected credentials: {detail}")
                    if status == 429:
                        raise ProviderError("cloud_rate_limited", f"Cloud provider rate limit: {detail}", retryable=True)
                    raise ProviderError(
                        "cloud_http_error",
                        f"Cloud provider returned HTTP {status}: {detail}",
                        retryable=status >= 500,
                    )

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk: dict[str, Any] = json.loads(data)
                    except json.JSONDecodeError:
                        logger.warning("Skipping malformed cloud stream line: %r", data[:200])
                        continue
                    if error := chunk.get("error"):
                        raise ProviderError("cloud_error", str(error.get("message", error)) if isinstance(error, dict) else str(error))
                    for choice in chunk.get("choices") or []:
                        content = (choice.get("delta") or {}).get("content")
                        if content:
                            yield content
        except httpx.ConnectError as exc:
            raise ProviderError(
                "cloud_unreachable", f"Cannot reach cloud provider at {self._settings.cloud_base_url}.", retryable=True
            ) from exc
        except httpx.TimeoutException as exc:
            raise ProviderError("cloud_timeout", "Cloud provider did not respond in time.", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("cloud_transport_error", f"Cloud connection failed: {exc}", retryable=True) from exc

    async def _mock_stream(self, messages: Sequence[ChatMessage], model: str) -> AsyncIterator[str]:
        prompt = messages[-1].content.strip()
        excerpt = prompt if len(prompt) <= 160 else f"{prompt[:157]}..."
        text = (
            f"**[Simulated {self._settings.cloud_provider_name} response · {model}]**\n\n"
            "No `CLOUD_API_KEY` is configured, so this reply is generated locally by the backend to "
            "exercise the cloud route end to end.\n\n"
            f"Your request — \"{excerpt}\" — was classified as complex, multi-step work. "
            "With a key configured, it would be answered by the approved cloud model with:\n\n"
            "1. A breakdown of the problem into its component questions.\n"
            "2. Analysis of each component with supporting reasoning.\n"
            "3. A synthesized recommendation and the trade-offs behind it."
        )
        await asyncio.sleep(0.35)  # Simulated network + queueing delay so TTFT telemetry is realistic.
        for index, word in enumerate(text.split(" ")):
            yield word if index == 0 else f" {word}"
            await asyncio.sleep(0.025)

    async def list_models(self) -> list[ModelInfo]:
        settings = self._settings
        if not settings.cloud_enabled:
            return []
        names = list(dict.fromkeys([settings.cloud_default_model, *settings.cloud_models]))
        details = "Simulated (no API key)" if settings.cloud_mock_mode else settings.cloud_provider_name
        return [
            ModelInfo(
                id=name,
                name=name,
                provider="cloud",
                available=True,
                is_default=name == settings.cloud_default_model,
                details=details,
            )
            for name in names
        ]

    async def health(self) -> ComponentHealth:
        if not self._settings.cloud_enabled:
            return ComponentHealth(status="disabled", detail="Cloud inference disabled")
        if self._settings.cloud_mock_mode:
            return ComponentHealth(status="mock", detail="No API key configured; responses are simulated")
        started = time.perf_counter()
        try:
            response = await self._client.get("/models", headers=self._headers, timeout=5.0)
        except httpx.HTTPError as exc:
            return ComponentHealth(status="down", latency_ms=_elapsed_ms(started), detail=str(exc) or type(exc).__name__)
        if response.status_code in (401, 403):
            return ComponentHealth(status="down", latency_ms=_elapsed_ms(started), detail="Credentials rejected")
        if response.status_code >= 400:
            return ComponentHealth(
                status="degraded", latency_ms=_elapsed_ms(started), detail=f"HTTP {response.status_code}"
            )
        return ComponentHealth(status="ok", latency_ms=_elapsed_ms(started), detail=self._settings.cloud_provider_name)
