import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';

import { ComponentHealth } from '../../core/models/chat.model';
import { SystemService } from '../../core/services/system.service';
import { ThemeService } from '../../core/services/theme.service';
import { TelemetryBarComponent } from '../../features/telemetry-bar/telemetry-bar.component';

type BadgeTone = 'ok' | 'info' | 'warn' | 'error' | 'neutral';

interface StatusBadge {
  readonly label: string;
  readonly value: string;
  readonly tone: BadgeTone;
  readonly detail: string;
}

const COMPONENT_TONES: Record<ComponentHealth['status'], BadgeTone> = {
  ok: 'ok',
  mock: 'info',
  disabled: 'neutral',
  degraded: 'warn',
  down: 'error',
};

const THEME_ICONS = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' } as const;

function componentBadge(label: string, health: ComponentHealth): StatusBadge {
  return { label, value: health.status, tone: COMPONENT_TONES[health.status], detail: health.detail ?? health.status };
}

@Component({
  selector: 'wm-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    TelemetryBarComponent,
  ],
  template: `
    <mat-toolbar class="header">
      <button mat-icon-button type="button" (click)="navOpen.set(!navOpen())" aria-label="Toggle navigation">
        <mat-icon>menu</mat-icon>
      </button>
      <mat-icon class="brand-icon">auto_awesome</mat-icon>
      <span class="brand">WorkMate <span class="brand-accent">AI</span></span>
      <span class="spacer"></span>

      <div class="badges" aria-label="Service status">
        @for (badge of badges(); track badge.label) {
          <span class="badge" [attr.data-tone]="badge.tone" [matTooltip]="badge.detail">
            <span class="dot"></span>
            <span class="badge-label">{{ badge.label }}</span>
            <span class="badge-value">{{ badge.value }}</span>
          </span>
        }
      </div>

      <button
        mat-icon-button
        type="button"
        (click)="theme.cycle()"
        [matTooltip]="'Theme: ' + theme.mode()"
        aria-label="Change color theme"
      >
        <mat-icon>{{ themeIcon() }}</mat-icon>
      </button>
    </mat-toolbar>

    <mat-sidenav-container class="body">
      <mat-sidenav
        class="sidenav"
        [mode]="isHandset() ? 'over' : 'side'"
        [opened]="navOpen()"
        (openedChange)="navOpen.set($event)"
      >
        <mat-nav-list>
          @for (item of navItems; track item.path) {
            <a
              mat-list-item
              [routerLink]="item.path"
              routerLinkActive
              #link="routerLinkActive"
              [activated]="link.isActive"
              (click)="closeOnHandset()"
            >
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
          }
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav-content class="content">
        <wm-telemetry-bar />
        <main class="outlet">
          <router-outlet />
        </main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100dvh; }
    .header {
      position: relative; z-index: 2; gap: 8px; padding: 0 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
    }
    .brand-icon { color: var(--mat-sys-primary); }
    .brand { font: var(--mat-sys-title-large); letter-spacing: -0.01em; }
    .brand-accent { color: var(--mat-sys-primary); font-weight: 600; }
    .spacer { flex: 1; }
    .badges { display: flex; gap: 6px; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
      font: var(--mat-sys-label-medium); background: var(--mat-sys-surface-container-highest);
    }
    .badge-label { color: var(--mat-sys-on-surface-variant); }
    .badge-value { font-weight: 500; text-transform: capitalize; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mat-sys-outline); }
    .badge[data-tone='ok'] .dot { background: var(--wm-local); }
    .badge[data-tone='info'] .dot { background: var(--wm-cloud); }
    .badge[data-tone='warn'] .dot { background: #e0a100; }
    .badge[data-tone='error'] .dot { background: var(--mat-sys-error); }
    .body { flex: 1; min-height: 0; }
    .sidenav { width: 240px; border-right: 1px solid var(--mat-sys-outline-variant); }
    .content { display: flex; flex-direction: column; }
    .outlet { flex: 1; min-height: 0; overflow: hidden; }
    @media (max-width: 720px) {
      .badge { padding: 6px; }
      .badge-label, .badge-value { display: none; }
      .brand { font: var(--mat-sys-title-medium); }
    }
  `,
})
export class ShellComponent {
  protected readonly system = inject(SystemService);
  protected readonly theme = inject(ThemeService);

  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 959.98px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );
  /** Open by default on desktop, closed on handsets; user toggles persist until the breakpoint changes. */
  protected readonly navOpen = linkedSignal(() => !this.isHandset());

  protected readonly navItems = [
    { path: '/chat', icon: 'chat', label: 'Chat' },
    { path: '/system', icon: 'monitor_heart', label: 'System status' },
  ] as const;

  protected readonly themeIcon = computed(() => THEME_ICONS[this.theme.mode()]);

  protected readonly badges = computed<StatusBadge[]>(() => {
    const state = this.system.health();
    switch (state.kind) {
      case 'loading':
        return [{ label: 'API', value: 'checking', tone: 'neutral', detail: 'Checking backend…' }];
      case 'unreachable':
        return [{ label: 'API', value: 'offline', tone: 'error', detail: 'Backend unreachable' }];
      case 'ready': {
        const { api, ollama, cloud } = state.data.components;
        return [componentBadge('API', api), componentBadge('Ollama', ollama), componentBadge('Cloud', cloud)];
      }
    }
  });

  protected closeOnHandset(): void {
    if (this.isHandset()) {
      this.navOpen.set(false);
    }
  }
}
