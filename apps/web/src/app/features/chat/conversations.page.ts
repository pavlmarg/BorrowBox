import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { ConversationViewResponse } from '../../api/models';
import { ChatSocket } from '../../core/chat/chat-socket';
import { Avatar } from '../../shared/avatar/avatar';
import { LanguageService } from '../../core/i18n/language';
import { formatCents } from '../../shared/format/money';
import { AthensPipe, athensDayKey } from './athens-time';
import { ConversationsStore } from './conversations.store';

/**
 * `/messages`: the signed-in user's conversations, most recent activity
 * first, with the item, the other person, the last message (masked as the
 * API sends it) and the unread count. Rows sit on the background,
 * separated by dividers (no panels). Live: pushes update the rows.
 */
@Component({
  selector: 'bb-conversations-page',
  imports: [
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    Avatar,
    AthensPipe,
  ],
  providers: [ConversationsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *transloco="let t">
      <h1 class="page-title">{{ t('nav.messages') }}</h1>

      @switch (store.status()) {
        @case ('loading') {
          <p class="muted" role="status">{{ t('chat.loading') }}</p>
        }
        @case ('error') {
          <div class="message" role="alert">
            <p>{{ t('errors.' + store.error()) }}</p>
            <button mat-stroked-button type="button" (click)="store.load()">
              {{ t('explore.retry') }}
            </button>
          </div>
        }
        @default {
          @if (store.conversations().length === 0) {
            <div class="message">
              <p class="strong">{{ t('chat.empty') }}</p>
              <p>{{ t('chat.emptyHint') }}</p>
              <a mat-flat-button routerLink="/explore">{{
                t('chat.browse')
              }}</a>
            </div>
          } @else {
            <ul class="list">
              @for (c of store.conversations(); track c.id) {
                <li>
                  <a
                    class="row"
                    [class.unread]="c.unreadCount > 0"
                    [routerLink]="['/messages', c.id]"
                  >
                    <bb-avatar [size]="44" />
                    <span class="text">
                      <span class="top">
                        <strong class="name">{{
                          c.other.displayName ?? t('chat.deletedUser')
                        }}</strong>
                        <span class="time">{{
                          c.lastMessageAt
                            | athens
                              : (isToday(c.lastMessageAt) ? 'time' : 'date')
                        }}</span>
                      </span>
                      <span class="item">
                        {{ c.itemTitle }}
                        @if (c.closed) {
                          <span class="closed">{{ t('chat.readOnly') }}</span>
                        }
                      </span>
                      <span class="preview">{{ preview(c) }}</span>
                    </span>
                    @if (c.unreadCount > 0) {
                      <span class="count">
                        <span aria-hidden="true">{{
                          c.unreadCount > 99 ? '99+' : c.unreadCount
                        }}</span>
                        <span class="visually-hidden">{{
                          t('chat.unreadCount', { count: c.unreadCount })
                        }}</span>
                      </span>
                    }
                  </a>
                </li>
              }
            </ul>
            @if (store.nextCursor()) {
              <div class="more">
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="store.loadingMore()"
                  (click)="store.loadMore()"
                >
                  {{ t('chat.more') }}
                </button>
              </div>
            }
          }
        }
      }
    </div>
  `,
  styles: `
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .list {
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
    }
    .list li + li .row {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .row {
      align-items: center;
      color: var(--mat-sys-on-surface);
      display: flex;
      gap: 16px;
      padding: 16px 0;
      text-decoration: none;
    }
    .row:hover .name,
    .row:focus-visible .name {
      color: var(--bb-sky-700);
    }
    .row:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .top {
      align-items: baseline;
      display: flex;
      gap: 12px;
      justify-content: space-between;
    }
    .name {
      font: var(--mat-sys-title-medium);
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color var(--bb-fast) var(--bb-ease);
      white-space: nowrap;
    }
    .time {
      color: var(--mat-sys-on-surface-variant);
      flex: none;
      font: var(--mat-sys-body-small);
    }
    .item {
      color: var(--bb-sky-700);
      font: var(--mat-sys-label-large);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .closed {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      letter-spacing: 0.6px;
      margin-left: 8px;
      text-transform: uppercase;
    }
    .preview {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .unread .preview {
      color: var(--mat-sys-on-surface);
      font-weight: 600;
    }
    .count {
      background: var(--mat-sys-primary);
      border-radius: var(--bb-radius);
      color: var(--mat-sys-on-primary);
      flex: none;
      font: var(--mat-sys-label-medium);
      font-weight: 700;
      min-width: 22px;
      padding: 2px 6px;
      text-align: center;
    }
    .visually-hidden {
      clip-path: inset(50%);
      height: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
      width: 1px;
    }
    .more {
      display: flex;
      justify-content: center;
      padding: 16px 0;
    }
    .message {
      color: var(--mat-sys-on-surface-variant);
      padding: 40px 0;
      text-align: center;
    }
    .message p {
      margin: 0 0 12px;
    }
    .message .strong {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-medium);
    }
  `,
})
export class ConversationsPage implements OnInit {
  protected readonly store = inject(ConversationsStore);
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  constructor() {
    const socket = inject(ChatSocket);
    socket.pushes
      .pipe(takeUntilDestroyed())
      .subscribe((push) => this.store.apply(push));
    // After a reconnect, fetch what a lost push may have missed.
    socket.connects
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.store.load());
  }

  ngOnInit(): void {
    void this.store.load();
  }

  /** The last message in one line, as the reader sees it (masked by the API). */
  protected preview(c: ConversationViewResponse): string {
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params);
    const m = c.lastMessage;
    if (!m) return t('chat.noMessages');
    switch (m.kind) {
      case 'TEXT': {
        const text = m.deleted || m.text === null ? t('chat.deleted') : m.text;
        return m.mine ? t('chat.youSaid', { text }) : text;
      }
      case 'OFFER':
        return t('offers.preview', {
          rent: formatCents(
            m.offer?.rentCents ?? 0,
            this.language.formatLocale(),
          ),
        });
      default:
        return t('chat.system.' + m.systemCode);
    }
  }

  protected isToday(iso: string): boolean {
    return athensDayKey(iso) === athensDayKey(new Date().toISOString());
  }
}
