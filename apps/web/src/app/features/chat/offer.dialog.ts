import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Api } from '../../api/api';
import { itemBookingsControllerQuote } from '../../api/functions';
import type { QuoteResponse } from '../../api/models';
import { CentsInput, centsRange } from '../../shared/format/cents-input';
import { EurPipe } from '../../shared/format/eur.pipe';
import { chatError, type ChatError } from './chat-errors';
import { PeriodPicker, type Period } from './period-picker';

export interface OfferDialogData {
  itemId: string;
  /** Sending replaces it (one open offer per conversation). */
  hasOpenOffer: boolean;
  /** Sends the offer; resolves with the error, or null once sent. */
  send(
    start: string,
    end: string,
    rentCents: number,
  ): Promise<ChatError | null>;
}

/**
 * The lender's price offer (ADR-0018): a period and a rent of at most what
 * the rate card charges for it (shown from the quote); the deposit is the
 * item's. Closes with true once sent.
 */
@Component({
  selector: 'bb-offer-dialog',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    CentsInput,
    EurPipe,
    PeriodPicker,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('offers.makeTitle') }}</h2>
      <mat-dialog-content class="stack">
        <p class="muted">{{ t('offers.makeIntro') }}</p>
        <bb-period-picker (periodChange)="setPeriod($event)" />

        <div aria-live="polite">
          @if (quoting()) {
            <p class="muted">{{ t('offers.quoting') }}</p>
          } @else if (quote(); as q) {
            <dl class="figures">
              <div>
                <dt>{{ t('offers.listRent') }}</dt>
                <dd>{{ q.rentCents | eur }}</dd>
              </div>
              <div>
                <dt>{{ t('offers.depositUnchanged') }}</dt>
                <dd>{{ q.depositCents | eur }}</dd>
              </div>
            </dl>
          } @else if (quoteError(); as key) {
            <p class="error">{{ t(key) }}</p>
          }
        </div>

        @if (quote(); as q) {
          <mat-form-field>
            <mat-label>{{ t('offers.yourRent') }}</mat-label>
            <input matInput bbCentsInput [formControl]="rent" />
            <span matTextSuffix>€</span>
            <mat-hint>{{
              t('offers.rentHint', { max: (q.rentCents | eur) })
            }}</mat-hint>
            @if (rent.hasError('required')) {
              <mat-error>{{ t('offers.rentRequired') }}</mat-error>
            } @else if (rent.hasError('euros')) {
              <mat-error>{{ t('offers.rentUnreadable') }}</mat-error>
            } @else if (rent.hasError('centsRange')) {
              <mat-error>{{
                t('offers.rentTooHigh', { max: (q.rentCents | eur) })
              }}</mat-error>
            }
          </mat-form-field>
        }

        <p class="muted small">{{ t('offers.validity') }}</p>
        @if (data.hasOpenOffer) {
          <p class="muted small">{{ t('offers.replaces') }}</p>
        }

        @if (error(); as e) {
          <p class="error" role="alert">
            {{ t(e.key) }}
            @if (e.code === 'PAYOUTS_NOT_SET_UP') {
              <a routerLink="/settings/payouts" mat-dialog-close>{{
                t('offers.setUpPayouts')
              }}</a>
            }
          </p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>
          {{ t('offers.cancel') }}
        </button>
        <button
          mat-flat-button
          type="button"
          [disabled]="!period() || !quote() || sending()"
          (click)="submit()"
        >
          {{ t('offers.send') }}
        </button>
      </mat-dialog-actions>
    </ng-container>
  `,
  styles: `
    .muted {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .figures {
      margin: 0;
    }
    .figures div {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
    }
    .figures dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .figures dd {
      font-weight: 700;
      margin: 0;
    }
    .error {
      color: var(--mat-sys-error);
      margin: 0;
    }
    .error a {
      margin-left: 6px;
    }
  `,
})
export class OfferDialog {
  protected readonly data = inject<OfferDialogData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<OfferDialog, boolean>>(MatDialogRef);
  private readonly api = inject(Api);

  protected readonly period = signal<Period | null>(null);
  protected readonly quote = signal<QuoteResponse | null>(null);
  protected readonly quoting = signal(false);
  protected readonly quoteError = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly error = signal<ChatError | null>(null);

  protected readonly rent = new FormControl<number | null>(null, [
    Validators.required,
  ]);
  private readonly rentTouched = toSignal(this.rent.valueChanges);
  private quoteSeq = 0;

  protected async setPeriod(period: Period | null): Promise<void> {
    this.period.set(period);
    this.quote.set(null);
    this.quoteError.set(null);
    this.error.set(null);
    const seq = ++this.quoteSeq;
    if (!period) {
      this.quoting.set(false);
      return;
    }
    this.quoting.set(true);
    try {
      const quote = await this.api.invoke(itemBookingsControllerQuote, {
        itemId: this.data.itemId,
        ...period,
      });
      if (seq !== this.quoteSeq) return;
      this.rent.setValidators([
        Validators.required,
        centsRange(0, quote.rentCents),
      ]);
      // Start from the list price, unless the lender already typed one.
      if (this.rentTouched() === undefined) {
        this.rent.setValue(quote.rentCents, { emitEvent: false });
      }
      this.rent.updateValueAndValidity({ emitEvent: false });
      this.quote.set(quote);
    } catch (err) {
      if (seq === this.quoteSeq) this.quoteError.set(chatError(err).key);
    } finally {
      if (seq === this.quoteSeq) this.quoting.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const period = this.period();
    this.rent.markAsTouched();
    if (!period || !this.quote() || this.rent.invalid) return;
    this.sending.set(true);
    this.error.set(null);
    const error = await this.data.send(
      period.start,
      period.end,
      this.rent.value ?? 0,
    );
    this.sending.set(false);
    if (error) {
      this.error.set(error);
    } else {
      this.ref.close(true);
    }
  }
}
