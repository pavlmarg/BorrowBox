import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { BookingStatus } from '../../api/models';
import { statusTone } from './booking-text';

/** A booking's status as a small square label, coloured by what it means. */
@Component({
  selector: 'bb-status-chip',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="chip" [attr.data-tone]="tone()" *transloco="let t">{{
      t('bookings.status.' + status())
    }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .chip {
      font: var(--mat-sys-label-medium);
      font-weight: 700;
      letter-spacing: 0.4px;
      padding: 3px 8px;
      white-space: nowrap;
    }
    [data-tone='waiting'] {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    [data-tone='good'] {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    [data-tone='closed'] {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    [data-tone='alert'] {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
  `,
})
export class StatusChip {
  readonly status = input.required<BookingStatus>();
  protected readonly tone = computed(() => statusTone(this.status()));
}
