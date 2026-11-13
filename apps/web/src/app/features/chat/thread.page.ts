import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { MESSAGE_TEXT_MAX_LENGTH, charLength } from '@borrowbox/contracts';
import type {
  MessageViewResponse,
  OfferViewResponse,
  ReportReason,
} from '../../api/models';
import { ChatSocket } from '../../core/chat/chat-socket';
import { LanguageService } from '../../core/i18n/language';
import { Avatar } from '../../shared/avatar/avatar';
import { openConfirm } from '../../shared/confirm-dialog';
import { formatCents } from '../../shared/format/money';
import { AthensPipe, athensDayKey, formatAthens } from './athens-time';
import type { ChatError } from './chat-errors';
import { OfferCard } from './offer-card';
import { OfferDialog, type OfferDialogData } from './offer.dialog';
import { ReportDialog } from './report.dialog';
import { ThreadStore } from './thread.store';

/** What masked contact details look like (Bookings' masking, ADR-0017). */
export const MASK = '•••';
/** The counter shows from here on. */
const COUNTER_FROM = MESSAGE_TEXT_MAX_LENGTH - 200;
/** Scrolled this close to the top, older messages load. */
const EDGE_PX = 80;

/** A message's text is ready to send: 1–2000 characters once trimmed. */
export function sendable(text: string): boolean {
  const length = charLength(text.trim());
  return length >= 1 && length <= MESSAGE_TEXT_MAX_LENGTH;
}

/**
 * One conversation (`/messages/:id`, the link in Notifications' emails):
 * the item and the other person on top; messages oldest first, older ones
 * paged in when scrolled to the top; system lines and price offers inline;
 * the composer at the bottom (Enter sends, Shift+Enter a new line). New
 * messages arrive live; the thread is marked read while it's visible.
 */
