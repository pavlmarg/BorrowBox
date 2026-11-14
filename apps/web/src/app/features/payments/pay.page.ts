import { DatePipe, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  type ElementRef,
  type OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type {
  Stripe,
  StripeElementLocale,
  StripeElements,
  StripePaymentElement,
} from '@stripe/stripe-js';
import { LanguageService } from '../../core/i18n/language';
import { EurPipe } from '../../shared/format/eur.pipe';
import { CheckoutStore } from './checkout.store';
import { readThemeColours, stripeAppearance } from './stripe-appearance';
import { StripeLoader } from './stripe-loader';
import { timeLeft } from './time-left';

/** Query parameters Stripe adds when it sends the renter back (3-D Secure). */
const STRIPE_RETURN_PARAMS = [
  'payment_intent',
  'payment_intent_client_secret',
  'redirect_status',
];

const stripeLocale = (lang: string): StripeElementLocale =>
  lang === 'en' ? 'en' : 'el';

/**
 * The renter pays an accepted booking (ADR-0019): the amounts, the pay-by
 * time, and Stripe's Payment Element for the card. Stripe.js loads only on
 * this page; the client secret stays in memory, handed from the API straight
 * to Stripe. After the card is confirmed (here or after a 3-D Secure
 * redirect back to this page) the page waits for Payments to hear of it,
 * then moves on to the booking.
 */
@Component({
  selector: 'bb-pay-page',
  imports: [
    DatePipe,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatProgressBarModule,
    EurPipe,
  ],
  providers: [CheckoutStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <a
        class="back bb-text-action-host"
        [routerLink]="['/bookings', bookingId]"
      >
        <span aria-hidden="true">‹</span>
        <span class="bb-text-action">{{ t('payment.back') }}</span>
      </a>
      <h1 class="page-title">{{ t('payment.title') }}</h1>

      @if (store.phase() === 'loading') {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (store.view(); as view) {
        <dl class="summary">
          <div class="row">
            <dt>{{ t('payment.rent') }}</dt>
            <dd>{{ view.rentCents | eur }}</dd>
          </div>
          <div class="row">
            <dt>{{ t('payment.fee') }}</dt>
            <dd>{{ view.feeCents | eur }}</dd>
          </div>
          @if (view.depositCents > 0) {
            <div class="row">
              <dt>
                {{ t('payment.deposit') }}
                <span class="hint">{{ t('payment.depositHint') }}</span>
              </dt>
              <dd>{{ view.depositCents | eur }}</dd>
            </div>
          }
          <div class="row total">
            <dt>{{ t('payment.total') }}</dt>
            <dd>{{ view.chargeCents | eur }}</dd>
          </div>
        </dl>

        @if (store.phase() === 'pay' && view.payBy) {
          <p class="pay-by">
            {{
              t('payment.payBy', {
                date:
                  (view.payBy
                  | date
                    : 'EEEE d MMMM, HH:mm'
                    : 'Europe/Athens'
                    : language.formatLocale()),
              })
            }}
            @if (left(); as l) {
              <strong class="left">
                {{
                  l.hours > 0
                    ? t('payment.leftHours', l)
                    : t('payment.leftMinutes', l)
                }}
              </strong>
            }
          </p>
        }
      }

      <div class="live" aria-live="polite">
        @switch (store.phase()) {
          @case ('confirming') {
            <mat-progress-bar mode="indeterminate" />
            <p>{{ t('payment.confirming') }}</p>
          }
          @case ('done') {
            <p>{{ t('payment.paid') }}</p>
          }
          @case ('slow') {
            <p>{{ t('payment.slow') }}</p>
          }
        }
      </div>

      @switch (store.phase()) {
        @case ('slow') {
          <a class="bb-text-action" [routerLink]="['/bookings', bookingId]">{{
            t('payment.toBooking')
          }}</a>
        }
        @case ('closed') {
          <p class="notice" role="alert">
            {{ t(store.messageKey() ?? 'payment.closed.default') }}
          </p>
          <a class="bb-text-action" [routerLink]="['/bookings', bookingId]">{{
            t('payment.toBooking')
          }}</a>
        }
        @case ('error') {
          @if (store.messageKey(); as key) {
            <p class="form-error" role="alert">{{ t(key) }}</p>
          }
          <button mat-stroked-button type="button" (click)="retry()">
            {{ t('payment.retry') }}
          </button>
        }
        @case ('pay') {
          @switch (stripeState()) {
            @case ('loading') {
              <mat-progress-bar mode="indeterminate" />
              <p class="muted" aria-live="polite">
                {{ t('payment.loadingForm') }}
              </p>
            }
            @case ('unavailable') {
              <p class="notice" role="alert">{{ t('payment.unavailable') }}</p>
            }
            @case ('failed') {
              <p class="form-error" role="alert">
                {{ t('payment.formFailed') }}
              </p>
              <button mat-stroked-button type="button" (click)="retry()">
                {{ t('payment.retry') }}
              </button>
            }
          }
        }
      }

      <!-- Always in the page, so Stripe can mount into it; shown once ready. -->
      <form
        class="pay-form"
        [hidden]="store.phase() !== 'pay' || stripeState() !== 'ready'"
        (submit)="$event.preventDefault(); pay()"
        novalidate
      >
        <div #paymentHost class="payment-element"></div>
        <div aria-live="assertive">
          @if (cardError(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
          } @else if (cardErrorKey(); as key) {
            <p class="form-error" role="alert">{{ t(key) }}</p>
          }
        </div>
        <p class="muted small">{{ t('payment.cardOnly') }}</p>
        <button
          mat-flat-button
          type="submit"
          class="pay"
          [disabled]="!formReady() || submitting()"
        >
          {{
            t('payment.payButton', {
              amount: (store.view()?.chargeCents ?? 0 | eur),
            })
          }}
        </button>
        @if (submitting()) {
          <mat-progress-bar mode="indeterminate" />
        }
      </form>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      max-width: 560px;
    }
    .back {
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
      display: inline-flex;
      gap: 6px;
      margin-bottom: 12px;
      text-decoration: none;
    }
    .summary {
      margin: 8px 0 16px;
    }
    .row {
      align-items: baseline;
      display: flex;
      gap: 16px;
      justify-content: space-between;
      padding: 8px 0;
    }
    .row dt {
      display: flex;
      flex-direction: column;
    }
    .row dd {
      font-variant-numeric: tabular-nums;
      margin: 0;
      white-space: nowrap;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .total {
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 700;
      margin-top: 4px;
      padding-top: 12px;
    }
    .pay-by {
      margin: 0 0 24px;
    }
    .left {
      display: block;
      font-weight: 600;
    }
    .live p,
    .notice {
      margin: 12px 0;
    }
    .pay-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 8px;
    }
    .pay-form[hidden] {
      display: none;
    }
    .payment-element {
      min-height: 120px;
    }
    .small {
      font: var(--mat-sys-body-small);
      margin: 0;
    }
    .pay {
      align-self: flex-start;
    }
    @media (max-width: 599px) {
      .pay {
        align-self: stretch;
      }
    }
  `,
})
export class PayPage implements OnInit {
  protected readonly store = inject(CheckoutStore);
  protected readonly language = inject(LanguageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly loader = inject(StripeLoader);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly bookingId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly stripeState = signal<
    'loading' | 'ready' | 'unavailable' | 'failed'
  >('loading');
  /** Stripe's form is shown and can take a card. */
  protected readonly formReady = signal(false);
  protected readonly submitting = signal(false);
  /** Stripe's own message for a refused card (in the UI's language). */
  protected readonly cardError = signal<string | null>(null);
  /** Our message when Stripe gave none. */
  protected readonly cardErrorKey = signal<string | null>(null);

  private readonly now = signal(Date.now());
  protected readonly left = computed(() => {
    const payBy = this.store.view()?.payBy;
    return payBy ? timeLeft(payBy, this.now()) : null;
  });

  private readonly paymentHost =
    viewChild.required<ElementRef<HTMLElement>>('paymentHost');
  private stripe?: Stripe;
  private elements?: StripeElements;
  private paymentElement?: StripePaymentElement;
  private stopWatchingTheme?: () => void;

  constructor() {
    effect(() => {
      if (this.store.phase() === 'done') {
        void this.router.navigate(['/bookings', this.bookingId], {
          replaceUrl: true,
        });
      }
    });
    effect(() => {
      const locale = stripeLocale(this.language.current());
      untracked(() => void this.elements?.update({ locale }));
    });
    const clock = setInterval(() => this.now.set(Date.now()), 30_000);
    this.destroyRef.onDestroy(() => {
      clearInterval(clock);
      this.teardownForm();
    });
  }

  async ngOnInit(): Promise<void> {
    const query = this.route.snapshot.queryParamMap;
    const redirect = query.get('redirect_status');
    if (STRIPE_RETURN_PARAMS.some((name) => query.has(name))) {
      // Read once, then off the address bar (and out of history).
      this.location.replaceState(this.payPath());
    }
    if (redirect === 'succeeded' || redirect === 'processing') {
      await this.store.awaitOutcome(this.bookingId);
      return;
    }
    if (redirect === 'failed') this.cardErrorKey.set('payment.attemptFailed');
    await this.begin();
  }

  protected async retry(): Promise<void> {
    this.cardError.set(null);
    this.cardErrorKey.set(null);
    await this.begin();
  }

  protected async pay(): Promise<void> {
    const { stripe, elements } = this;
    if (!stripe || !elements || this.submitting()) return;
    this.submitting.set(true);
    this.cardError.set(null);
    this.cardErrorKey.set(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${this.document.location.origin}${this.payPath()}`,
        },
        redirect: 'if_required',
      });
      if (result.error) {
        const { type, code, message } = result.error;
        if (code === 'payment_intent_unexpected_state') {
          // Paid already (another tab?): see what Payments says.
          await this.store.awaitOutcome(this.bookingId);
        } else if (
          (type === 'card_error' || type === 'validation_error') &&
          message
        ) {
          this.cardError.set(message);
        } else {
          this.cardErrorKey.set('payment.stripeFailed');
        }
        return;
      }
      const status = result.paymentIntent.status;
      if (status === 'succeeded' || status === 'processing') {
        await this.store.awaitOutcome(this.bookingId);
      } else {
        this.cardErrorKey.set('payment.attemptFailed');
      }
    } finally {
      this.submitting.set(false);
    }
  }

  /** Reads the payment and, if it waits for a card, shows Stripe's form. */
  private async begin(): Promise<void> {
    const phase = await this.store.load(this.bookingId);
    if (phase === 'confirming') {
      await this.store.awaitOutcome(this.bookingId);
    } else if (phase === 'pay') {
      await this.prepareForm();
    }
  }

  private async prepareForm(): Promise<void> {
    this.teardownForm();
    this.stripeState.set('loading');
    let stripe: Stripe | null;
    try {
      stripe = await this.loader.load();
    } catch {
      this.stripeState.set('failed');
      return;
    }
    if (!stripe) {
      this.stripeState.set('unavailable');
      return;
    }
    // Only now: no PaymentIntent is created while the form can't show.
    const clientSecret = await this.store.start(this.bookingId);
    if (!clientSecret) return;

    const host = this.paymentHost().nativeElement;
    this.stripe = stripe;
    this.elements = stripe.elements({
      clientSecret,
      appearance: stripeAppearance(readThemeColours(host)),
      locale: stripeLocale(this.language.current()),
    });
    const element = this.elements.create('payment', { layout: 'tabs' });
    element.on('ready', () => this.formReady.set(true));
    element.on('change', () => {
      this.cardError.set(null);
      this.cardErrorKey.set(null);
    });
    element.mount(host);
    this.paymentElement = element;
    this.stripeState.set('ready');
    this.stopWatchingTheme = this.watchTheme(host);
  }

  /**
   * Stripe's form can't read our CSS variables, so its colours are copied in
   * and copied again when the theme changes (system dark mode, or a theme
   * switch on the root element).
   */
  private watchTheme(host: HTMLElement): () => void {
    const apply = () =>
      void this.elements?.update({
        appearance: stripeAppearance(readThemeColours(host)),
      });
    const view = this.document.defaultView;
    const media = view?.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', apply);
    const observer = new MutationObserver(apply);
    for (const el of [this.document.documentElement, this.document.body]) {
      observer.observe(el, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme'],
      });
    }
    return () => {
      media?.removeEventListener('change', apply);
      observer.disconnect();
    };
  }

  private teardownForm(): void {
    this.stopWatchingTheme?.();
    this.stopWatchingTheme = undefined;
    this.paymentElement?.destroy();
    this.paymentElement = undefined;
    this.elements = undefined;
    this.formReady.set(false);
  }

  private payPath(): string {
    return `/bookings/${encodeURIComponent(this.bookingId)}/pay`;
  }
}
