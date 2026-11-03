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

## Project: WorkMate AI (Phase 0 Specification)

This is the practice project for the Angular Onboarding & Training Guide. Phase 0 covers the basics: an Angular front end that streams AI chat responses, shows which model answered, and displays simple usage numbers. Build it after you pass the guide's checkpoint (Stage 2).

Golden repo: [link to be added]

The golden repo is the reference build of this project, using the latest Angular and the team's opinionated conventions. Try each feature yourself first, then compare your code with it.

### 1. Project overview

WorkMate AI is an internal AI workspace for companies with fewer than 100 employees. Instead of staff pasting company information into public chatbots, WorkMate AI brings everyday productivity tasks and internal knowledge search into one internal Angular portal.

| Capability | What it means for users |
| --- | --- |
| Productivity tasks | Summarise text, rewrite messages, and pull out action items |
| Knowledge search | Ask questions about SOPs, handbooks, and policies (RAG: the AI answers using retrieved company documents) |
| Privacy-centric hybrid routing | Sensitive content and routine tasks run on a private local model (Ollama). Complex, non-sensitive questions can go to an approved cloud model |

### 2. Phase 0 scope

Phase 0 is about Angular fundamentals. You build the front end only and connect it to an existing back end.

#### In scope (Phase 0)

- Angular standalone app with Angular Material
- App shell with navigation and lazy-loaded routes
- Chat page that streams the answer token by token
- "Keep it local" toggle (`force_local`)
- Route badge and live telemetry bar (route, time to first token, latency)
- Available models list
- Simple telemetry summary page
- Loading, empty, and error states
- Unit tests for the chat service and main components

#### Out of scope (later phases)

- Building the FastAPI back end
- Document upload and knowledge search (RAG) screens
- Sign-in (OIDC) and role-based access
- Routing policy rules (local vs cloud)
- Conversation history across sessions
- Admin dashboards and cost reporting
- Production deployment

### 3. Architecture

In Phase 0 you own the top box. The back end, database, and models are provided.

```text
┌──────────────────────────────────────────────────────────────┐
│  Angular front end (YOU BUILD THIS IN PHASE 0)               │
│  - Standalone components + Angular Material                  │
│  - Signal-based state: messages, streaming flag, telemetry   │
│  - Streams answers with fetch + ReadableStream (SSE)         │
└───────────────────────────────┬──────────────────────────────┘
                                │  HTTP + Server-Sent Events
                                ▼
┌──────────────────────────────────────────────────────────────┐
│  FastAPI gateway (provided)                                  │
│  - Decides local vs cloud, runs RAG, checks access           │
└──────────┬─────────────────────┬─────────────────────┬───────┘
           ▼                     ▼                     ▼
   PostgreSQL + pgvector   Local Ollama model    Approved cloud model
   (data and embeddings)   (no external egress)  (complex reasoning)
```

### 4. Technology stack

| Area | Choice | Why |
| --- | --- | --- |
| Framework | Angular (latest, standalone) | Strict typing, built-in DI, router, forms, and HTTP |
| State | Signals (signal, computed), RxJS where streams fit | Simple synchronous state; no state library needed in Phase 0 |
| UI | Angular Material | Accessible toolbar, form fields, buttons, spinners, snackbars |
| Streaming | Server-Sent Events read with fetch | One-way token streaming. EventSource only supports GET, and this endpoint is a POST |
| Testing | Vitest (default runner) | Fast unit tests for services and components |
| Back end (provided) | FastAPI, PostgreSQL + pgvector, Ollama, Docker Compose | Runs locally so you can develop against real responses |

### 5. Project structure

Follow the feature-based structure from Step 8 of the guide.

```text
src/app/
  core/                     # app-wide singletons
    models/
      chat.models.ts        # ChatMessage, StreamEvent, TelemetryState
    services/
      ai-chat.service.ts    # sends prompts, reads the SSE stream, holds chat signals
      models.service.ts     # GET /models
      telemetry.service.ts  # GET /telemetry/summary
  shared/                   # reusable UI
    components/
      route-badge/          # shows LOCAL or CLOUD
  features/
    chat/                   # lazy-loaded /chat
      chat.page.ts
      message-list/
      prompt-box/
      telemetry-bar/
    telemetry/              # lazy-loaded /telemetry
      telemetry.page.ts
  app.routes.ts
  app.config.ts
```

### 6. Features and acceptance criteria

