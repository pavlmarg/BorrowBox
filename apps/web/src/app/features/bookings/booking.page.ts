import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { RENTER_FULL_REFUND_HOURS } from '@borrowbox/contracts';
import type { BookingViewResponse } from '../../api/models';
import { LanguageService } from '../../core/i18n/language';
import { openConfirm } from '../../shared/confirm-dialog';
import {
  formatAthensPeriod,
  formatAthensTime,
} from '../../shared/format/athens';
import { EurPipe } from '../../shared/format/eur.pipe';
import { AthensPeriodPipe, AthensTimePipe } from './athens.pipes';
import {
  bookingErrorKey,
  canCancel,
  durationParts,
  otherParty,
  timeLeft,
  unitParts,
  type AnyBookingError,
} from './booking-text';
import { BookingStore, type BookingAction } from './booking.store';
import { StatusChip } from './status-chip';

const HOUR_MS = 3_600_000;

/** The policy that applies if this booking is cancelled now (ADR-0021). */
export type CancelPolicy =
  'nothingPaid' | 'renterEarly' | 'renterLate' | 'lenderPaid';

export function cancelPolicy(
  booking: BookingViewResponse,
  now: number,
): CancelPolicy {
  if (booking.status !== 'PAID') return 'nothingPaid';
  if (booking.role === 'LENDER') return 'lenderPaid';
  const hoursBefore = (Date.parse(booking.start) - now) / HOUR_MS;
  return hoursBefore > RENTER_FULL_REFUND_HOURS ? 'renterEarly' : 'renterLate';
}

/**
 * One booking (`/bookings/:id`), for its renter or its lender: the period
 * in Athens time, where it stands and why, the money from the caller's
 * side, and what they can do next. Notification emails link here.
 */
