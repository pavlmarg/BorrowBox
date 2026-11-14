import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { EurPipe } from '../../shared/format/eur.pipe';
import { AthensPeriodPipe } from './athens.pipes';
import { otherParty } from './booking-text';
import {
  BookingsListStore,
  parseRole,
  parseShow,
  type ListShow,
} from './bookings-list.store';
import { StatusChip } from './status-chip';

/**
 * The caller's bookings (`/bookings`): Renting and Lending tabs and a
 * current / past filter, both in the URL (`?role=&show=`) so a view can be
 * shared or bookmarked. Rows sit on the page, separated by dividers.
 */
@Component({
  selector: 'bb-bookings-list-page',
  imports: [
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    EurPipe,
    AthensPeriodPipe,
    StatusChip,
  ],
  providers: [BookingsListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *transloco="let t">
      <h1 class="page-title">{{ t('bookings.list.title') }}</h1>

      <nav class="tabs" [attr.aria-label]="t('bookings.list.sides')">
        @for (r of roles; track r) {
          <a
            class="tab"
            routerLink="/bookings"
            [queryParams]="{ role: r, show: filter() }"
            [class.active]="side() === r"
            [attr.aria-current]="side() === r ? 'page' : null"
            >{{ t('bookings.list.role.' + r) }}</a
          >
        }
      </nav>

      <div
        class="filters"
        role="group"
        [attr.aria-label]="t('bookings.list.showLabel')"
      >
        @for (s of shows; track s) {
          <a
            class="filter"
            routerLink="/bookings"
            [queryParams]="{ role: side(), show: s }"
            [class.active]="filter() === s"
            [attr.aria-current]="filter() === s ? 'true' : null"
            >{{ t('bookings.list.show.' + s) }}</a
          >
        }
      </div>

      @switch (store.status()) {
        @case ('loading') {
          <p class="muted" aria-live="polite">
            {{ t('bookings.list.loading') }}
          </p>
        }
        @case ('error') {
          <div class="message" role="alert">
            <p>{{ t('errors.' + store.error()) }}</p>
            <button mat-stroked-button type="button" (click)="reload()">
              {{ t('explore.retry') }}
            </button>
          </div>
        }
        @default {
          @if (store.bookings().length === 0) {
            <div class="message">
              <p class="strong">{{ t('bookings.list.empty.' + filter()) }}</p>
              @if (side() === 'renter') {
                <p>{{ t('bookings.list.emptyRenter') }}</p>
                <a mat-flat-button routerLink="/explore">{{
                  t('bookings.list.toExplore')
                }}</a>
              } @else {
                <p>{{ t('bookings.list.emptyLender') }}</p>
                <a mat-flat-button routerLink="/my-items">{{
                  t('bookings.list.toMyItems')
                }}</a>
              }
            </div>
          } @else {
            <ul class="list">
              @for (b of store.bookings(); track b.id) {
                <li>
                  <a class="row" [routerLink]="['/bookings', b.id]">
                    <span class="main">
                      <strong class="title">{{ b.itemTitle }}</strong>
                      <span class="who">
                        {{
                          t(
                            b.role === 'RENTER'
                              ? 'bookings.withLender'
                              : 'bookings.withRenter',
                            {
                              name:
                                other(b).displayName ??
                                t('bookings.deletedAccount'),
                            }
                          )
                        }}
                      </span>
                      <span class="period">{{ b | athensPeriod }}</span>
                    </span>
                    <span class="side">
                      <bb-status-chip [status]="b.status" />
                      <span class="amount">
                        @if (b.role === 'RENTER') {
                          {{
                            b.price.totalCents > 0
                              ? (b.price.totalCents | eur)
                              : t('catalog.free')
                          }}
                        } @else {
                          {{
                            b.price.rentCents > 0
                              ? (b.price.rentCents | eur)
                              : t('catalog.free')
                          }}
                        }
                      </span>
                    </span>
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
                  {{
                    store.loadingMore()
                      ? t('bookings.list.loading')
                      : t('bookings.list.more')
                  }}
                </button>
                @if (store.moreError(); as code) {
                  <p class="error" role="alert">{{ t('errors.' + code) }}</p>
                }
              </div>
            }
          }
        }
      }
    </div>
  `,
  styles: `
    .page-title {
      font: var(--mat-sys-headline-small);
      margin: 0 0 16px;
    }
    .tabs {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      display: flex;
      gap: 24px;
    }
    .tab {
      border-bottom: 3px solid transparent;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-title-medium);
      margin-bottom: -1px;
      padding: 8px 0 10px;
      text-decoration: none;
      transition:
        color var(--bb-fast) var(--bb-ease),
        border-color var(--bb-fast) var(--bb-ease);
    }
    .tab:hover {
      color: var(--mat-sys-on-surface);
    }
    .tab.active {
      border-bottom-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-surface);
      font-weight: 700;
    }
    .tab:focus-visible,
    .filter:focus-visible,
    .row:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 16px 0 8px;
    }
    .filter {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      padding: 6px 12px;
      text-decoration: none;
      transition: background-color var(--bb-fast) var(--bb-ease);
    }
    .filter:hover {
      background: var(--bb-sky-50);
    }
    .filter.active {
      background: var(--mat-sys-primary);
      border-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    @media (prefers-reduced-motion: reduce) {
      .tab,
      .filter {
        transition: none;
      }
    }
    .list {
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
    }
    .row {
      align-items: flex-start;
      border-top: 1px solid var(--mat-sys-outline-variant);
      color: inherit;
      display: flex;
      gap: 16px;
      justify-content: space-between;
      padding: 18px 0;
      text-decoration: none;
    }
    .row:hover .title {
      color: var(--bb-sky-700);
    }
    .main {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .title {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
      overflow-wrap: anywhere;
      transition: color var(--bb-fast) var(--bb-ease);
    }
    .who,
    .period {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .side {
      align-items: flex-end;
      display: flex;
      flex: none;
      flex-direction: column;
      gap: 8px;
    }
    .amount {
      font: var(--mat-sys-title-small);
      font-weight: 700;
    }
    .more {
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding: 20px 0;
      text-align: center;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--mat-sys-error);
      margin: 8px 0 0;
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
export class BookingsListPage {
  /** From the URL (`?role=renter|lender`). */
  readonly role = input<string>();
  /** From the URL (`?show=current|past|all`). */
  readonly show = input<string>();

  protected readonly store = inject(BookingsListStore);
  protected readonly roles = ['renter', 'lender'] as const;
  protected readonly shows: readonly ListShow[] = ['current', 'past', 'all'];
  protected readonly side = computed(() => parseRole(this.role()));
  protected readonly filter = computed(() => parseShow(this.show()));
  protected readonly other = otherParty;

  constructor() {
    effect(() => {
      const side = this.side();
      const filter = this.filter();
      untracked(() => void this.store.load(side, filter));
    });
  }

  protected reload(): void {
    void this.store.load(this.side(), this.filter());
  }
}
