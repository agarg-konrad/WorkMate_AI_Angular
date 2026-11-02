import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, startWith, switchMap, timer } from 'rxjs';

import { API_BASE_URL } from '../config/api.config';
import { HealthResponse, ModelInfo, ModelsResponse } from '../models/chat.model';

const HEALTH_POLL_INTERVAL_MS = 30_000;

export type HealthState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: HealthResponse }
  | { kind: 'unreachable' };

/** Backend health (polled) and model catalog. */
@Injectable({ providedIn: 'root' })
export class SystemService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly healthRefresh$ = new Subject<void>();

  readonly health = toSignal(
    this.healthRefresh$.pipe(
      startWith(undefined),
      switchMap(() => timer(0, HEALTH_POLL_INTERVAL_MS)),
      switchMap(() =>
        this.http.get<HealthResponse>(`${this.apiBaseUrl}/health`).pipe(
          map((data): HealthState => ({ kind: 'ready', data })),
          catchError(() => of<HealthState>({ kind: 'unreachable' })),
        ),
      ),
    ),
    { initialValue: { kind: 'loading' } as HealthState },
  );

  private readonly _models = signal<readonly ModelInfo[]>([]);
  private readonly _modelsLoading = signal(false);
  private readonly _modelsError = signal<string | null>(null);

  readonly models = this._models.asReadonly();
  readonly modelsLoading = this._modelsLoading.asReadonly();
  readonly modelsError = this._modelsError.asReadonly();
  readonly localModels = computed(() => this._models().filter((m) => m.provider === 'local'));
  readonly cloudModels = computed(() => this._models().filter((m) => m.provider === 'cloud'));

  refreshHealth(): void {
    this.healthRefresh$.next();
  }

  loadModels(): void {
    this._modelsLoading.set(true);
    this._modelsError.set(null);
    this.http.get<ModelsResponse>(`${this.apiBaseUrl}/models`).subscribe({
      next: (response) => {
        this._models.set(response.models);
        this._modelsLoading.set(false);
      },
      error: () => {
        this._modelsError.set('Could not load models from the backend.');
        this._modelsLoading.set(false);
      },
    });
  }
}
