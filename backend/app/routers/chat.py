import logging
from collections.abc import AsyncIterator
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.dependencies import RouterServiceDep
from app.core.sse import SSE_HEADERS, format_sse
from app.schemas.chat import ChatRequest, RouteDecision

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# Custom headers the browser is allowed to read (mirrored in CORS expose_headers).
TELEMETRY_HEADERS = ("X-Request-ID", "X-WorkMate-Route", "X-WorkMate-Model", "X-WorkMate-Route-Reason")


def _header_safe(value: str) -> str:
    return value.encode("ascii", errors="replace").decode("ascii").replace("\r", " ").replace("\n", " ")


@router.post(
    "/stream",
    response_class=StreamingResponse,
    summary="Stream a chat completion as Server-Sent Events",
    responses={200: {"content": {"text/event-stream": {}}, "description": "SSE stream of meta/token/telemetry/error/done events."}},
)
async def stream_chat(payload: ChatRequest, service: RouterServiceDep) -> StreamingResponse:
    request_id = uuid4().hex
    decision = service.classify(payload)
    logger.info(
        "request=%s routed to %s (%s): %s", request_id, decision.target, decision.model, decision.reason
    )

    async def event_source() -> AsyncIterator[str]:
        async for event, data in service.stream(payload, decision, request_id):
            yield format_sse(event, data)

    headers = {
        **SSE_HEADERS,
        "X-Request-ID": request_id,
        "X-WorkMate-Route": decision.target,
        "X-WorkMate-Model": _header_safe(decision.model),
        "X-WorkMate-Route-Reason": _header_safe(decision.reason),
    }
    return StreamingResponse(event_source(), media_type="text/event-stream", headers=headers)


@router.post("/route", summary="Dry-run the routing classifier without generating a response")
async def preview_route(payload: ChatRequest, service: RouterServiceDep) -> RouteDecision:
    return service.classify(payload)
