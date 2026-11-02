import { TextFieldModule } from '@angular/cdk/text-field';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ModelSelection } from '../../core/models/chat.model';
import { ChatService } from '../../core/services/chat.service';
import { SystemService } from '../../core/services/system.service';

/** Distance from the bottom (px) within which new content keeps the view pinned to the end. */
const STICKY_SCROLL_THRESHOLD = 64;
const AUTO_KEY = 'auto';

interface Suggestion {
  readonly icon: string;
  readonly label: string;
  readonly prompt: string;
}

@Component({
  selector: 'wm-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TextFieldModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  template: `
    <section class="chat">
      <div class="controls">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="model-field">
          <mat-label>Model</mat-label>
          <mat-select
            [value]="selectionKey()"
            (selectionChange)="selectionKey.set($event.value)"
            [disabled]="chat.isStreaming()"
          >
            <mat-select-trigger>
              <span class="trigger">
                <mat-icon>{{ selection().route === 'cloud' ? 'cloud' : selection().route === 'local' ? 'shield' : 'alt_route' }}</mat-icon>
                {{ selection().route === 'auto' ? 'Auto · smart routing' : selection().model }}
              </span>
            </mat-select-trigger>
            <mat-option [value]="autoKey">
              <mat-icon>alt_route</mat-icon> Auto · smart routing
            </mat-option>
            <mat-optgroup label="Local · Ollama (private)">
              @for (model of system.localModels(); track model.id) {
                <mat-option [value]="'local:' + model.id" [disabled]="!model.available">
                  <mat-icon>shield</mat-icon> {{ model.name }}
                  @if (model.details) {
                    <span class="option-hint">{{ model.details }}</span>
                  }
                </mat-option>
              } @empty {
                <mat-option disabled>No local models found</mat-option>
              }
            </mat-optgroup>
            <mat-optgroup label="Cloud">
              @for (model of system.cloudModels(); track model.id) {
                <mat-option [value]="'cloud:' + model.id" [disabled]="!model.available">
                  <mat-icon>cloud</mat-icon> {{ model.name }}
                  @if (model.details) {
                    <span class="option-hint">{{ model.details }}</span>
                  }
                </mat-option>
              } @empty {
                <mat-option disabled>Cloud inference disabled</mat-option>
              }
            </mat-optgroup>
          </mat-select>
        </mat-form-field>

        <mat-slide-toggle
          [checked]="isSimple()"
          (change)="isSimple.set($event.checked)"
          [disabled]="chat.isStreaming() || selection().route !== 'auto'"
          matTooltip="Mark the request as simple so it stays on the local model"
        >
          Simple
        </mat-slide-toggle>

        <span class="spacer"></span>

        <button
          mat-icon-button
          type="button"
          (click)="newConversation()"
          [disabled]="!chat.hasMessages()"
          matTooltip="New conversation"
          aria-label="New conversation"
        >
          <mat-icon>add_comment</mat-icon>
        </button>
      </div>

      <div class="messages" #scrollContainer (scroll)="onScroll()">
        <div class="messages-inner">
          @for (message of chat.messages(); track message.id) {
            <article class="message" [class.from-user]="message.role === 'user'" [attr.aria-busy]="message.status === 'streaming'">
              @if (message.role === 'assistant') {
                <header class="message-meta">
                  @if (message.route) {
                    <span class="route-chip" [attr.data-route]="message.route">
                      <mat-icon>{{ message.route === 'local' ? 'shield' : 'cloud' }}</mat-icon>
                      {{ message.route === 'local' ? 'Local' : 'Cloud' }} · {{ message.model }}
                    </span>
                  } @else {
                    <span class="route-chip">Routing…</span>
                  }
                </header>
              }
              <div class="bubble">
                @if (message.content) {
                  <div class="content">{{ message.content }}@if (message.status === 'streaming') {<span class="cursor" aria-hidden="true"></span>}</div>
                } @else if (message.status === 'streaming') {
                  <div class="typing" aria-label="Waiting for the model"><span></span><span></span><span></span></div>
                }
                @if (message.status === 'stopped') {
                  <div class="note"><mat-icon>stop_circle</mat-icon> Generation stopped.</div>
                }
                @if (message.status === 'error') {
                  <div class="error" role="alert"><mat-icon>error_outline</mat-icon> {{ message.error }}</div>
                }
              </div>
            </article>
          } @empty {
            <div class="empty">
              <mat-icon class="empty-icon">forum</mat-icon>
              <h2>How can WorkMate help today?</h2>
              <p>Sensitive requests stay on the private local model. Complex, multi-step analysis is routed to the approved cloud model.</p>
              <div class="suggestions">
                @for (suggestion of suggestions; track suggestion.label) {
                  <button mat-stroked-button type="button" (click)="useSuggestion(suggestion.prompt)">
                    <mat-icon>{{ suggestion.icon }}</mat-icon> {{ suggestion.label }}
                  </button>
                }
              </div>
            </div>
          }
        </div>
      </div>

      <form class="composer" (submit)="$event.preventDefault(); submit()">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="composer-field">
          <textarea
            #promptInput
            matInput
            cdkTextareaAutosize
            cdkAutosizeMinRows="1"
            cdkAutosizeMaxRows="8"
            aria-label="Message"
            placeholder="Message WorkMate…  (Enter to send · Shift+Enter for a new line)"
            [value]="draft()"
            (input)="draft.set(promptInput.value)"
            (keydown.enter)="onEnter($event)"
          ></textarea>
        </mat-form-field>
        @if (chat.isStreaming()) {
          <button mat-flat-button type="button" class="action" (click)="chat.stop()">
            <mat-icon>stop</mat-icon> Stop
          </button>
        } @else {
          <button mat-flat-button type="submit" class="action" [disabled]="!canSend()">
            <mat-icon>send</mat-icon> Send
          </button>
        }
      </form>
    </section>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .chat { display: flex; flex-direction: column; height: 100%; }
    .controls {
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      padding: 12px 16px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .model-field { width: min(320px, 100%); }
    .trigger { display: inline-flex; align-items: center; gap: 8px; }
    .trigger mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .option-hint { margin-left: 8px; font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant); }
    .spacer { flex: 1; }

    .messages { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
    .messages-inner { max-width: 860px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 20px; }
    .message { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .message.from-user { align-items: flex-end; }
    .bubble {
      max-width: min(720px, 100%);
      padding: 12px 16px;
      border-radius: 18px 18px 18px 4px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
    }
    .from-user .bubble {
      border-radius: 18px 18px 4px 18px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .content { white-space: pre-wrap; overflow-wrap: anywhere; font: var(--mat-sys-body-large); line-height: 1.55; }
    .cursor {
      display: inline-block; width: 8px; height: 1.1em; margin-left: 2px; vertical-align: text-bottom;
      background: var(--mat-sys-primary); animation: blink 1s steps(2, start) infinite;
    }
    .typing { display: inline-flex; gap: 4px; padding: 6px 0; }
    .typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--mat-sys-on-surface-variant); animation: bounce 1.2s infinite ease-in-out; }
    .typing span:nth-child(2) { animation-delay: 0.15s; }
    .typing span:nth-child(3) { animation-delay: 0.3s; }
    .note, .error { display: flex; align-items: center; gap: 6px; margin-top: 8px; font: var(--mat-sys-body-small); }
    .note { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
    .note mat-icon, .error mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }

    .message-meta { padding-left: 4px; }
    .route-chip {
      display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
      font: var(--mat-sys-label-small); font-family: var(--wm-mono);
      background: var(--mat-sys-surface-container-high); color: var(--mat-sys-on-surface-variant);
    }
    .route-chip mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .route-chip[data-route='local'] { background: var(--wm-local-container); color: var(--wm-local); }
    .route-chip[data-route='cloud'] { background: var(--wm-cloud-container); color: var(--wm-cloud); }

    .empty { text-align: center; padding: 8vh 8px 0; color: var(--mat-sys-on-surface-variant); }
    .empty h2 { font: var(--mat-sys-headline-small); color: var(--mat-sys-on-surface); margin: 12px 0 8px; }
    .empty p { max-width: 520px; margin: 0 auto 24px; }
    .empty-icon { font-size: 48px; width: 48px; height: 48px; color: var(--mat-sys-primary); }
    .suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }

    .composer {
      display: flex; align-items: flex-end; gap: 12px;
      width: 100%; max-width: 892px; margin: 0 auto; padding: 12px 16px 16px;
    }
    .composer-field { flex: 1; }
    .action { height: 56px; }

    @keyframes blink { to { visibility: hidden; } }
    @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .cursor, .typing span { animation: none; }
    }
    @media (max-width: 600px) {
      .controls { gap: 8px; padding: 8px 12px; }
      .composer { padding: 8px 12px 12px; gap: 8px; }
      .action { min-width: 0; padding: 0 16px; }
    }
  `,
})
export class ChatComponent {
  protected readonly chat = inject(ChatService);
  protected readonly system = inject(SystemService);

  protected readonly autoKey = AUTO_KEY;
  protected readonly draft = signal('');
  protected readonly isSimple = signal(false);
  /** Encoded as 'auto' | 'local:<model id>' | 'cloud:<model id>'. */
  protected readonly selectionKey = signal<string>(AUTO_KEY);

  protected readonly selection = computed<ModelSelection>(() => {
    const key = this.selectionKey();
    const separator = key.indexOf(':');
    const route = key.slice(0, separator);
    if (separator === -1 || (route !== 'local' && route !== 'cloud')) {
      return { route: 'auto', model: null };
    }
    return { route, model: key.slice(separator + 1) };
  });

  protected readonly canSend = computed(() => this.draft().trim().length > 0 && !this.chat.isStreaming());

  protected readonly suggestions: readonly Suggestion[] = [
    { icon: 'shield', label: 'Sensitive → Local', prompt: 'Summarize the key points of our confidential salary bands memo.' },
    {
      icon: 'cloud',
      label: 'Complex → Cloud',
      prompt: 'Analyze the trade-offs of migrating our CRM to a new vendor, step by step, and recommend a plan.',
    },
    { icon: 'bolt', label: 'Simple → Local', prompt: "Write a friendly two-line reminder about Friday's team lunch." },
  ];

  private readonly scrollContainer = viewChild.required<ElementRef<HTMLElement>>('scrollContainer');
  private readonly promptInput = viewChild.required<ElementRef<HTMLTextAreaElement>>('promptInput');
  private stickToBottom = true;

  constructor() {
    this.system.loadModels();

    // Runs after each render that changed the message list; follows the stream unless the user scrolled up.
    afterRenderEffect(() => {
      this.chat.messages();
      const element = this.scrollContainer().nativeElement;
      if (this.stickToBottom) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  protected onScroll(): void {
    const element = this.scrollContainer().nativeElement;
    this.stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_SCROLL_THRESHOLD;
  }

  protected onEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey || keyboardEvent.isComposing) {
      return;
    }
    keyboardEvent.preventDefault();
    this.submit();
  }

  protected submit(): void {
    if (!this.canSend()) {
      return;
    }
    const prompt = this.draft();
    this.draft.set('');
    this.stickToBottom = true;
    void this.chat.send(prompt, { selection: this.selection(), isSimple: this.isSimple() });
    this.promptInput().nativeElement.focus();
  }

  protected useSuggestion(prompt: string): void {
    this.draft.set(prompt);
    this.promptInput().nativeElement.focus();
  }

  protected newConversation(): void {
    this.chat.clear();
    this.promptInput().nativeElement.focus();
  }
}
