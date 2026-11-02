// ---------------------------------------------------------------------------
// Domain types (camelCase, UI-facing)
// ---------------------------------------------------------------------------

export type RouteTarget = 'local' | 'cloud';
export type RoutePreference = 'auto' | RouteTarget;
export type MessageRole = 'system' | 'user' | 'assistant';
export type MessageStatus = 'complete' | 'streaming' | 'error' | 'stopped';

export interface ChatMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly status: MessageStatus;
  readonly createdAt: number;
  readonly route?: RouteTarget;
  readonly model?: string;
  readonly error?: string;
}

/** What the model selector resolves to: smart routing, or a pinned provider + model. */
export interface ModelSelection {
  readonly route: RoutePreference;
  readonly model: string | null;
}

export interface SendOptions {
  readonly selection: ModelSelection;
  readonly isSimple: boolean;
  readonly temperature?: number;
}

export type TelemetryStatus = 'idle' | 'routing' | 'streaming' | 'complete' | 'error' | 'stopped';

export interface TelemetryState {
  readonly status: TelemetryStatus;
  readonly route: RouteTarget | null;
  readonly model: string | null;
  readonly reason: string | null;
  readonly sensitive: boolean;
  readonly fallbackUsed: boolean;
  /** Client-measured: request sent → first token rendered. */
  readonly ttftMs: number | null;
  /** Client-measured: request sent → stream finished. */
  readonly latencyMs: number | null;
  /** Server-measured values from the `telemetry` event. */
  readonly serverTtftMs: number | null;
  readonly serverLatencyMs: number | null;
  readonly outputChars: number;
  readonly startedAt: number | null;
}

// ---------------------------------------------------------------------------
// Wire types (snake_case, mirror backend/app/schemas)
// ---------------------------------------------------------------------------

export interface ChatRequestPayload {
  messages: { role: MessageRole; content: string }[];
  route: RoutePreference;
  model: string | null;
  is_simple: boolean;
  temperature: number;
}

export interface StreamMetaEvent {
  request_id: string;
  route: RouteTarget;
  model: string;
  reason: string;
  sensitive: boolean;
  fallback: boolean;
}

export interface StreamTokenEvent {
  content: string;
}

export interface StreamTelemetryEvent {
  request_id: string;
  route: RouteTarget;
  model: string;
  ttft_ms: number | null;
  latency_ms: number;
  output_chunks: number;
  output_chars: number;
  fallback_used: boolean;
}

export interface StreamErrorEvent {
  code: string;
  message: string;
  route: RouteTarget | null;
  retryable: boolean;
}

export interface StreamDoneEvent {
  request_id: string;
}

export type StreamEvent =
  | { event: 'meta'; data: StreamMetaEvent }
  | { event: 'token'; data: StreamTokenEvent }
  | { event: 'telemetry'; data: StreamTelemetryEvent }
  | { event: 'error'; data: StreamErrorEvent }
  | { event: 'done'; data: StreamDoneEvent };

export interface ModelInfo {
  id: string;
  name: string;
  provider: RouteTarget;
  available: boolean;
  is_default: boolean;
  details: string | null;
}

export interface ModelsResponse {
  models: ModelInfo[];
  default_local: string;
  default_cloud: string | null;
}

export type ComponentStatus = 'ok' | 'degraded' | 'down' | 'mock' | 'disabled';

export interface ComponentHealth {
  status: ComponentStatus;
  latency_ms: number | null;
  detail: string | null;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  environment: string;
  timestamp: string;
  components: {
    api: ComponentHealth;
    ollama: ComponentHealth;
    cloud: ComponentHealth;
  };
}
