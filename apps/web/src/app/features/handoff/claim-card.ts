import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  CLAIM_DESCRIPTION_MAX_LENGTH,
  CLAIM_DESCRIPTION_MIN_LENGTH,
  CLAIM_MIN_CENTS,
  CLAIM_PHOTOS_MAX,
  CLAIM_REPLY_MAX_LENGTH,
  claimTextProblem,
} from '@borrowbox/contracts';
import type {
  BookingViewResponse,
  ClaimAnswer,
  ConditionPhotoResponse,
} from '../../api/models';
import { LanguageService } from '../../core/i18n/language';
import { openConfirm } from '../../shared/confirm-dialog';
import { EurPipe } from '../../shared/format/eur.pipe';
import { formatCents } from '../../shared/format/money';
import { AthensTimePipe } from '../bookings/athens.pipes';
import {
  bookingErrorKey,
  otherParty,
  type AnyBookingError,
} from '../bookings/booking-text';
import { parseEuroCents } from './claim-amount';
import { ClaimStore } from './claim.store';
import { ConditionPhotosStore } from './condition-photos.store';
import { canFileClaim } from './handoff-rules';

export type AmountProblem = 'invalid' | 'tooLow' | 'tooHigh';

/** What's wrong with a typed claim amount, given the booking's deposit. */
export function amountProblem(
  text: string,
  depositCents: number,
): AmountProblem | null {
  const cents = parseEuroCents(text);
  if (cents === null) return 'invalid';
  if (cents < CLAIM_MIN_CENTS) return 'tooLow';
  if (cents > depositCents) return 'tooHigh';
  return null;
}

/**
 * The booking page's damage claim (ADR-0028). The lender reports damage
 * within the claim window (an amount up to the deposit, a description,
 * photos); the renter agrees or disagrees; the lender may withdraw. Once
 * resolved it shows where the deposit went.
 */
