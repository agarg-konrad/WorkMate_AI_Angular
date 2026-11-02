"""Wire contracts for the chat streaming API.

The stream is Server-Sent Events. Each SSE frame carries an `event` name and a JSON `data`
payload matching one of the models below:

    meta       -> StreamMeta      (routing decision; sent first, and again if a fallback occurs)
    token      -> TokenChunk      (incremental model output)
    telemetry  -> Telemetry       (timing summary; sent once generation finishes or fails)
    error      -> StreamError     (terminal failure)
    done       -> StreamDone      (terminal success)
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

RouteTarget = Literal["local", "cloud"]
RoutePreference = Literal["auto", "local", "cloud"]
MessageRole = Literal["system", "user", "assistant"]
StreamEventName = Literal["meta", "token", "telemetry", "error", "done"]


class ChatMessage(BaseModel):
    role: MessageRole
    content: str = Field(min_length=1, max_length=32_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=100)
    route: RoutePreference = Field(
        default="auto",
        description="'auto' lets the classifier decide; 'local'/'cloud' pins the provider "
        "(sensitive content is always kept local).",
    )
    model: str | None = Field(
        default=None,
        description="Explicit model id. Requires route 'local' or 'cloud'.",
    )
    is_simple: bool = Field(default=False, description="Caller marks the request as simple → local.")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)

    @model_validator(mode="after")
    def _validate(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("The last message must have role 'user'.")
        if self.model is not None and self.route == "auto":
            raise ValueError("'model' requires 'route' to be 'local' or 'cloud'.")
        return self

    @property
    def latest_prompt(self) -> str:
        return self.messages[-1].content


class RouteDecision(BaseModel):
    target: RouteTarget
    model: str
    reason: str
    sensitive: bool = Field(description="True when the content must never be sent to the cloud.")
    matched_rules: list[str] = Field(default_factory=list)


class StreamMeta(BaseModel):
    request_id: str
    route: RouteTarget
    model: str
    reason: str
    sensitive: bool
    fallback: bool = False


class TokenChunk(BaseModel):
    content: str


class Telemetry(BaseModel):
    request_id: str
    route: RouteTarget
    model: str
    ttft_ms: float | None = Field(description="Server-side time to first token; null if none arrived.")
    latency_ms: float = Field(description="Server-side total generation time.")
    output_chunks: int
    output_chars: int
    fallback_used: bool


class StreamError(BaseModel):
    code: str
    message: str
    route: RouteTarget | None = None
    retryable: bool = False


class StreamDone(BaseModel):
    request_id: str
