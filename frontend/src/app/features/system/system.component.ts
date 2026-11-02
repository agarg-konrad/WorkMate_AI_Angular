import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { ComponentHealth } from '../../core/models/chat.model';
import { SystemService } from '../../core/services/system.service';

interface HealthRow {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly health: ComponentHealth;
}

@Component({
  selector: 'wm-system',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>System status</h1>
        <button mat-stroked-button type="button" (click)="refresh()">
          <mat-icon>refresh</mat-icon> Refresh
        </button>
      </header>

      @switch (system.health().kind) {
        @case ('loading') {
          <mat-progress-bar mode="indeterminate" />
        }
        @case ('unreachable') {
          <mat-card appearance="outlined" class="banner error">
            <mat-icon>cloud_off</mat-icon> The WorkMate API is unreachable.
          </mat-card>
        }
      }

      <div class="grid">
        @for (row of rows(); track row.key) {
          <mat-card appearance="outlined" class="health-card" [attr.data-status]="row.health.status">
            <div class="card-head">
              <mat-icon>{{ row.icon }}</mat-icon>
              <span class="card-title">{{ row.label }}</span>
              <span class="pill">{{ row.health.status }}</span>
            </div>
            <div class="card-body">
              <span>{{ row.health.detail ?? '—' }}</span>
              @if (row.health.latency_ms !== null) {
                <span class="mono">{{ row.health.latency_ms }} ms</span>
              }
            </div>
          </mat-card>
        }
      </div>

      <h2>Models</h2>
      @if (system.modelsLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (system.modelsError(); as error) {
        <p class="error-text">{{ error }}</p>
      }
      <div class="models">
        @for (model of system.models(); track model.provider + model.id) {
          <div class="model-row" [class.unavailable]="!model.available">
            <mat-icon [attr.data-route]="model.provider">{{ model.provider === 'local' ? 'shield' : 'cloud' }}</mat-icon>
            <span class="mono">{{ model.id }}</span>
            @if (model.is_default) {
              <span class="pill">default</span>
            }
            <span class="spacer"></span>
            <span class="muted">{{ model.details ?? '' }}</span>
          </div>
        } @empty {
          @if (!system.modelsLoading()) {
            <p class="muted">No models reported.</p>
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; overflow-y: auto; }
    .page { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font: var(--mat-sys-headline-small); margin: 0; }
    h2 { font: var(--mat-sys-title-large); margin: 32px 0 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 20px; }
    .health-card { padding: 16px; }
    .card-head { display: flex; align-items: center; gap: 8px; }
    .card-title { font: var(--mat-sys-title-medium); flex: 1; }
    .card-body { display: flex; justify-content: space-between; gap: 8px; margin-top: 12px; color: var(--mat-sys-on-surface-variant); overflow-wrap: anywhere; }
    .pill { padding: 2px 8px; border-radius: 999px; font: var(--mat-sys-label-small); text-transform: uppercase; background: var(--mat-sys-surface-container-highest); }
    [data-status='ok'] .pill { background: var(--wm-local-container); color: var(--wm-local); }
    [data-status='mock'] .pill { background: var(--wm-cloud-container); color: var(--wm-cloud); }
    [data-status='down'] .pill, [data-status='degraded'] .pill { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .banner { display: flex; align-items: center; gap: 8px; padding: 12px 16px; margin-top: 16px; }
    .banner.error, .error-text { color: var(--mat-sys-error); }
    .models { display: flex; flex-direction: column; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; overflow: hidden; }
    .model-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .model-row:last-child { border-bottom: none; }
    .model-row.unavailable { opacity: 0.6; }
    .model-row mat-icon[data-route='local'] { color: var(--wm-local); }
    .model-row mat-icon[data-route='cloud'] { color: var(--wm-cloud); }
    .spacer { flex: 1; }
    .mono { font-family: var(--wm-mono); }
    .muted { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
  `,
})
export class SystemComponent {
  protected readonly system = inject(SystemService);

  protected readonly rows = computed<HealthRow[]>(() => {
    const state = this.system.health();
    if (state.kind !== 'ready') {
      return [];
    }
    const { api, ollama, cloud } = state.data.components;
    return [
      { key: 'api', label: `API · v${state.data.version}`, icon: 'dns', health: api },
      { key: 'ollama', label: 'Local inference (Ollama)', icon: 'shield', health: ollama },
      { key: 'cloud', label: 'Cloud inference', icon: 'cloud', health: cloud },
    ];
  });

  constructor() {
    this.system.loadModels();
  }

  protected refresh(): void {
    this.system.refreshHealth();
    this.system.loadModels();
  }
}
