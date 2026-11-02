from pydantic import BaseModel

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # Disables response buffering in nginx so tokens reach the browser immediately.
    "X-Accel-Buffering": "no",
}


def format_sse(event: str, data: BaseModel) -> str:
    """Serialize one Server-Sent Events frame. JSON never contains raw newlines, so one data line suffices."""
    return f"event: {event}\ndata: {data.model_dump_json()}\n\n"
