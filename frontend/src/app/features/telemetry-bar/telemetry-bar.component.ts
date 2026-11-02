import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TelemetryStatus } from '../../core/models/chat.model';
import { ChatService } from '../../core/services/chat.service';

const STATUS_LABELS: Record<TelemetryStatus, string> = {
  idle: 'Idle',
  routing: 'Routing',
  streaming: 'Streaming',
  complete: 'Complete',
  error: 'Error',
  stopped: 'Stopped',
};

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value).toLocaleString()} ms`;
}

@Component({
  selector: 'wm-telemetry-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <div class="bar" role="status" aria-live="polite" aria-label="Live request telemetry">
      <span class="stat status" [attr.data-status]="t().status">
        <span class="dot"></span>
        {{ statusLabel() }}
      </span>

      <span class="stat route" [attr.data-route]="t().route" [matTooltip]="t().reason ?? 'No request yet'">
        <mat-icon>{{ t().route === 'cloud' ? 'cloud' : t().route === 'local' ? 'shield' : 'alt_route' }}</mat-icon>
        <span class="label">Route</span>
        <span class="value">{{ routeLabel() }}</span>
        @if (t().model) {
          <span class="model">{{ t().model }}</span>
        }
      </span>

      @if (t().sensitive) {
        <span class="stat flag" matTooltip="Sensitive content detected — pinned to local inference">
          <mat-icon>lock</mat-icon> Sensitive
        </span>
      }
      @if (t().fallbackUsed) {
        <span class="stat flag warn" matTooltip="Primary provider failed; served by the fallback provider">
          <mat-icon>swap_horiz</mat-icon> Fallback
        </span>
      }

      <span class="spacer"></span>

      <span class="stat metric" [matTooltip]="'Server: ' + format(t().serverTtftMs)">
        <mat-icon>bolt</mat-icon>
        <span class="label">TTFT</span>
        <span class="value mono">{{ format(t().ttftMs) }}</span>
      </span>
      <span class="stat metric" [matTooltip]="'Server: ' + format(t().serverLatencyMs)">
        <mat-icon>timer</mat-icon>
        <span class="label">Latency</span>
        <span class="value mono" [class.live]="isActive()">{{ format(latency()) }}</span>
      </span>
      @if (t().outputChars > 0) {
        <span class="stat metric hide-sm">
          <mat-icon>notes</mat-icon>
          <span class="value mono">{{ t().outputChars.toLocaleString() }} chars</span>
        </span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      min-height: 44px;
      overflow-x: auto;
      scrollbar-width: none;
      font: var(--mat-sys-label-medium);
    }
    .spacer { flex: 1; }
    .stat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .stat mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .label { opacity: 0.75; }
    .value { color: var(--mat-sys-on-surface); font-weight: 500; }
    .mono { font-family: var(--wm-mono); font-variant-numeric: tabular-nums; }
    .live { color: var(--mat-sys-primary); }
    .model { font-family: var(--wm-mono); opacity: 0.8; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mat-sys-outline); }
    .status[data-status='routing'] .dot,
    .status[data-status='streaming'] .dot { background: var(--mat-sys-primary); animation: pulse 1s ease-in-out infinite; }
    .status[data-status='complete'] .dot { background: var(--wm-local); }
    .status[data-status='error'] .dot { background: var(--mat-sys-error); }
    .route[data-route='local'] { background: var(--wm-local-container); color: var(--wm-local); }
    .route[data-route='cloud'] { background: var(--wm-cloud-container); color: var(--wm-cloud); }
    .route[data-route] .value { color: inherit; }
    .flag { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .flag.warn { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    @keyframes pulse { 50% { opacity: 0.35; } }
    @media (max-width: 600px) {
      .label, .model, .hide-sm { display: none; }
      .bar { padding: 6px 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dot { animation: none !important; }
    }
  `,
})
export class TelemetryBarComponent {
  private readonly chat = inject(ChatService);
  private readonly now = signal(performance.now());

  protected readonly t = this.chat.telemetry;
  protected readonly format = formatMs;
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.t().status]);
  protected readonly isActive = computed(() => this.t().status === 'routing' || this.t().status === 'streaming');
  protected readonly routeLabel = computed(() => {
    const route = this.t().route;
    return route === 'local' ? 'Local' : route === 'cloud' ? 'Cloud' : 'Auto';
  });

  /** Final client latency once finished; a live ticking value while the request is in flight. */
  protected readonly latency = computed(() => {
    const { latencyMs, startedAt } = this.t();
    if (latencyMs !== null) {
      return latencyMs;
    }
    return this.isActive() && startedAt !== null ? this.now() - startedAt : null;
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.isActive()) {
        return;
      }
      const handle = setInterval(() => this.now.set(performance.now()), 100);
      onCleanup(() => clearInterval(handle));
    });
  }
}
