import { Injectable, computed, inject, signal } from '@angular/core';

import { API_BASE_URL } from '../config/api.config';
import {
  ChatMessage,
  ChatRequestPayload,
  MessageRole,
  MessageStatus,
  SendOptions,
  StreamEvent,
  TelemetryState,
} from '../models/chat.model';
import { RawSseEvent, SseParser } from '../utils/sse-parser';

const MAX_HISTORY_MESSAGES = 40;
const STREAM_EVENTS = new Set<string>(['meta', 'token', 'telemetry', 'error', 'done']);

const INITIAL_TELEMETRY: TelemetryState = {
  status: 'idle',
  route: null,
  model: null,
  reason: null,
  sensitive: false,
  fallbackUsed: false,
  ttftMs: null,
  latencyMs: null,
  serverTtftMs: null,
  serverLatencyMs: null,
  outputChars: 0,
  startedAt: null,
};

let messageSequence = 0;

function createMessage(role: MessageRole, content: string, status: MessageStatus): ChatMessage {
  // Not crypto.randomUUID(): it is unavailable on plain-HTTP intranet hosts (non-secure contexts).
  messageSequence += 1;
  return { id: `${Date.now().toString(36)}-${messageSequence}`, role, content, status, createdAt: Date.now() };
}

function toStreamEvent(raw: RawSseEvent): StreamEvent | null {
  if (!STREAM_EVENTS.has(raw.event)) {
    return null;
  }
  try {
    return { event: raw.event, data: JSON.parse(raw.data) } as StreamEvent;
  } catch {
    console.warn('Ignoring malformed SSE payload', raw);
    return null;
  }
}

async function describeHttpError(response: Response): Promise<string> {
  const prefix = `Request failed (HTTP ${response.status})`;
  try {
    const body: unknown = await response.json();
    const detail = (body as { detail?: unknown }).detail;
    if (Array.isArray(detail)) {
      return `${prefix}: ${detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ')}`;
    }
    if (typeof detail === 'string') {
      return `${prefix}: ${detail}`;
    }
  } catch {
    // Non-JSON body; fall through to the generic message.
  }
  return `${prefix}.`;
}

