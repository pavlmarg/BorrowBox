import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { OfferViewResponse } from '../../api/models';
import { EurPipe } from '../../shared/format/eur.pipe';
import { AthensPipe } from './athens-time';

/** OPEN until it expires, whatever the last push said. */
export function offerState(
  offer: OfferViewResponse,
  now = Date.now(),
): OfferViewResponse['status'] {
  return offer.status === 'OPEN' && Date.parse(offer.expiresAt) <= now
    ? 'EXPIRED'
    : offer.status;
}

/**
 * A price offer in the thread (ADR-0018): set apart by a rule on its left,
 * not a panel. Period, rent (with the list price when lower), deposit,
 * what the renter would pay and until when it's valid. The renter books
 * it, the lender withdraws it.
 */
@Component({
  selector: 'bb-offer-card',
  imports: [
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    EurPipe,
    AthensPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="offer" [class.open]="state() === 'OPEN'" *transloco="let t">
      <p class="label">
        {{ t(mine() ? 'offers.yourOffer' : 'offers.theirOffer') }}
        @if (state() !== 'OPEN') {
          <span class="status">{{ t('offers.status.' + state()) }}</span>
        }
      </p>
      <p class="period">
        {{ offer().start | athens: 'dateTime' }} –
        {{ offer().end | athens: 'dateTime' }}
      </p>
      <dl class="figures">
        <div>
          <dt>{{ t('offers.rent') }}</dt>
          <dd>
            @if (offer().listRentCents > offer().rentCents) {
              <s class="list">{{ offer().listRentCents | eur }}</s>
            }
            {{ offer().rentCents | eur }}
          </dd>
        </div>
        <div>
          <dt>{{ t('offers.deposit') }}</dt>
          <dd>{{ offer().depositCents | eur }}</dd>
        </div>
        @if (!mine()) {
          <div>
            <dt>{{ t('offers.fee') }}</dt>
            <dd>{{ offer().feeCents | eur }}</dd>
          </div>
          <div class="total">
            <dt>{{ t('offers.total') }}</dt>
            <dd>{{ offer().totalCents | eur }}</dd>
          </div>
        }
      </dl>
      @if (state() === 'OPEN') {
        <p class="valid">
          {{ t('offers.validUntil', { time: (offer().expiresAt | athens) }) }}
        </p>
        @if (!closed()) {
          <div class="actions">
            @if (mine()) {
              <button
                type="button"
                class="bb-text-action action"
                [disabled]="busy()"
                (click)="withdraw.emit()"
              >
                {{ t('offers.withdraw') }}
              </button>
            } @else {
              <button
                mat-flat-button
                type="button"
                [disabled]="busy()"
                (click)="book.emit()"
              >
                {{ t('offers.book') }}
              </button>
            }
          </div>
        }
      } @else if (state() === 'USED' && offer().bookingId) {
        <a class="booking" [routerLink]="['/bookings', offer().bookingId]">{{
          t('offers.viewBooking')
        }}</a>
      }
    </div>
  `,
  styles: `
    .offer {
      border-left: 3px solid var(--mat-sys-outline-variant);
      padding: 4px 0 4px 16px;
    }
    .offer.open {
      border-left-color: var(--mat-sys-primary);
    }
    p {
      margin: 0;
    }
    .label {
      color: var(--bb-sky-700);
      font: var(--mat-sys-label-large);
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }
    .status {
      color: var(--mat-sys-on-surface-variant);
      margin-left: 8px;
    }
    .period {
      font: var(--mat-sys-title-medium);
      margin-top: 4px;
    }
    .figures {
      margin: 8px 0 0;
      max-width: 320px;
    }
    .figures div {
      display: flex;
      gap: 16px;
      justify-content: space-between;
      padding: 2px 0;
    }
    .figures dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .figures dd {
      margin: 0;
    }
    .figures .total {
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 700;
      margin-top: 4px;
      padding-top: 6px;
    }
    .list {
      color: var(--mat-sys-on-surface-variant);
      margin-right: 6px;
    }
    .valid {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin-top: 8px;
    }
    .actions {
      margin-top: 12px;
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
    .booking {
      display: inline-block;
      margin-top: 8px;
    }
  `,
})
export class OfferCard {
  readonly offer = input.required<OfferViewResponse>();
  /** The reader is the lender who made it. */
  readonly mine = input.required<boolean>();
  readonly closed = input(false);
  readonly busy = input(false);
  readonly book = output<void>();
  readonly withdraw = output<void>();

  protected readonly state = computed(() => offerState(this.offer()));
}
