import json

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from app.schemas.chat import ChatMessage, ChatRequest
from app.services.router_service import RequestClassifier

# Port 9 (discard) is reliably closed, so Ollama calls fail fast with a connection error.
UNREACHABLE_OLLAMA = "http://127.0.0.1:9"


def _request(prompt: str, **kwargs) -> ChatRequest:
    return ChatRequest(messages=[ChatMessage(role="user", content=prompt)], **kwargs)


@pytest.fixture
def classifier() -> RequestClassifier:
    return RequestClassifier(Settings(_env_file=None))


def test_sensitive_prompt_routes_local(classifier: RequestClassifier) -> None:
    decision = classifier.classify(_request("Summarize the payroll changes for Q3"))
    assert decision.target == "local"
    assert decision.sensitive is True
    assert "sensitive:payroll" in decision.matched_rules


def test_sensitive_overrides_explicit_cloud(classifier: RequestClassifier) -> None:
    decision = classifier.classify(_request("Draft a note about her salary", route="cloud", model="gpt-4o"))
    assert decision.target == "local"
    assert decision.model == "llama3.2"


def test_sensitive_content_in_history_keeps_local(classifier: RequestClassifier) -> None:
    request = ChatRequest(
        messages=[
            ChatMessage(role="user", content="Here is the confidential board memo: ..."),
            ChatMessage(role="assistant", content="Got it."),
            ChatMessage(role="user", content="Now analyze it step by step"),
        ]
    )
    assert classifier.classify(request).target == "local"


def test_complex_prompt_routes_cloud(classifier: RequestClassifier) -> None:
    decision = classifier.classify(_request("Compare our three vendor options and analyze the trade-offs"))
    assert decision.target == "cloud"
    assert {"complex:compare", "complex:trade-offs"} <= set(decision.matched_rules)


def test_marked_simple_routes_local(classifier: RequestClassifier) -> None:
    assert classifier.classify(_request("Analyze this sentence", is_simple=True)).target == "local"


def test_long_prompt_routes_cloud(classifier: RequestClassifier) -> None:
    assert classifier.classify(_request("word " * 200)).target == "cloud"


def test_phrase_matching_respects_word_boundaries(classifier: RequestClassifier) -> None:
    # "pii" must not match inside "happiness"; "analyze" alone is complex.
    decision = classifier.classify(_request("What drives happiness at work?"))
    assert decision.target == "local"
    assert decision.sensitive is False


def test_model_requires_explicit_route() -> None:
    with pytest.raises(ValueError):
        _request("hi", model="llama3.2")


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for frame in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in frame.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


@pytest.fixture
def client_factory(monkeypatch: pytest.MonkeyPatch):
    def build(**env: str) -> TestClient:
        monkeypatch.setenv("OLLAMA_BASE_URL", UNREACHABLE_OLLAMA)
        monkeypatch.setenv("CLOUD_API_KEY", "")
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
        return TestClient(create_app())

    yield build
    get_settings.cache_clear()


def test_unreachable_ollama_on_sensitive_prompt_emits_error_event(client_factory) -> None:
    with client_factory() as client:
        response = client.post(
            "/api/v1/chat/stream", json={"messages": [{"role": "user", "content": "Explain my salary slip"}]}
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-workmate-route"] == "local"
    events = _parse_sse(response.text)
    names = [name for name, _ in events]
    assert names == ["meta", "telemetry", "error"]
    assert events[-1][1]["code"] == "ollama_unreachable"


def test_unreachable_ollama_falls_back_to_mock_cloud(client_factory) -> None:
    with client_factory() as client:
        response = client.post(
            "/api/v1/chat/stream", json={"messages": [{"role": "user", "content": "Write a haiku about Mondays"}]}
        )
    events = _parse_sse(response.text)
    metas = [data for name, data in events if name == "meta"]
    assert [m["route"] for m in metas] == ["local", "cloud"]
    assert metas[1]["fallback"] is True
    assert events[-1][0] == "done"
    telemetry = next(data for name, data in events if name == "telemetry")
    assert telemetry["fallback_used"] is True and telemetry["ttft_ms"] is not None


def test_health_reports_degraded_when_ollama_down(client_factory) -> None:
    with client_factory() as client:
        body = client.get("/api/v1/health").json()
    assert body["status"] == "degraded"
    assert body["components"]["ollama"]["status"] == "down"
    assert body["components"]["cloud"]["status"] == "mock"


def test_models_lists_unpulled_default_and_cloud(client_factory) -> None:
    with client_factory() as client:
        body = client.get("/api/v1/models").json()
    providers = {(m["id"], m["provider"], m["available"]) for m in body["models"]}
    assert ("llama3.2", "local", False) in providers
    assert ("gpt-4o-mini", "cloud", True) in providers


def test_cors_allows_angular_dev_origin(client_factory) -> None:
    with client_factory() as client:
        response = client.options(
            "/api/v1/chat/stream",
            headers={"Origin": "http://localhost:4200", "Access-Control-Request-Method": "POST"},
        )
    assert response.headers["access-control-allow-origin"] == "http://localhost:4200"