| Feature | Done when | Guide steps |
| --- | --- | --- |
| F1 App shell | Material toolbar with links to Chat and Telemetry; / redirects to /chat; both pages are lazy loaded | 2–3, 9 |
| F2 Send a prompt | Typing a prompt and pressing Enter or Send adds the user message; empty prompts can't be sent; Send is disabled while streaming | 5 |
| F3 Streamed answer | The assistant message appears and grows token by token; a spinner shows while streaming; the stream stops cleanly on `[DONE]` | 5–6 |
| F4 Keep it local | A toggle sends `force_local: true`; the answer's route badge shows `LOCAL` | 5 |
| F5 Telemetry bar | Shows active route, time to first token (TTFT), and latency for the latest answer | 5 |
| F6 Models list | Chat page shows available local and cloud models from `GET /models` | 5–6 |
| F7 Telemetry summary | `/telemetry` shows total requests, average TTFT, and failure count from `GET /telemetry/summary` | 5, 9 |
| F8 Errors | A failed request shows a friendly message (snackbar or inline) and the app stays usable | 14 |
| F9 Tests | Unit tests cover stream parsing, token appending, and the prompt box; `ng test` passes | 18 |

### 7. API contract (what the front end calls)

All endpoints are prefixed with `/api/v1`. In local development, proxy `/api` to the back end with the Angular dev-server proxy.

| Method | Endpoint | Used for |
| --- | --- | --- |
| `POST` | `/chat/stream` | Send a prompt and receive a streamed answer (F2–F5) |
| `GET` | `/models` | List available local and cloud models (F6) |
| `GET` | `/telemetry/summary` | Total requests, average TTFT, failure count (F7) |

#### Request body for `POST /chat/stream`

```json
{
  "conversation_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "prompt": "Summarize this internal project report...",
  "force_local": false,
  "task_hint": "summarization"
}
```

#### Response (text/event-stream)

One `data:` line per event, ending with `[DONE]`.

```text
data: {"type": "token", "content": "Here "}
data: {"type": "token", "content": "is "}
data: {"type": "metadata", "route": "local_ollama", "latency_ms": 1120, "ttft_ms": 240}
data: [DONE]
```

The API returns `route` as `local_ollama` or `cloud_api`. Map these to `local` / `cloud` in one place in the service, so components never see API names.

### 8. Implementation guide

#### Step 1: Types

```ts
src/app/core/models/chat.models.ts

export type ModelRoute = 'local' | 'cloud';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  routeUsed?: ModelRoute;
  latencyMs?: number;
}

export interface TelemetryState {
  activeRoute: ModelRoute | 'idle';
  latencyMs: number;
  ttftMs: number;
  requestCount: number;
}

// Shape of each SSE "data:" event from /chat/stream
export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'metadata'; route: 'local_ollama' | 'cloud_api'; latency_ms: number; ttft_ms: number };
```

#### Step 2: Chat service with signals

`src/app/core/services/ai-chat.service.ts` holds the chat state as signals and reads the stream. Keep components thin: they read signals and call `sendPrompt()`.

```ts
@Injectable({ providedIn: 'root' })
export class AiChatService {
  readonly messages = signal<ChatMessage[]>([]);
  readonly isStreaming = signal(false);
  readonly telemetry = signal<TelemetryState>({ activeRoute: 'idle', latencyMs: 0, ttftMs: 0, requestCount: 0 });

  async sendPrompt(conversationId: string, prompt: string, forceLocal = false) {
    const assistantId = crypto.randomUUID();
    this.messages.update(list => [
      ...list,
      { id: crypto.randomUUID(), sender: 'user', content: prompt, timestamp: new Date() },
      { id: assistantId, sender: 'assistant', content: '', timestamp: new Date() },
    ]);
    this.isStreaming.set(true);

    try {
      const response = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, prompt, force_local: forceLocal }),
      });

      if (!response.ok || !response.body) throw new Error(`Request failed: ${response.status}`);
      await this.readStream(response.body, assistantId);
    } catch {
      this.appendToken(assistantId, '\n[Something went wrong. Please try again.]');
    } finally {
      this.isStreaming.set(false);
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>, assistantId: string) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();

        if (payload === '[DONE]') return;
        this.handleEvent(JSON.parse(payload) as StreamEvent, assistantId);
      }
    }
  }

  private handleEvent(event: StreamEvent, assistantId: string) {
    if (event.type === 'token') {
      this.appendToken(assistantId, event.content);
      return;
    }

    const route = event.route === 'local_ollama' ? 'local' : 'cloud';
    this.messages.update(list =>
      list.map(m => (m.id === assistantId ? { ...m, routeUsed: route, latencyMs: event.latency_ms } : m)),
    );

    this.telemetry.update(t => ({
      activeRoute: route,
      latencyMs: event.latency_ms,
      ttftMs: event.ttft_ms,
      requestCount: t.requestCount + 1,
    }));
  }

  private appendToken(id: string, token: string) {
    this.messages.update(list => list.map(m => (m.id === id ? { ...m, content: m.content + token } : m)));
  }
}
```