@Component({
  selector: 'bb-claim-card',
  imports: [TranslocoDirective, MatButtonModule, EurPipe, AthensTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="card" *transloco="let t">
        <h2>{{ t('claims.title') }}</h2>

        @if (claims.claim(); as c) {
          <dl class="amounts">
            <div class="line">
              <dt>{{ t('claims.claimed') }}</dt>
              <dd>
                {{
                  t('claims.ofDeposit', {
                    amount: (c.amountCents | eur),
                    deposit: (booking().price.depositCents | eur),
                  })
                }}
              </dd>
            </div>
            <div class="line">
              <dt>{{ t('claims.filed') }}</dt>
              <dd>{{ c.filedAt | athensTime }}</dd>
            </div>
          </dl>
          <p class="text">{{ c.description }}</p>
          @if (claimPhotos().length) {
            <ul class="thumbs">
              @for (p of claimPhotos(); track p.id) {
                @if (p.urls; as urls) {
                  <li>
                    <a
                      [href]="urls.large"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img [src]="urls.thumb" [alt]="t('claims.photoAlt')" />
                    </a>
                  </li>
                }
              }
            </ul>
          }
          @if (c.reply) {
            <h3>{{ t('claims.reply') }}</h3>
            <p class="text">{{ c.reply }}</p>
          }

          <p class="status" role="status">
            @switch (c.status) {
              @case ('OPEN') {
                {{
                  t('claims.status.OPEN.' + booking().role, { name: name() })
                }}
              }
              @case ('DISAGREED') {
                {{
                  t('claims.status.DISAGREED.' + booking().role, {
                    name: name(),
                  })
                }}
              }
              @default {
                {{ t('claims.status.' + c.status) }}
                {{
                  t('claims.outcome', {
                    award: (c.awardCents ?? 0 | eur),
                    back:
                      (booking().price.depositCents - (c.awardCents ?? 0)
                      | eur),
                  })
                }}
              }
            }
          </p>

          @if (c.status === 'OPEN' && booking().role === 'RENTER') {
            <label class="label" for="claim-reply">{{
              t('claims.replyLabel')
            }}</label>
            <textarea
              id="claim-reply"
              rows="3"
              [maxLength]="replyMax"
              [value]="reply()"
              (input)="reply.set($any($event.target).value)"
            ></textarea>
            <p class="counter">{{ reply().length }} / {{ replyMax }}</p>
            @if (replyProblem(); as p) {
              <p class="problem">{{ t('claims.text.' + p) }}</p>
            }
            <div class="buttons">
              <button
                mat-flat-button
                type="button"
                [disabled]="claims.acting() !== null || !!replyProblem()"
                (click)="answer('AGREE')"
              >
                {{ t('claims.agree') }}
              </button>
              <button
                mat-stroked-button
                type="button"
                [disabled]="claims.acting() !== null || !!replyProblem()"
                (click)="answer('DISAGREE')"
              >
                {{ t('claims.disagree') }}
              </button>
            </div>
          }
          @if (
            (c.status === 'OPEN' || c.status === 'DISAGREED') &&
            booking().role === 'LENDER'
          ) {
            <div class="buttons">
              <button
                mat-stroked-button
                type="button"
                [disabled]="claims.acting() !== null"
                (click)="withdraw()"
              >
                {{ t('claims.withdraw') }}
              </button>
            </div>
          }
        } @else if (!formOpen()) {
          <p>
            {{
              t('claims.canFile', {
                time: (booking().handoff.claimUntil | athensTime),
                deposit: (booking().price.depositCents | eur),
              })
            }}
          </p>
          <button mat-stroked-button type="button" (click)="formOpen.set(true)">
            {{ t('claims.report') }}
          </button>
        } @else {
          <form class="form" (submit)="$event.preventDefault(); file()">
            <label class="label" for="claim-amount">{{
              t('claims.amountLabel')
            }}</label>
            <input
              id="claim-amount"
              class="amount"
              inputmode="decimal"
              autocomplete="off"
              [value]="amount()"
              (input)="amount.set($any($event.target).value)"
            />
            <p class="counter">
              {{
                t('claims.amountHint', {
                  deposit: (booking().price.depositCents | eur),
                })
              }}
            </p>
            @if (tried() && amountIssue(); as p) {
              <p class="problem">
                {{
                  t('claims.amount.' + p, {
                    deposit: (booking().price.depositCents | eur),
                  })
                }}
              </p>
            }

            <label class="label" for="claim-description">{{
              t('claims.descriptionLabel')
            }}</label>
            <textarea
              id="claim-description"
              rows="5"
              [maxLength]="descriptionMax"
              [value]="description()"
              (input)="description.set($any($event.target).value)"
            ></textarea>
            <p class="counter">
              {{ description().length }} / {{ descriptionMax }}
            </p>
            @if (descriptionIssue(); as p) {
              @if (tried() || p === 'CONTACT_DETAILS') {
                <p class="problem">{{ t('claims.text.' + p) }}</p>
              }
            }

            @if (readyPhotos().length) {
              <p class="label">
                {{ t('claims.photosLabel', { max: photosMax }) }}
              </p>
              <ul class="thumbs pick">
                @for (p of readyPhotos(); track p.id) {
                  @if (p.urls; as urls) {
                    <li>
                      <label [class.chosen]="chosen().includes(p.id)">
                        <input
                          type="checkbox"
                          [checked]="chosen().includes(p.id)"
                          [disabled]="
                            !chosen().includes(p.id) &&
                            chosen().length >= photosMax
                          "
                          (change)="toggle(p.id)"
                        />
                        <img
                          [src]="urls.thumb"
                          [alt]="t('handoff.photos.alt.' + p.phase)"
                        />
                      </label>
                    </li>
                  }
                }
              </ul>
            } @else {
              <p class="hint">{{ t('claims.noPhotos') }}</p>
            }

            <div class="buttons">
              <button
                mat-flat-button
                type="submit"
                [disabled]="claims.acting() !== null"
              >
                {{ t('claims.submit') }}
              </button>
              <button
                mat-button
                type="button"
                [disabled]="claims.acting() !== null"
                (click)="formOpen.set(false)"
              >
                {{ t('claims.cancelForm') }}
              </button>
            </div>
          </form>
        }

        <div aria-live="assertive">
          @if (failure(); as code) {
            <p class="problem" role="alert">
              {{
                code === 'INVALID_STATE'
                  ? t('bookings.detail.changed')
                  : t(errorKey(code))
              }}
            </p>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .card {
      border-top: 1px solid var(--mat-sys-outline-variant);
      margin-top: 24px;
      padding-top: 20px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
      margin: 0 0 12px;
    }
    h3 {
      font: var(--mat-sys-title-small);
      font-weight: 700;
      margin: 16px 0 4px;
    }
    p {
      margin: 0 0 8px;
    }
    .amounts {
      margin: 0 0 12px;
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
    .line dd {
      font-weight: 600;
      margin: 0;
      text-align: right;
    }
    .text {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .status {
      font: var(--mat-sys-body-large);
      font-weight: 600;
      margin-top: 12px;
    }
    .form {
      display: flex;
      flex-direction: column;
      max-width: 520px;
    }
    .label {
      font: var(--mat-sys-title-small);
      font-weight: 700;
      margin: 12px 0 6px;
    }
    input.amount,
    textarea {
      background: var(--mat-sys-surface-container-lowest);
      border: 1px solid var(--mat-sys-outline);
      border-radius: var(--bb-control-radius, 6px);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-large);
      padding: 10px 12px;
    }
    input.amount {
      max-width: 160px;
    }
    textarea {
      resize: vertical;
      width: 100%;
      box-sizing: border-box;
    }
    input.amount:focus,
    textarea:focus {
      border-color: var(--mat-sys-primary);
      outline: none;
    }
    .counter,
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 4px 0 0;
    }
    .thumbs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      list-style: none;
      margin: 8px 0;
      padding: 0;
    }
    .thumbs img {
      border-radius: var(--bb-radius);
      display: block;
      height: 88px;
      object-fit: cover;
      width: 88px;
    }
    .pick label {
      border: 3px solid transparent;
      border-radius: calc(var(--bb-radius) + 3px);
      cursor: pointer;
      display: block;
      position: relative;
    }
    .pick label.chosen {
      border-color: var(--mat-sys-primary);
    }
    .pick input {
      left: 6px;
      position: absolute;
      top: 6px;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
    }
    .problem {
      color: var(--mat-sys-error);
      margin: 4px 0 0;
    }
  `,
})
export class ClaimCard {
  readonly booking = input.required<BookingViewResponse>();
  readonly now = input.required<number>();
  /** The claim moved the booking (filed, answered, withdrawn): reload it. */
  readonly changed = output<void>();

  protected readonly claims = inject(ClaimStore);
  private readonly photos = inject(ConditionPhotosStore);
  private readonly dialog = inject(MatDialog);
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  protected readonly descriptionMax = CLAIM_DESCRIPTION_MAX_LENGTH;
  protected readonly replyMax = CLAIM_REPLY_MAX_LENGTH;
  protected readonly photosMax = CLAIM_PHOTOS_MAX;
  protected readonly errorKey = bookingErrorKey;

  protected readonly formOpen = signal(false);
  protected readonly amount = signal('');
  protected readonly description = signal('');
  protected readonly chosen = signal<string[]>([]);
  protected readonly reply = signal('');
  /** Problems show once the lender tried to send (contact details at once). */
  protected readonly tried = signal(false);
  protected readonly failure = signal<AnyBookingError | null>(null);

  protected readonly canFile = computed(() =>
    canFileClaim(
      this.booking(),
      this.claims.claim() !== null,
      new Date(this.now()),
    ),
  );
  protected readonly visible = computed(
    () => this.claims.claim() !== null || this.canFile(),
  );
  protected readonly name = computed(
    () =>
      otherParty(this.booking()).displayName ??
      this.transloco.translate('bookings.deletedAccount'),
  );
  protected readonly readyPhotos = computed(() =>
    this.photos.photos().filter((p) => p.status === 'READY'),
  );
  protected readonly claimPhotos = computed((): ConditionPhotoResponse[] => {
    const ids = this.claims.claim()?.photoIds ?? [];
    return this.photos.photos().filter((p) => ids.includes(p.id));
  });
  protected readonly amountIssue = computed(() =>
    amountProblem(this.amount(), this.booking().price.depositCents),
  );
  protected readonly descriptionIssue = computed(() =>
    claimTextProblem(
      this.description(),
      CLAIM_DESCRIPTION_MIN_LENGTH,
      CLAIM_DESCRIPTION_MAX_LENGTH,
    ),
  );
  /** The reply is optional: only its length and contents are checked. */
  protected readonly replyProblem = computed(() =>
    this.reply().trim() === ''
      ? null
      : claimTextProblem(this.reply(), 0, CLAIM_REPLY_MAX_LENGTH),
  );

  protected toggle(photoId: string): void {
    const now = this.chosen();
    this.chosen.set(
      now.includes(photoId)
        ? now.filter((id) => id !== photoId)
        : [...now, photoId].slice(0, CLAIM_PHOTOS_MAX),
    );
  }

  protected async file(): Promise<void> {
    this.tried.set(true);
    const cents = parseEuroCents(this.amount());
    if (this.amountIssue() || this.descriptionIssue() || cents === null) return;
    const ok = await this.confirm('file', {
      amount: this.eur(cents),
      name: this.name(),
    });
    if (!ok) return;
    await this.done(
      this.claims.file(this.booking().id, {
        amountCents: cents,
        description: this.description().trim(),
        ...(this.chosen().length ? { photoIds: this.chosen() } : {}),
      }),
    );
  }

  protected async answer(answer: ClaimAnswer): Promise<void> {
    const claim = this.claims.claim();
    if (!claim || this.replyProblem()) return;
    const ok = await this.confirm(answer === 'AGREE' ? 'agree' : 'disagree', {
      amount: this.eur(claim.amountCents),
      back: this.eur(this.booking().price.depositCents - claim.amountCents),
      name: this.name(),
    });
    if (!ok) return;
    const reply = this.reply().trim();
    await this.done(
      this.claims.answer(this.booking().id, {
        answer,
        ...(reply ? { reply } : {}),
      }),
    );
  }

  protected async withdraw(): Promise<void> {
    if (!(await this.confirm('withdraw', { name: this.name() }))) return;
    await this.done(this.claims.withdraw(this.booking().id));
  }

  private async done(result: Promise<AnyBookingError | null>): Promise<void> {
    this.failure.set(null);
    const code = await result;
    this.failure.set(code);
    if (code === null) {
      this.formOpen.set(false);
      this.changed.emit();
    } else if (code === 'INVALID_STATE' || code === 'CLAIM_EXISTS') {
      this.changed.emit();
    }
  }

  private eur(cents: number): string {
    return formatCents(cents, this.language.formatLocale());
  }

  private confirm(
    kind: 'file' | 'agree' | 'disagree' | 'withdraw',
    params: Record<string, string>,
  ): Promise<boolean> {
    const t = (key: string) => this.transloco.translate(key, params);
    return openConfirm(this.dialog, {
      title: t(`claims.confirm.${kind}.title`),
      message: t(`claims.confirm.${kind}.message`),
      confirm: t(`claims.confirm.${kind}.confirm`),
      cancel: t('claims.confirm.keep'),
      danger: kind === 'withdraw',
    });
  }
}
