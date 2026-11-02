export interface RawSseEvent {
  event: string;
  data: string;
  id: string | null;
}

/**
 * Incremental Server-Sent Events parser (WHATWG event-stream format).
 *
 * `EventSource` only supports GET, so the chat stream is read with `fetch` and decoded here.
 * Network chunks can split frames anywhere; incomplete frames are buffered until the
 * blank-line terminator arrives.
 */
export class SseParser {
  private buffer = '';

  feed(chunk: string): RawSseEvent[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const events: RawSseEvent[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const parsed = SseParser.parseFrame(frame);
      if (parsed) {
        events.push(parsed);
      }
      boundary = this.buffer.indexOf('\n\n');
    }
    return events;
  }

  /** Parses whatever remains once the stream has closed. */
  flush(): RawSseEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    const parsed = rest.trim() ? SseParser.parseFrame(rest) : null;
    return parsed ? [parsed] : [];
  }

  private static parseFrame(frame: string): RawSseEvent | null {
    let event = 'message';
    let id: string | null = null;
    const data: string[] = [];

    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) {
        continue; // Blank line or comment (e.g. keep-alive ping).
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      switch (field) {
        case 'event':
          event = value;
          break;
        case 'data':
          data.push(value);
          break;
        case 'id':
          id = value;
          break;
      }
    }
    return data.length ? { event, data: data.join('\n'), id } : null;
  }
}