#### Step 3: Chat page template

Use the built-in control flow (`@for`, `@if`) and read signals directly in the template.

```html
<app-telemetry-bar [telemetry]="chat.telemetry()" />
<div class="messages">
  @for (msg of chat.messages(); track msg.id) {
    <div class="bubble" [class.user]="msg.sender === 'user'">
      <div class="bubble-header">
        {{ msg.sender === 'user' ? 'You' : 'WorkMate AI' }}
        @if (msg.routeUsed) { <app-route-badge [route]="msg.routeUsed" /> }
      </div>
      <div class="bubble-body">{{ msg.content }}</div>
    </div>
  } @empty {
    <p class="empty">Ask WorkMate to summarise, rewrite, or extract actions.</p>
  }

  @if (chat.isStreaming()) {
    <div class="streaming"><mat-spinner diameter="20" /> Generating response…</div>
  }
</div>
<app-prompt-box [disabled]="chat.isStreaming()" (send)="onSend($event)" />
```

#### Step 4: Build order

| Order | Task | Features |
| --- | --- | --- |
| 1 | Scaffold: `ng new workmate-ai --routing --style=scss`, then `ng add @angular/material` | — |
| 2 | Start the provided back end and add a dev-server proxy for `/api` | — |
| 3 | App shell, routes, and empty lazy-loaded pages | F1 |
| 4 | Types and `AiChatService`, with unit tests for stream parsing | F3, F9 |
| 5 | Chat page: message list, prompt box, spinner | F2, F3 |
| 6 | Keep-it-local toggle, route badge, telemetry bar | F4, F5 |
| 7 | Models list and telemetry summary page (`HttpClient` + `toSignal()` or `httpResource()`) | F6, F7 |
| 8 | Error handling and final tests | F8, F9 |

### 9. Conventions (opinionated)

- Standalone components only; `input()`, `output()`, `model()` instead of decorators
- State lives in services as signals; components read signals and stay thin
- `inject()` for dependencies; no constructor injection
- Built-in control flow (`@if`, `@for` with `track`); no `*ngIf` / `*ngFor`
- Prefer `toSignal()`, the async pipe, or `httpResource()` over manual `subscribe()`
- API field names (snake_case) are mapped to app types (camelCase) inside services
- One feature per folder under `features/`; shared UI under `shared/`

### 10. Security basics for Phase 0

- Never store tokens or user IDs in `localStorage`, and never send a user ID from the client. The back end gets identity from the session.
- Render AI output as text with interpolation (`{{ }}`). Don't bind it with `[innerHTML]`.
- No API keys or secrets in the front-end code or `environment.ts`.
- Use only test data. Never paste real company or customer documents while developing.

### 11. Definition of done

- Features F1 to F9 meet their acceptance criteria
- `ng build` and `ng test` pass with no lint errors
- Code follows the conventions in section 9
- You have compared your solution with the golden repo and can explain the differences
- Merge Request opened and reviewed in `#kb-angular`

#### Reference for later phases: database schema

Not needed in Phase 0. Shown so you understand the data the back end stores.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'employee', -- 'employee', 'admin', 'auditor'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New Chat',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender VARCHAR(20) NOT NULL, -- 'user', 'assistant'
    content TEXT NOT NULL,
    route_used VARCHAR(50), -- 'local_ollama', 'cloud_api'
    latency_ms INTEGER,
    tokens_used INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    access_level VARCHAR(50) DEFAULT 'all', -- 'all', 'hr_only', 'engineering'
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding VECTOR(1536), -- 1536 for text-embedding-3-small, 768 for nomic-embed-text
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX document_chunks_embedding_idx
    ON document_chunks USING hnsw (embedding vector_cosine_ops);
```

#### Reference for later phases: platform roadmap and compliance

- Knowledge base: `POST /documents/upload` (PDF, DOCX, TXT) and `POST /knowledge/query` for semantic search with source references
- Routing policy: sensitive keywords or documents go to the local model; complex analysis can go to the approved cloud model
- Local air-gapping: Ollama instances serving confidential data must have no outbound connections to third parties
- Strict fallback: if the local model fails, confidential payloads are never silently sent to a cloud API without an explicit admin exemption
- Document isolation: RAG search filters chunks by the user's access level, so employees can't read restricted content
- Identity: taken from signed session headers (OIDC/JWT), never from a client-supplied user ID