/**
 * Owns the conversation and live telemetry state, and streams responses from
 * `POST /chat/stream` via fetch + ReadableStream (EventSource cannot POST).
 *
 * Tokens are buffered and committed to the message signal at most once per animation
 * frame, so fast models never trigger more than one render per frame.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly apiBaseUrl = inject(API_BASE_URL);

  private readonly _messages = signal<readonly ChatMessage[]>([]);
  private readonly _telemetry = signal<TelemetryState>(INITIAL_TELEMETRY);
  private readonly _isStreaming = signal(false);

  readonly messages = this._messages.asReadonly();
  readonly telemetry = this._telemetry.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();
  readonly hasMessages = computed(() => this._messages().length > 0);

  private abortController: AbortController | null = null;
  private activeMessageId: string | null = null;
  private pendingText = '';
  private frameHandle: number | null = null;

  async send(prompt: string, options: SendOptions): Promise<void> {
    const content = prompt.trim();
    if (!content || this._isStreaming()) {
      return;
    }

    const history = this.buildHistory();
    const userMessage = createMessage('user', content, 'complete');
    const assistantMessage = createMessage('assistant', '', 'streaming');
    this._messages.update((list) => [...list, userMessage, assistantMessage]);
    this.activeMessageId = assistantMessage.id;
    this._isStreaming.set(true);

    const startedAt = performance.now();
    this._telemetry.set({ ...INITIAL_TELEMETRY, status: 'routing', startedAt });

    const payload: ChatRequestPayload = {
      messages: [...history, { role: 'user', content }],
      route: options.selection.route,
      model: options.selection.route === 'auto' ? null : options.selection.model,
      is_simple: options.isSimple,
      temperature: options.temperature ?? 0.7,
    };

    const controller = new AbortController();
    this.abortController = controller;

    try {
      const response = await fetch(`${this.apiBaseUrl}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await describeHttpError(response));
      }
      if (!response.body) {
        throw new Error('This browser does not support streaming responses.');
      }
      this.applyRouteHeaders(response.headers);

      const terminated = await this.consume(response.body, startedAt);
      if (!terminated) {
        this.failActive('The connection closed before the response finished.', startedAt);
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        this.finishActive('stopped', startedAt);
      } else {
        this.failActive(this.describeError(error), startedAt);
      }
    } finally {
      this.flushPending();
      this.abortController = null;
      this.activeMessageId = null;
      this._isStreaming.set(false);
    }
  }

  stop(): void {
    this.abortController?.abort();
  }

  clear(): void {
    this.stop();
    this._messages.set([]);
    this._telemetry.set(INITIAL_TELEMETRY);
  }

  /** Reads the SSE body; resolves `true` once a terminal (`done`/`error`) event has been handled. */
  private async consume(body: ReadableStream<Uint8Array>, startedAt: number): Promise<boolean> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        // `stream: true` keeps multi-byte characters split across chunks intact.
        for (const raw of parser.feed(decoder.decode(value, { stream: true }))) {
          if (this.handleEvent(raw, startedAt)) {
            return true;
          }
        }
      }
      return parser.feed(decoder.decode()).concat(parser.flush()).some((raw) => this.handleEvent(raw, startedAt));
    } finally {
      reader.releaseLock();
    }
  }

  private handleEvent(raw: RawSseEvent, startedAt: number): boolean {
    const streamEvent = toStreamEvent(raw);
    if (!streamEvent) {
      return false;
    }

    switch (streamEvent.event) {
      case 'meta': {
        const { route, model, reason, sensitive, fallback } = streamEvent.data;
        this._telemetry.update((t) => ({ ...t, route, model, reason, sensitive, fallbackUsed: t.fallbackUsed || fallback }));
        this.patchActive((m) => ({ ...m, route, model }));
        return false;
      }
      case 'token': {
        if (this._telemetry().ttftMs === null) {
          const ttftMs = performance.now() - startedAt;
          this._telemetry.update((t) => ({ ...t, status: 'streaming', ttftMs }));
        }
        this.queueText(streamEvent.data.content);
        return false;
      }
      case 'telemetry': {
        const { ttft_ms, latency_ms, output_chars, fallback_used } = streamEvent.data;
        this._telemetry.update((t) => ({
          ...t,
          serverTtftMs: ttft_ms,
          serverLatencyMs: latency_ms,
          outputChars: output_chars,
          fallbackUsed: t.fallbackUsed || fallback_used,
        }));
        return false;
      }
      case 'error':
        this.failActive(streamEvent.data.message, startedAt);
        return true;
      case 'done':
        this.finishActive('complete', startedAt);
        return true;
    }
  }

  private applyRouteHeaders(headers: Headers): void {
    const route = headers.get('X-WorkMate-Route');
    if (route === 'local' || route === 'cloud') {
      this._telemetry.update((t) => ({
        ...t,
        route,
        model: headers.get('X-WorkMate-Model') ?? t.model,
        reason: headers.get('X-WorkMate-Route-Reason') ?? t.reason,
      }));
    }
  }

  private queueText(text: string): void {
    this.pendingText += text;
    if (this.frameHandle === null) {
      this.frameHandle = requestAnimationFrame(() => {
        this.frameHandle = null;
        this.flushPending();
      });
    }
  }

  private flushPending(): void {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (!this.pendingText) {
      return;
    }
    const text = this.pendingText;
    this.pendingText = '';
    this.patchActive((m) => ({ ...m, content: m.content + text }));
  }

  private finishActive(status: 'complete' | 'stopped', startedAt: number): void {
    this.flushPending();
    this.patchActive((m) => ({ ...m, status }));
    this._telemetry.update((t) => ({ ...t, status, latencyMs: performance.now() - startedAt }));
  }

  private failActive(message: string, startedAt: number): void {
    this.flushPending();
    this.patchActive((m) => ({ ...m, status: 'error', error: message }));
    this._telemetry.update((t) => ({ ...t, status: 'error', latencyMs: performance.now() - startedAt }));
  }

  private patchActive(patch: (message: ChatMessage) => ChatMessage): void {
    const id = this.activeMessageId;
    if (id === null) {
      return;
    }
    this._messages.update((list) => list.map((m) => (m.id === id ? patch(m) : m)));
  }

  /** Prior turns sent as context; failed assistant turns are excluded. */
  private buildHistory(): ChatRequestPayload['messages'] {
    return this._messages()
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.status !== 'error' && m.content.trim()))
      .slice(-MAX_HISTORY_MESSAGES)
      .map(({ role, content }) => ({ role, content }));
  }

  private describeError(error: unknown): string {
    if (error instanceof TypeError) {
      return `Cannot reach the WorkMate API at ${this.apiBaseUrl}. Check that the backend is running.`;
    }
    return error instanceof Error ? error.message : 'An unexpected error occurred.';
  }
}