@Component({
  selector: 'bb-booking-page',
  imports: [
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    EurPipe,
    AthensPeriodPipe,
    AthensTimePipe,
    StatusChip,
  ],
  providers: [BookingStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" *transloco="let t">
      <a
        class="back bb-text-action-host"
        routerLink="/bookings"
        [queryParams]="{ role: listRole() }"
      >
        <span class="chevron" aria-hidden="true"></span>
        <span class="bb-text-action bb-text-action-rtl">{{
          t('bookings.detail.back')
        }}</span>
      </a>

      @switch (store.status()) {
        @case ('loading') {
          <p class="muted" aria-live="polite">
            {{ t('bookings.detail.loading') }}
          </p>
        }
        @case ('error') {
          <div class="message" role="alert">
            <p>{{ t(errorKey(store.error() ?? 'INTERNAL')) }}</p>
            @if (store.error() !== 'NOT_FOUND') {
              <button mat-stroked-button type="button" (click)="reload()">
                {{ t('explore.retry') }}
              </button>
            }
          </div>
        }
        @case ('ready') {
          @if (store.booking(); as b) {
            <header class="head">
              <bb-status-chip [status]="b.status" />
              <h1 class="title">
                <a class="bb-text-action" [routerLink]="['/items', b.itemId]">{{
                  b.itemTitle
                }}</a>
              </h1>
              <p class="who">
                {{
                  t(
                    b.role === 'RENTER'
                      ? 'bookings.withLender'
                      : 'bookings.withRenter',
                    { name: otherName(b, t('bookings.deletedAccount')) }
                  )
                }}
              </p>
              <p class="period">
                {{ b | athensPeriod }}
                <span class="length">
                  ·
                  @for (p of length(b); track p.key) {
                    {{ t(p.key, { n: p.n }) }}
                  }
                </span>
              </p>
              <p class="hint">{{ t('bookings.book.athensTime') }}</p>
            </header>

            <section class="section" aria-live="polite">
              <p class="state">
                @if (b.reason) {
                  {{
                    t(
                      'bookings.reason.' +
                        b.status +
                        '_' +
                        b.reason +
                        '.' +
                        b.role,
                      { name: otherName(b, t('bookings.deletedAccount')) }
                    )
                  }}
                } @else {
                  {{
                    t('bookings.state.' + b.status + '.' + b.role, {
                      name: otherName(b, t('bookings.deletedAccount')),
                      time: (b.expiresAt ?? b.payBy | athensTime),
                    })
                  }}
                }
              </p>

              @if (b.status === 'ACCEPTED' && b.role === 'RENTER' && b.payBy) {
                <div class="pay">
                  <p class="countdown">
                    {{
                      t('bookings.detail.timeLeft', {
                        h: left().hours,
                        m: left().minutes,
                        s: pad(left().seconds),
                      })
                    }}
                  </p>
                  <a
                    mat-flat-button
                    class="pay-now"
                    [routerLink]="['/bookings', b.id, 'pay']"
                    >{{ t('bookings.detail.payNow') }}</a
                  >
                </div>
              }

              @if (b.status === 'CONFIRMED' || b.status === 'PAID') {
                <p class="meet">
                  {{ t('bookings.detail.meet') }}
                  <!--
                    CHAT LINK SLOT: the chat feature adds a link to this
                    booking's conversation here ("Open the chat").
                  -->
                </p>
              }
            </section>

            <section class="section">
              <h2>{{ t('bookings.detail.money') }}</h2>
              @if (b.price.totalCents === 0) {
                <p>{{ t('bookings.book.nothingToPay') }}</p>
              } @else if (b.role === 'RENTER') {
                <dl class="amounts">
                  <div class="line">
                    <dt>
                      {{ t('bookings.price.rent') }}
                      <span class="units">
                        @for (u of units(b); track u.key; let last = $last) {
                          {{ t(u.key, { n: u.n }) }}{{ last ? '' : ' + ' }}
                        }
                      </span>
                    </dt>
                    <dd>
                      {{
                        b.price.rentCents > 0
                          ? (b.price.rentCents | eur)
                          : t('catalog.free')
                      }}
                    </dd>
                  </div>
                  <div class="line">
                    <dt>{{ t('bookings.price.fee') }}</dt>
                    <dd>{{ b.price.feeCents | eur }}</dd>
                  </div>
                  @if (b.price.depositCents > 0) {
                    <div class="line">
                      <dt>{{ t('bookings.price.deposit') }}</dt>
                      <dd>{{ b.price.depositCents | eur }}</dd>
                    </div>
                  }
                  <div class="line total">
                    <dt>{{ t('bookings.price.total') }}</dt>
                    <dd>{{ b.price.totalCents | eur }}</dd>
                  </div>
                </dl>
                @if (b.price.depositCents > 0) {
                  <p class="hint">
                    {{
                      t('bookings.book.depositExplained', {
                        deposit: (b.price.depositCents | eur),
                      })
                    }}
                  </p>
                }
              } @else {
                <dl class="amounts">
                  <div class="line">
                    <dt>{{ t('bookings.price.rent') }}</dt>
                    <dd>
                      {{
                        b.price.rentCents > 0
                          ? (b.price.rentCents | eur)
                          : t('catalog.free')
                      }}
                    </dd>
                  </div>
                  @if (b.price.lenderFeeCents > 0) {
                    <div class="line">
                      <dt>{{ t('bookings.price.lenderFee') }}</dt>
                      <dd>−{{ b.price.lenderFeeCents | eur }}</dd>
                    </div>
                  }
                  <div class="line total">
                    <dt>{{ t('bookings.price.payout') }}</dt>
                    <dd>{{ b.price.payoutCents | eur }}</dd>
                  </div>
                </dl>
                <p class="hint">{{ t('bookings.price.payoutWhen') }}</p>
                @if (b.price.depositCents > 0) {
                  <p class="hint">
                    {{
                      t('bookings.price.lenderDeposit', {
                        deposit: (b.price.depositCents | eur),
                      })
                    }}
                  </p>
                }
              }
              @if (b.price.offerId) {
                <p class="hint">{{ t('bookings.price.fromOffer') }}</p>
              }
            </section>

            <section class="section">
              <h2>{{ t('bookings.detail.summary') }}</h2>
              <ol class="timeline">
                <li>
                  <span>{{ t('bookings.detail.requested') }}</span>
                  <span>{{ b.createdAt | athensTime }}</span>
                </li>
                @if (b.status === 'REQUESTED' && b.expiresAt) {
                  <li>
                    <span>{{ t('bookings.detail.answerBy') }}</span>
                    <span>{{ b.expiresAt | athensTime }}</span>
                  </li>
                }
                @if (b.status === 'ACCEPTED' && b.payBy) {
                  <li>
                    <span>{{ t('bookings.detail.payBy') }}</span>
                    <span>{{ b.payBy | athensTime }}</span>
                  </li>
                }
                @if (b.updatedAt !== b.createdAt) {
                  <li>
                    <span>{{ t('bookings.detail.updated') }}</span>
                    <span>{{ b.updatedAt | athensTime }}</span>
                  </li>
                }
                <li>
                  <span>{{ t('bookings.detail.starts') }}</span>
                  <span>{{ b.start | athensTime }}</span>
                </li>
                <li>
                  <span>{{ t('bookings.detail.ends') }}</span>
                  <span>{{ b.end | athensTime }}</span>
                </li>
              </ol>
            </section>

            @if (canAnswer() || canWithdraw() || cancellable()) {
              <section class="section">
                <h2>{{ t('bookings.detail.actions') }}</h2>
                @if (cancellable()) {
                  <div class="policy">
                    @switch (policy()) {
                      @case ('renterEarly') {
                        <p>{{ t('bookings.policy.renterEarly') }}</p>
                        <p>{{ t('bookings.policy.renterLate') }}</p>
                        <p class="strong">
                          {{ t('bookings.policy.nowEarly') }}
                        </p>
                      }
                      @case ('renterLate') {
                        <p>{{ t('bookings.policy.renterEarly') }}</p>
                        <p>{{ t('bookings.policy.renterLate') }}</p>
                        <p class="strong">{{ t('bookings.policy.nowLate') }}</p>
                      }
                      @case ('lenderPaid') {
                        <p>
                          {{
                            t('bookings.policy.lenderPaid', {
                              name: otherName(b, t('bookings.deletedAccount')),
                            })
                          }}
                        </p>
                      }
                      @default {
                        <p>{{ t('bookings.policy.nothingPaid') }}</p>
                      }
                    }
                  </div>
                }
                <div class="buttons">
                  @if (canAnswer()) {
                    <button
                      mat-flat-button
                      type="button"
                      [disabled]="store.acting() !== null"
                      (click)="run('accept')"
                    >
                      {{ t('bookings.detail.accept') }}
                    </button>
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="store.acting() !== null"
                      (click)="run('decline')"
                    >
                      {{ t('bookings.detail.decline') }}
                    </button>
                  }
                  @if (canWithdraw()) {
                    <button
                      mat-stroked-button
                      type="button"
                      class="withdraw"
                      [disabled]="store.acting() !== null"
                      (click)="run('cancel')"
                    >
                      {{ t('bookings.detail.withdraw') }}
                    </button>
                  }
                  @if (cancellable()) {
                    <button
                      mat-stroked-button
                      type="button"
                      class="danger"
                      [disabled]="store.acting() !== null"
                      (click)="run('cancel')"
                    >
                      {{ t('bookings.detail.cancel') }}
                    </button>
                  }
                </div>
              </section>
            }

            <div aria-live="assertive">
              @if (failure(); as code) {
                <p class="problem" role="alert">
                  {{
                    code === 'INVALID_STATE'
                      ? t('bookings.detail.changed')
                      : t(errorKey(code))
                  }}
                  @if (code === 'PAYOUTS_NOT_SET_UP') {
                    <a class="bb-text-action" routerLink="/settings/payouts">{{
                      t('bookings.detail.setUpPayouts')
                    }}</a>
                  }
                </p>
              }
            </div>
          }
        }
      }
    </div>
  `,
  styles: `
    .page {
      max-width: 720px;
    }
    .back {
      align-items: center;
      color: var(--bb-sky-700);
      display: inline-flex;
      font: var(--mat-sys-label-large);
      gap: 8px;
      margin: 0 0 16px;
      padding: 8px 0;
      text-decoration: none;
    }
    .chevron {
      border-bottom: 2px solid currentColor;
      border-left: 2px solid currentColor;
      height: 7px;
      transform: rotate(45deg);
      width: 7px;
    }
    .head {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .head bb-status-chip {
      align-self: flex-start;
    }
    .title {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 4px 0 0;
      overflow-wrap: anywhere;
    }
    .title a {
      color: inherit;
    }
    .who,
    .period {
      font: var(--mat-sys-body-large);
      margin: 0;
    }
    .who,
    .length {
      color: var(--mat-sys-on-surface-variant);
    }
    .hint,
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 6px 0 0;
    }
    .section {
      border-top: 1px solid var(--mat-sys-outline-variant);
      margin-top: 24px;
      padding-top: 20px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
      margin: 0 0 12px;
    }
    .state {
      font: var(--mat-sys-body-large);
      margin: 0;
    }
    .pay {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 16px;
    }
    .countdown {
      font: var(--mat-sys-title-medium);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      margin: 0;
    }
    .meet {
      color: var(--bb-sky-700);
      font: var(--mat-sys-body-large);
      font-weight: 600;
      margin: 12px 0 0;
    }
    .amounts {
      margin: 0;
      max-width: 420px;
    }
    .line {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 8px 0;
    }
    .line dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .units {
      display: block;
      font: var(--mat-sys-body-small);
    }
    .line dd {
      font-weight: 600;
      margin: 0;
      white-space: nowrap;
    }
    .total {
      border-bottom: 0;
    }
    .total dt,
    .total dd {
      color: var(--mat-sys-on-surface);
      font-weight: 800;
    }
    .timeline {
      list-style: none;
      margin: 0;
      max-width: 420px;
      padding: 0;
    }
    .timeline li {
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 4px 0;
    }
    .timeline li span:first-child {
      color: var(--mat-sys-on-surface-variant);
    }
    .policy p {
      margin: 0 0 8px;
    }
    .policy .strong {
      font-weight: 700;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .problem {
      color: var(--mat-sys-error);
      margin: 16px 0 0;
    }
    .problem a {
      color: inherit;
      font-weight: 700;
      margin-left: 6px;
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
export class BookingPage {
  /** From the route (`/bookings/:id`). */
  readonly id = input.required<string>();

  protected readonly store = inject(BookingStore);
  private readonly dialog = inject(MatDialog);
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  /** Ticks every second while a countdown is shown. */
  private readonly now = signal(Date.now());
  protected readonly failure = signal<AnyBookingError | null>(null);

  protected readonly errorKey = bookingErrorKey;
  protected readonly length = (b: BookingViewResponse) =>
    durationParts(
      Math.round((Date.parse(b.end) - Date.parse(b.start)) / HOUR_MS),
    );
  protected readonly units = (b: BookingViewResponse) =>
    unitParts(b.price.units);
  protected readonly pad = (n: number) => String(n).padStart(2, '0');

  protected readonly listRole = computed(() =>
    this.store.booking()?.role === 'LENDER' ? 'lender' : 'renter',
  );
  protected readonly canAnswer = computed(() => {
    const b = this.store.booking();
    return b?.role === 'LENDER' && b.status === 'REQUESTED';
  });
  protected readonly canWithdraw = computed(() => {
    const b = this.store.booking();
    return b?.role === 'RENTER' && b.status === 'REQUESTED';
  });
  protected readonly cancellable = computed(() => {
    const b = this.store.booking();
    return b !== null && canCancel(b, this.now());
  });
  protected readonly policy = computed(() => {
    const b = this.store.booking();
    return b ? cancelPolicy(b, this.now()) : 'nothingPaid';
  });
  /** Pay-by countdown (renter, ACCEPTED). */
  protected readonly left = computed(() =>
    timeLeft(
      this.store.booking()?.payBy ?? new Date(0).toISOString(),
      this.now(),
    ),
  );
  private readonly counting = computed(() => {
    const b = this.store.booking();
    return b?.status === 'ACCEPTED' && b.role === 'RENTER' && b.payBy !== null;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.failure.set(null);
        void this.store.load(id);
      });
    });

    // A second's tick while counting down, a minute's otherwise (the cancel
    // button disappears at the start).
    let timer: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const every = this.counting() ? 1000 : 60_000;
      if (timer) clearInterval(timer);
      timer = setInterval(() => this.now.set(Date.now()), every);
    });
    inject(DestroyRef).onDestroy(() => {
      if (timer) clearInterval(timer);
    });

    // When the pay-by time passes, Bookings expires the booking: fetch it.
    let refreshedFor: string | null = null;
    effect(() => {
      const b = this.store.booking();
      if (!this.counting() || !b?.payBy) return;
      if (this.left().ms === 0 && refreshedFor !== b.payBy) {
        refreshedFor = b.payBy;
        untracked(() => void this.store.load(b.id, true));
      }
    });
  }

  protected reload(): void {
    void this.store.load(this.id());
  }

  protected otherName(b: BookingViewResponse, deleted: string): string {
    return otherParty(b).displayName ?? deleted;
  }

  protected async run(action: BookingAction): Promise<void> {
    const b = this.store.booking();
    if (!b) return;
    if (!(await openConfirm(this.dialog, this.confirmText(b, action)))) return;
    this.failure.set(null);
    this.failure.set(await this.store.act(action));
  }

  private confirmText(b: BookingViewResponse, action: BookingAction) {
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params);
    const locale = this.language.formatLocale();
    const params = {
      name: this.otherName(b, t('bookings.deletedAccount')),
      period: formatAthensPeriod(b.start, b.end, locale),
      time: b.expiresAt ? formatAthensTime(b.expiresAt, locale) : '',
    };
    const kind =
      action !== 'cancel'
        ? action
        : b.status === 'REQUESTED'
          ? 'withdraw'
          : 'cancel';
    const message =
      kind === 'cancel'
        ? `${t('bookings.confirm.cancel.message', params)} ${t(
            'bookings.policy.' + this.policy() + 'Short',
            params,
          )}`
        : t(`bookings.confirm.${kind}.message`, params);
    return {
      title: t(`bookings.confirm.${kind}.title`),
      message,
      confirm: t(`bookings.confirm.${kind}.confirm`),
      cancel: t('bookings.confirm.keep'),
      danger: kind !== 'accept',
    };
  }
}
