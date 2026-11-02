# WorkMate AI — Phase 0

Internal AI productivity hub: Angular 20 (zoneless, signals, Material 3) + FastAPI, with
rule-based routing between a private local model (Ollama) and an approved cloud LLM.

## Run everything with Docker

```bash
docker compose up --build
```

| Service  | URL                                   |
| -------- | ------------------------------------- |
| App      | http://localhost:8080                 |
| API docs | http://localhost:8000/api/v1/docs     |
| Ollama   | http://localhost:11434                |

The `ollama-init` job pulls `llama3.2` on first start (≈2 GB). Set `OLLAMA_DEFAULT_MODEL=qwen2.5`
to use a different model, and `CLOUD_API_KEY=...` to call a real OpenAI-compatible endpoint
(without a key, cloud responses are simulated so the route can still be exercised).

## Local development

```bash
# Backend (Python 3.10+)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
pytest

# Frontend
cd frontend
npm install
npm start            # http://localhost:4200 → calls http://localhost:8000 via CORS

# Local model
ollama serve && ollama pull llama3.2
```

## Routing rules (`backend/app/services/router_service.py`)

1. Sensitive phrase anywhere in the conversation → **local**, even if cloud was explicitly requested.
2. Explicit `route: "local" | "cloud"` → as requested.
3. `is_simple: true` → **local**.
4. Complex phrase (analyze, compare, step by step, …) or prompt ≥ 600 chars → **cloud**.
5. Otherwise → **local**.

If the chosen provider fails before emitting any tokens, the request falls back to the other
provider — except for sensitive requests, which never leave the local model.

## Streaming contract — `POST /api/v1/chat/stream`

Response headers: `X-Request-ID`, `X-WorkMate-Route`, `X-WorkMate-Model`, `X-WorkMate-Route-Reason`.

| SSE event   | Payload                                                         |
| ----------- | --------------------------------------------------------------- |
| `meta`      | route, model, reason, sensitive, fallback                       |
| `token`     | `{ "content": "..." }`                                          |
| `telemetry` | ttft_ms, latency_ms, output_chunks, output_chars, fallback_used |
| `error`     | code, message, route, retryable (terminal)                      |
| `done`      | request_id (terminal)                                           |