@Component({
  selector: 'bb-thread-page',
  imports: [
    CdkTextareaAutosize,
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    Avatar,
    AthensPipe,
    OfferCard,
  ],
  providers: [ThreadStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="thread" *transloco="let t">
      <header class="head">
        <a class="back bb-text-action-host" routerLink="/messages">
          <span class="chevron" aria-hidden="true"></span>
          <span class="bb-text-action bb-text-action-rtl">{{
            t('chat.back')
          }}</span>
        </a>
        @if (store.conversation(); as c) {
          <div class="who">
            <bb-avatar [size]="40" [photoUrl]="c.other.photo?.small ?? null" />
            <div class="who-text">
              <h1 class="name">
                {{ c.other.displayName ?? t('chat.deletedUser') }}
              </h1>
              <a class="item" [routerLink]="['/items', c.itemId]">{{
                c.itemTitle
              }}</a>
            </div>
          </div>
        }
      </header>

      @switch (store.status()) {
        @case ('loading') {
          <p class="muted" role="status">{{ t('chat.loadingThread') }}</p>
        }
        @case ('error') {
          <div class="message" role="alert">
            <p>{{ t(store.error()?.key ?? 'errors.INTERNAL') }}</p>
            @if (store.error()?.code === 'NOT_FOUND') {
              <a mat-flat-button routerLink="/messages">{{
                t('chat.backToList')
              }}</a>
            } @else {
              <button mat-stroked-button type="button" (click)="reload()">
                {{ t('explore.retry') }}
              </button>
            }
          </div>
        }
        @case ('ready') {
          @if (store.closed()) {
            <p class="closed" role="status">{{ t('chat.closedBanner') }}</p>
          }
          <div
            #scroller
            class="scroller"
            role="log"
            [attr.aria-label]="t('chat.messagesLabel')"
            (scroll)="onScroll()"
          >
            @if (store.nextCursor()) {
              <div class="older">
                <button
                  type="button"
                  class="bb-text-action action"
                  [disabled]="store.loadingOlder()"
                  (click)="older()"
                >
                  {{ t('chat.older') }}
                </button>
              </div>
            }
            @if (
              store.messages().length === 0 && store.pending().length === 0
            ) {
              <p class="muted start">{{ t('chat.startHint') }}</p>
            }
            <ol class="messages">
              @for (m of store.messages(); track m.id; let i = $index) {
                @if (startsDay(i)) {
                  <li class="day">{{ m.sentAt | athens: 'day' }}</li>
                }
                @switch (m.kind) {
                  @case ('SYSTEM') {
                    <li class="system">
                      <span>{{ t('chat.system.' + m.systemCode) }}</span>
                      @if (m.bookingId) {
                        <a [routerLink]="['/bookings', m.bookingId]">{{
                          t('chat.viewBooking')
                        }}</a>
                      }
                      <span class="time">{{ m.sentAt | athens: 'time' }}</span>
                    </li>
                  }
                  @case ('OFFER') {
                    @if (m.offer; as offer) {
                      <li class="offer-row" [class.mine]="m.mine">
                        <bb-offer-card
                          [offer]="offer"
                          [mine]="store.isLender()"
                          [closed]="store.closed()"
                          [busy]="busyOffer() === offer.id"
                          (book)="book(offer)"
                          (withdraw)="withdraw(offer)"
                        />
                        <span class="time">{{
                          m.sentAt | athens: 'time'
                        }}</span>
                      </li>
                    }
                  }
                  @default {
                    <li class="msg" [class.mine]="m.mine">
                      <p class="bubble" [class.deleted]="m.deleted">
                        {{ m.deleted ? t('chat.deleted') : m.text }}
                      </p>
                      <span class="meta">
                        <span class="time">{{
                          m.sentAt | athens: 'time'
                        }}</span>
                        @if (seenId() === m.id) {
                          <span class="seen">{{ t('chat.seen') }}</span>
                        }
                        @if (!m.mine && !m.deleted) {
                          <button
                            type="button"
                            class="report"
                            (click)="report(m)"
                          >
                            {{ t('chat.report.action') }}
                          </button>
                        }
                      </span>
                      @if (!m.mine && masked(m)) {
                        <p class="masked">{{ t('chat.maskedHint') }}</p>
                      }
                    </li>
                  }
                }
              }
              @for (p of store.pending(); track p.id) {
                <li
                  class="msg mine pending"
                  [class.failed]="p.status === 'failed'"
                >
                  <p class="bubble">{{ p.text }}</p>
                  <span class="meta" aria-live="polite">
                    @if (p.status === 'sending') {
                      <span class="time">{{ t('chat.sending') }}</span>
                    } @else {
                      <span class="error">{{
                        t(p.errorKey ?? 'errors.INTERNAL')
                      }}</span>
                      @if (!store.closed()) {
                        <button
                          type="button"
                          class="report"
                          (click)="store.retry(p.id)"
                        >
                          {{ t('chat.retry') }}
                        </button>
                      }
                      <button
                        type="button"
                        class="report"
                        (click)="store.discard(p.id)"
                      >
                        {{ t('chat.discard') }}
                      </button>
                    }
                  </span>
                </li>
              }
            </ol>
          </div>

          @if (!store.closed()) {
            <form class="composer" (submit)="submit($event)">
              <mat-form-field class="field" subscriptSizing="dynamic">
                <textarea
                  matInput
                  cdkTextareaAutosize
                  cdkAutosizeMinRows="1"
                  cdkAutosizeMaxRows="6"
                  [formControl]="draft"
                  [attr.aria-label]="t('chat.write')"
                  (keydown)="onKeydown($event)"
                ></textarea>
                @if (length() > counterFrom) {
                  <mat-hint align="end" [class.over]="length() > max">
                    {{ length() }} / {{ max }}
                  </mat-hint>
                }
              </mat-form-field>
              <button mat-flat-button type="submit" [disabled]="!canSend()">
                {{ t('chat.send') }}
              </button>
            </form>
            @if (store.isLender()) {
              <p class="tools">
                <button
                  type="button"
                  class="bb-text-action action"
                  (click)="makeOffer()"
                >
                  {{ t('offers.make') }}
                </button>
              </p>
            }
          }
        }
      }
    </div>
  `,
  styles: `
    /* Fills its pane in the messages layout: the messages scroll, the
       composer stays. */
    :host {
      display: block;
      height: 100%;
    }
    .thread {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      height: 100%;
      margin: 0 auto;
      max-width: 960px;
      padding: 16px 32px 16px;
    }
    @media (max-width: 959px) {
      .thread {
        padding: 12px 16px 8px;
      }
    }
    /* Wide screens: the list is beside the thread, so no way back is needed. */
    @media (min-width: 960px) {
      .back {
        display: none;
      }
      .who {
        margin-top: 0;
      }
    }
    .head {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      flex: none;
      padding-bottom: 12px;
    }
    .back {
      align-items: center;
      color: var(--bb-sky-700);
      display: inline-flex;
      font: var(--mat-sys-label-large);
      gap: 8px;
      padding: 4px 0;
      text-decoration: none;
    }
    .chevron {
      border-bottom: 2px solid currentColor;
      border-left: 2px solid currentColor;
      height: 7px;
      transform: rotate(45deg);
      width: 7px;
    }
    .who {
      align-items: center;
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }
    .who-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .name {
      font: var(--mat-sys-title-large);
      margin: 0;
      overflow-wrap: anywhere;
    }
    .item {
      font: var(--mat-sys-label-large);
      overflow-wrap: anywhere;
    }
    .closed {
      background: var(--bb-sky-100);
      border-radius: 12px;
      color: var(--mat-sys-on-surface);
      flex: none;
      margin: 12px 0 0;
      padding: 10px 14px;
    }
    .scroller {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 8px 0;
    }
    .older {
      display: flex;
      justify-content: center;
      padding: 8px 0;
    }
    .messages {
      display: flex;
      flex-direction: column;
      gap: 6px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .day {
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      margin: 16px 0 6px;
    }
    .msg {
      align-items: flex-start;
      display: flex;
      flex-direction: column;
      max-width: min(560px, 85%);
    }
    .msg.mine {
      align-items: flex-end;
      align-self: flex-end;
    }
    /* Round, tinted bubbles; the corner nearest the sender is tighter. */
    .bubble {
      background: var(--mat-sys-surface-container-high);
      border-radius: 18px 18px 18px 6px;
      color: var(--mat-sys-on-surface);
      margin: 0;
      overflow-wrap: anywhere;
      padding: 9px 14px;
      white-space: pre-wrap;
    }
    .mine .bubble {
      background: var(--bb-sky-100);
      border-radius: 18px 18px 6px 18px;
    }
    .bubble.deleted {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }
    .pending .bubble {
      opacity: 0.7;
    }
    .failed .bubble {
      outline: 1px solid var(--mat-sys-error);
    }
    .meta {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 2px;
    }
    .time,
    .seen {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .seen {
      font-weight: 600;
    }
    .error {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
    .report {
      background: none;
      border: 0;
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
      font: var(--mat-sys-body-small);
      padding: 0;
      text-decoration: underline;
      text-decoration-color: transparent;
      transition: text-decoration-color var(--bb-medium) var(--bb-ease);
    }
    .report:hover,
    .report:focus-visible {
      color: var(--bb-sky-700);
      text-decoration-color: currentColor;
    }
    .report:focus-visible {
      outline: 3px solid var(--bb-sky-300);
    }
    .masked {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 2px 0 0;
    }
    .system {
      align-items: baseline;
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      flex-wrap: wrap;
      font: var(--mat-sys-body-medium);
      gap: 4px 10px;
      justify-content: center;
      margin: 8px 0;
      max-width: 90%;
      text-align: center;
    }
    .offer-row {
      align-self: flex-start;
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 8px 0;
      max-width: min(420px, 100%);
    }
    .composer {
      align-items: flex-end;
      border-top: 1px solid var(--mat-sys-outline-variant);
      display: flex;
      flex: none;
      gap: 12px;
      padding-top: 12px;
    }
    /* A round message field and Send button. */
    .field {
      --mat-form-field-outlined-container-shape: 24px;
      flex: 1;
      min-width: 0;
    }
    .composer button {
      --mat-button-filled-container-shape: 999px;
      margin-bottom: 4px;
    }
    .over {
      color: var(--mat-sys-error);
    }
    .tools {
      align-items: baseline;
      display: flex;
      flex: none;
      gap: 16px;
      justify-content: flex-end;
      margin: 6px 0 0;
    }
    .action {
      background-color: transparent;
      border: 0;
      color: var(--bb-sky-700);
      cursor: pointer;
      font: var(--mat-sys-title-small);
      padding: 0 0 3px;
    }
    .action[disabled] {
      cursor: default;
      opacity: 0.5;
    }
    .action:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 3px;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .start {
      margin: 24px 0;
      text-align: center;
    }
    .message {
      color: var(--mat-sys-on-surface-variant);
      padding: 40px 0;
      text-align: center;
    }
    .message p {
      margin: 0 0 12px;
    }
  `,
})
export class ThreadPage {
  /** From the route (`/messages/:id`). */
  readonly id = input.required<string>();

  protected readonly store = inject(ThreadStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly max = MESSAGE_TEXT_MAX_LENGTH;
  protected readonly counterFrom = COUNTER_FROM;
  protected readonly draft = new FormControl('', { nonNullable: true });
  private readonly draftText = toSignal(this.draft.valueChanges, {
    initialValue: '',
  });
  protected readonly length = computed(() =>
    charLength(this.draftText().trim()),
  );
  protected readonly canSend = computed(() => sendable(this.draftText()));
  protected readonly busyOffer = signal<string | null>(null);

  /** My newest message, once the other person has read up to it. */
  protected readonly seenId = computed(() => {
    const last = this.store.myLast();
    const readAt = this.store.conversation()?.otherReadAt;
    return last && readAt && readAt >= last.sentAt ? last.id : null;
  });

  private readonly visible = signal(true);
  /** Within reach of the bottom: new messages scroll into view. */
  private nearBottom = true;
  private newestId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.newestId = null;
        this.nearBottom = true;
        void this.store.open(id);
      });
    });

    const socket = inject(ChatSocket);
    socket.pushes
      .pipe(takeUntilDestroyed())
      .subscribe((push) => this.store.apply(push));
    // Back online: fetch what a lost push may have missed.
    socket.connects
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.store.refresh());

    // Read while looking at it, not while the tab is in the background.
    const document = inject(DOCUMENT);
    const onVisibility = () =>
      this.visible.set(document.visibilityState !== 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('visibilitychange', onVisibility),
    );
    effect(() => {
      if (
        this.store.status() === 'ready' &&
        this.store.unseen() &&
        this.visible()
      ) {
        untracked(() => void this.store.markRead());
      }
    });

    // Opening shows the newest; a new one scrolls into view if the reader
    // was at the bottom, or wrote it.
    effect(() => {
      const pending = this.store.pending().at(-1);
      const newest = pending ?? this.store.messages().at(-1);
      if (!newest || newest.id === this.newestId) return;
      const first = this.newestId === null;
      this.newestId = newest.id;
      const mine = pending !== undefined || ('mine' in newest && newest.mine);
      if (first || mine || this.nearBottom) {
        afterNextRender(() => this.scrollToBottom(), {
          injector: this.injector,
        });
      }
    });
  }

  protected reload(): void {
    void this.store.open(this.id());
  }

  protected startsDay(index: number): boolean {
    const messages = this.store.messages();
    return (
      index === 0 ||
      athensDayKey(messages[index].sentAt) !==
        athensDayKey(messages[index - 1].sentAt)
    );
  }

  protected masked(message: MessageViewResponse): boolean {
    return message.text?.includes(MASK) ?? false;
  }

  protected onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    this.nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < EDGE_PX;
    if (el.scrollTop < EDGE_PX) void this.older();
  }

  /** Pages in older messages, keeping the ones on screen where they were. */
  protected async older(): Promise<void> {
    if (!this.store.nextCursor() || this.store.loadingOlder()) return;
    const el = this.scroller()?.nativeElement;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    await this.store.loadOlder();
    afterNextRender(
      () => {
        if (el) el.scrollTop = el.scrollHeight - fromBottom;
      },
      { injector: this.injector },
    );
  }

  private scrollToBottom(): void {
    const el = this.scroller()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  protected onKeydown(event: KeyboardEvent): void {
    // Enter sends; Shift+Enter is a new line; an IME choosing a word isn't done.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.send();
  }

  private send(): void {
    const text = this.draft.value.trim();
    if (!sendable(text)) return;
    this.draft.setValue('');
    void this.store.send(text);
  }

  protected async report(message: MessageViewResponse): Promise<void> {
    const reason = await firstValueFrom(
      this.dialog
        .open<ReportDialog, unknown, ReportReason | undefined>(ReportDialog, {
          width: '420px',
          maxWidth: 'calc(100vw - 32px)',
        })
        .afterClosed(),
    );
    if (!reason) return;
    const error = await this.store.report(message.id, reason);
    this.say(error ? error.key : 'chat.report.done');
  }

  protected async makeOffer(): Promise<void> {
    const conversation = this.store.conversation();
    if (!conversation) return;
    const data: OfferDialogData = {
      itemId: conversation.itemId,
      hasOpenOffer: conversation.openOffer !== null,
      send: (start, end, rentCents) =>
        this.store.sendOffer(start, end, rentCents),
    };
    const sent = await firstValueFrom(
      this.dialog
        .open<OfferDialog, OfferDialogData, boolean>(OfferDialog, {
          data,
          width: '480px',
          maxWidth: 'calc(100vw - 32px)',
          autoFocus: 'first-heading',
        })
        .afterClosed(),
    );
    if (sent) this.say('offers.sent');
  }

  protected async book(offer: OfferViewResponse): Promise<void> {
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params);
    const locale = this.language.formatLocale();
    const confirmed = await openConfirm(this.dialog, {
      title: t('offers.bookTitle'),
      message: t('offers.bookMessage', {
        start: formatAthens(offer.start, 'dateTime', locale),
        end: formatAthens(offer.end, 'dateTime', locale),
        total: formatCents(offer.totalCents, locale),
      }),
      confirm: t('offers.book'),
      cancel: t('offers.cancel'),
    });
    if (!confirmed) return;
    this.busyOffer.set(offer.id);
    const result = await this.store.bookOffer(offer.id);
    this.busyOffer.set(null);
    if ('error' in result) {
      this.fail(result.error);
    } else {
      await this.router.navigate(['/bookings', result.bookingId]);
    }
  }

  protected async withdraw(offer: OfferViewResponse): Promise<void> {
    const t = (key: string) => this.transloco.translate(key);
    const confirmed = await openConfirm(this.dialog, {
      title: t('offers.withdrawTitle'),
      message: t('offers.withdrawMessage'),
      confirm: t('offers.withdraw'),
      cancel: t('offers.keep'),
      danger: true,
    });
    if (!confirmed) return;
    this.busyOffer.set(offer.id);
    const error = await this.store.withdrawOffer(offer.id);
    this.busyOffer.set(null);
    this.say(error ? error.key : 'offers.withdrawn');
  }

  /** An error, with a way to fix it where there is one. */
  private fail(error: ChatError): void {
    if (error.code === 'EMAIL_NOT_VERIFIED') {
      this.snackBar
        .open(
          this.transloco.translate(error.key),
          this.transloco.translate('chat.toSettings'),
          { duration: 8000 },
        )
        .onAction()
        .subscribe(() => void this.router.navigateByUrl('/settings'));
      return;
    }
    this.say(error.key);
  }

  private say(key: string): void {
    this.snackBar.open(this.transloco.translate(key), undefined, {
      duration: 4000,
    });
  }
}
