import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PayoutStatus } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { LanguageService } from '../../core/i18n/language';
import { LEAVE_FOR } from './leave-for';
import { PayoutsStore } from './payouts.store';

/** What the main button does in each state (null: no button). */
const SETUP_ACTION: Record<PayoutStatus, 'start' | 'continue' | null> = {
  NOT_STARTED: 'start',
  INCOMPLETE: 'continue',
  PENDING: null,
  READY: null,
  RESTRICTED: 'continue',
};

/** Stripe only gives a dashboard once the details were sent. */
const HAS_DASHBOARD: ReadonlySet<PayoutStatus> = new Set([
  'PENDING',
  'READY',
  'RESTRICTED',
]);

/**
 * Settings → Payouts (ADR-0019): where a lender sets up the Stripe account
 * BorrowBox pays them through. Stripe sends them back here with
 * `?stripe=return` (look again: its webhook lags) or `?stripe=refresh` (the
 * link expired: offer a new one); the query is removed once read.
 */
@Component({
  selector: 'bb-payouts-page',
  imports: [
    DatePipe,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatProgressBarModule,
  ],
  providers: [PayoutsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <a class="back bb-text-action-host" routerLink="/settings">
        <span aria-hidden="true">‹</span>
        <span class="bb-text-action">{{ t('payouts.back') }}</span>
      </a>
      <h1 class="page-title">{{ t('payouts.title') }}</h1>
      <p class="intro">{{ t('payouts.intro') }}</p>

      @if (store.busy() || store.status() === 'loading') {
        <mat-progress-bar mode="indeterminate" />
      }

      <div class="live" aria-live="polite">
        @if (store.busy() === 'onboarding') {
          <p class="muted">{{ t('payouts.opening') }}</p>
        } @else if (store.busy() === 'dashboard') {
          <p class="muted">{{ t('payouts.openingDashboard') }}</p>
        } @else if (store.refreshing()) {
          <p class="muted">{{ t('payouts.checking') }}</p>
        }
        @if (store.errorKey(); as key) {
          <p class="form-error" role="alert">{{ t(key) }}</p>
        }
      </div>

      @if (store.status() === 'error' && !store.account()) {
        <button mat-stroked-button type="button" (click)="store.load()">
          {{ t('payouts.retry') }}
        </button>
      }

      @if (store.account(); as account) {
        <section class="status" [attr.data-status]="account.status">
          <h2 class="status-title">
            <span class="marker" aria-hidden="true"></span>
            {{ t('payouts.status.' + account.status + '.title') }}
          </h2>
          <p>{{ t('payouts.status.' + account.status + '.text') }}</p>
          @if (account.status === 'READY' && !account.payoutsEnabled) {
            <p class="muted">{{ t('payouts.payoutsDisabled') }}</p>
          }
          @if (account.updatedAt) {
            <p class="muted small">
              {{
                t('payouts.updatedAt', {
                  date:
                    (account.updatedAt
                    | date
                      : 'medium'
                      : 'Europe/Athens'
                      : language.formatLocale()),
                })
              }}
            </p>
          }
        </section>

        @if (expiredLink() && account.status !== 'READY') {
          <p class="notice" role="status">{{ t('payouts.linkExpired') }}</p>
        }

        @if (setupAction() && !emailVerified()) {
          <p class="notice">
            {{ t('payouts.verifyFirst') }}
            <a class="bb-text-action" routerLink="/settings">{{
              t('payouts.verifyLink')
            }}</a>
          </p>
        }

        <div class="actions">
          @if (setupAction(); as action) {
            <button
              mat-flat-button
              type="button"
              [disabled]="store.busy() !== null || !emailVerified()"
              (click)="openOnboarding()"
            >
              {{ t(action === 'start' ? 'payouts.setUp' : 'payouts.continue') }}
            </button>
          }
          @if (hasDashboard()) {
            <button
              mat-stroked-button
              type="button"
              [disabled]="store.busy() !== null"
              (click)="openDashboard()"
            >
              {{ t('payouts.dashboard') }}
            </button>
          }
        </div>
        @if (hasDashboard()) {
          <p class="muted small">{{ t('payouts.dashboardHint') }}</p>
        }

        <h2 class="how-title">{{ t('payouts.how.title') }}</h2>
        <ol class="how">
          <li>{{ t('payouts.how.stripe') }}</li>
          <li>{{ t('payouts.how.transfer') }}</li>
          <li>{{ t('payouts.how.deposit') }}</li>
        </ol>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      max-width: 640px;
    }
    .back {
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
      display: inline-flex;
      gap: 6px;
      margin-bottom: 12px;
      text-decoration: none;
    }
    .intro {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 24px;
    }
    .live:empty {
      display: none;
    }
    .live p {
      margin: 12px 0;
    }
    .status {
      border-left: 3px solid var(--status-colour);
      margin: 16px 0 24px;
      padding: 2px 0 2px 16px;
      --status-colour: var(--mat-sys-outline-variant);
    }
    .status[data-status='READY'] {
      --status-colour: var(--mat-sys-primary);
    }
    .status[data-status='PENDING'],
    .status[data-status='INCOMPLETE'] {
      --status-colour: var(--bb-sky-500);
    }
    .status[data-status='RESTRICTED'] {
      --status-colour: var(--mat-sys-error);
    }
    .status p {
      margin: 0 0 6px;
    }
    .status-title {
      align-items: center;
      display: flex;
      font: var(--mat-sys-title-medium);
      gap: 10px;
      margin: 0 0 8px;
    }
    .marker {
      background: var(--status-colour);
      height: 10px;
      width: 10px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .notice {
      margin: 0 0 16px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 8px;
    }
    .how-title {
      font: var(--mat-sys-title-medium);
      margin: 40px 0 8px;
    }
    .how {
      color: var(--mat-sys-on-surface-variant);
      display: grid;
      gap: 8px;
      margin: 0;
      padding-left: 20px;
    }
    @media (max-width: 599px) {
      .actions button {
        width: 100%;
      }
    }
  `,
})
export class PayoutsPage implements OnInit {
  protected readonly store = inject(PayoutsStore);
  protected readonly language = inject(LanguageService);
  private readonly auth = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leaveFor = inject(LEAVE_FOR);

  /** Stripe's link expired before the lender finished (`?stripe=refresh`). */
  protected readonly expiredLink = signal(false);

  protected readonly emailVerified = computed(
    () => this.auth.user()?.emailVerified ?? false,
  );
  protected readonly setupAction = computed(() => {
    const status = this.store.account()?.status;
    return status ? SETUP_ACTION[status] : null;
  });
  protected readonly hasDashboard = computed(() => {
    const status = this.store.account()?.status;
    return status ? HAS_DASHBOARD.has(status) : false;
  });

  ngOnInit(): void {
    const stripe = this.route.snapshot.queryParamMap.get('stripe');
    if (stripe !== null) {
      // Read once; a reload or a shared URL shouldn't replay it.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
    this.expiredLink.set(stripe === 'refresh');
    if (stripe === 'return') void this.store.refreshAfterReturn();
    else void this.store.load();
  }

  protected async openOnboarding(): Promise<void> {
    const url = await this.store.onboardingLink();
    if (url) this.leaveFor(url);
  }

  /** The dashboard opens in this tab, like onboarding (see the report). */
  protected async openDashboard(): Promise<void> {
    const url = await this.store.dashboardLink();
    if (url) this.leaveFor(url);
  }
}
