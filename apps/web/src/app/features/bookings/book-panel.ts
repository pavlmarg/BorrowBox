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
  type OnInit,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { DateAdapter, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PublicItemDetailResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { LanguageService } from '../../core/i18n/language';
import {
  athensInstant,
  athensParts,
  dayFromPicker,
  dayToPicker,
  hourLabel,
  type CalendarDay,
} from '../../shared/format/athens';
import { EurPipe } from '../../shared/format/eur.pipe';
import { AthensPeriodPipe } from './athens.pipes';
import { BookStore, type PeriodChoice } from './book.store';
import { bookingErrorKey, durationParts, unitParts } from './booking-text';
import {
  dayFullyUnavailable,
  dayWithin,
  endDayRange,
  endHourOptions,
  limitsFor,
  periodProblem,
  startDayRange,
  startHourOptions,
  suggestedEnd,
} from './period-rules';

/** How many held periods to list under the picker. */
const BUSY_SHOWN = 5;
/** The hour offered first when a start day is picked. */
const PREFERRED_START_HOUR = 10;

/**
 * The booking part of an item page (ADR-0015): pick a period in Athens
 * time, see what it costs, and request it. Held periods can't be picked.
 * Signed-out visitors can look and price, then sign in and come back with
 * the same period.
 */
@Component({
  selector: 'bb-book-panel',
  imports: [
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatDatepickerModule,
    MatInputModule,
    MatSelectModule,
    EurPipe,
    AthensPeriodPipe,
  ],
  providers: [BookStore, provideNativeDateAdapter()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="book" aria-labelledby="book-title" *transloco="let t">
      <h2 id="book-title">{{ t('bookings.book.title') }}</h2>

      <fieldset class="when">
        <legend>{{ t('bookings.book.from') }}</legend>
        <mat-form-field class="date">
          <mat-label>{{ t('bookings.book.date') }}</mat-label>
          <input
            matInput
            [matDatepicker]="startPicker"
            [value]="pickerValue(startDay())"
            [min]="pickerValue(startRange().min)"
            [max]="pickerValue(startRange().max)"
            [matDatepickerFilter]="startFilter"
            (dateChange)="onStartDate($event.value)"
          />
          <mat-datepicker-toggle matIconSuffix [for]="startPicker" />
          <mat-datepicker #startPicker />
        </mat-form-field>
        <mat-form-field class="hour">
          <mat-label>{{ t('bookings.book.time') }}</mat-label>
          <mat-select
            [value]="startHour()"
            [disabled]="!startDay()"
            (selectionChange)="onStartHour($event.value)"
          >
            @for (o of startOptions(); track o.hour) {
              <mat-option [value]="o.hour" [disabled]="o.disabled">{{
                label(o.hour)
              }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </fieldset>

      <fieldset class="when">
        <legend>{{ t('bookings.book.until') }}</legend>
        <mat-form-field class="date">
          <mat-label>{{ t('bookings.book.date') }}</mat-label>
          <input
            matInput
            [matDatepicker]="endPicker"
            [disabled]="!start()"
            [value]="pickerValue(endDay())"
            [min]="pickerValue(endRange()?.min ?? null)"
            [max]="pickerValue(endRange()?.max ?? null)"
            (dateChange)="onEndDate($event.value)"
          />
          <mat-datepicker-toggle matIconSuffix [for]="endPicker" />
          <mat-datepicker #endPicker />
        </mat-form-field>
        <mat-form-field class="hour">
          <mat-label>{{ t('bookings.book.time') }}</mat-label>
          <mat-select
            [value]="endHour()"
            [disabled]="!endDay()"
            (selectionChange)="onEndHour($event.value)"
          >
            @for (o of endOptions(); track o.hour) {
              <mat-option [value]="o.hour" [disabled]="o.disabled">{{
                label(o.hour)
              }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </fieldset>

      <p class="hint">
        {{ t('bookings.book.athensTime') }}
        @if (item().minRentalHours || item().maxRentalHours) {
          <span class="limits">
            @if (item().minRentalHours; as min) {
              {{ t('bookings.book.shortest') }}
              @for (p of duration(min); track p.key) {
                {{ t(p.key, { n: p.n }) }}
              }
              .
            }
            @if (item().maxRentalHours; as max) {
              {{ t('bookings.book.longest') }}
              @for (p of duration(max); track p.key) {
                {{ t(p.key, { n: p.n }) }}
              }
              .
            }
          </span>
        }
      </p>

      @if (busyShown().length > 0) {
        <div class="busy">
          <p class="busy-title">{{ t('bookings.book.taken') }}</p>
          <ul>
            @for (b of busyShown(); track b.start) {
              <li>{{ b | athensPeriod }}</li>
            }
          </ul>
          @if (busyMore() > 0) {
            <p class="hint">
              {{ t('bookings.book.takenMore', { count: busyMore() }) }}
            </p>
          }
        </div>
      }

      <div class="status" aria-live="polite">
        @if (problem(); as p) {
          <p class="problem">{{ t('bookings.book.problem.' + p) }}</p>
        } @else if (period()) {
          @switch (store.quoteStatus()) {
            @case ('loading') {
              <p class="hint">{{ t('bookings.book.pricing') }}</p>
            }
            @case ('error') {
              <p class="problem">
                {{ t(errorKey(store.quoteError() ?? 'INTERNAL')) }}
              </p>
            }
            @case ('ready') {
              @if (store.quote(); as q) {
                @if (q.totalCents === 0) {
                  <p class="free">{{ t('bookings.book.nothingToPay') }}</p>
                } @else {
                  <dl class="amounts">
                    <div class="line">
                      <dt>
                        {{ t('bookings.price.rent') }}
                        <span class="units">
                          @for (
                            u of units(q.units);
                            track u.key;
                            let last = $last
                          ) {
                            {{ t(u.key, { n: u.n }) }}{{ last ? '' : ' + ' }}
                          }
                        </span>
                      </dt>
                      <dd>
                        {{
                          q.rentCents > 0
                            ? (q.rentCents | eur)
                            : t('catalog.free')
                        }}
                      </dd>
                    </div>
                    <div class="line">
                      <dt>{{ t('bookings.price.fee') }}</dt>
                      <dd>{{ q.feeCents | eur }}</dd>
                    </div>
                    @if (q.depositCents > 0) {
                      <div class="line">
                        <dt>{{ t('bookings.price.deposit') }}</dt>
                        <dd>{{ q.depositCents | eur }}</dd>
                      </div>
                    }
                    <div class="line total">
                      <dt>{{ t('bookings.price.total') }}</dt>
                      <dd>{{ q.totalCents | eur }}</dd>
                    </div>
                  </dl>
                  @if (q.depositCents > 0) {
                    <p class="hint">
                      {{
                        t('bookings.book.depositExplained', {
                          deposit: (q.depositCents | eur),
                        })
                      }}
                    </p>
                  }
                  <p class="hint">{{ t('bookings.book.payLater') }}</p>
                }
              }
            }
          }
        } @else {
          <p class="hint">{{ t('bookings.book.pick') }}</p>
        }
      </div>

      @if (signedIn()) {
        <button
          mat-flat-button
          type="button"
          class="cta"
          [disabled]="!canRequest()"
          (click)="request()"
        >
          {{
            store.requesting()
              ? t('bookings.book.sending')
              : t('bookings.book.request')
          }}
        </button>
      } @else {
        <a
          mat-flat-button
          class="cta"
          routerLink="/auth/login"
          [queryParams]="{ returnUrl: returnUrl() }"
          >{{ t('bookings.book.signIn') }}</a
        >
      }

      <div aria-live="assertive">
        @if (store.requestError(); as code) {
          <p class="problem" role="alert">
            {{ t(errorKey(code)) }}
            @switch (code) {
              @case ('EMAIL_NOT_VERIFIED') {
                <a class="bb-text-action" routerLink="/settings">{{
                  t('bookings.book.toSettings')
                }}</a>
              }
              @case ('DUPLICATE_REQUEST') {
                <a class="bb-text-action" routerLink="/bookings">{{
                  t('bookings.book.toBookings')
                }}</a>
              }
              @case ('REQUEST_LIMIT_REACHED') {
                <a class="bb-text-action" routerLink="/bookings">{{
                  t('bookings.book.toBookings')
                }}</a>
              }
            }
          </p>
        }
      </div>
    </section>
  `,
  styles: `
    .book {
      border-top: 1px solid var(--mat-sys-outline-variant);
      margin-top: 20px;
      padding-top: 16px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
      margin: 0 0 12px;
    }
    .when {
      border: 0;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) 104px;
      margin: 0;
      padding: 0;
    }
    legend {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
      margin-bottom: 6px;
      padding: 0;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 0 0 8px;
    }
    .limits {
      display: block;
    }
    .busy {
      margin: 8px 0;
    }
    .busy-title {
      font: var(--mat-sys-label-large);
      margin: 0 0 4px;
    }
    .busy ul {
      font: var(--mat-sys-body-small);
      margin: 0 0 4px;
      padding-left: 18px;
    }
    .status {
      min-height: 24px;
    }
    .problem {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-medium);
      margin: 8px 0;
    }
    .problem a {
      color: inherit;
      font-weight: 700;
      margin-left: 6px;
    }
    .free {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
      margin: 8px 0;
    }
    .amounts {
      margin: 8px 0;
    }
    .line {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 6px 0;
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
    .cta {
      margin-top: 12px;
      width: 100%;
    }
  `,
})
export class BookPanel implements OnInit {
  readonly item = input.required<PublicItemDetailResponse>();
  /** A period to start with (`?start=&end=`, e.g. back from signing in). */
  readonly initialStart = input<string | undefined>();
  readonly initialEnd = input<string | undefined>();

  protected readonly store = inject(BookStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly language = inject(LanguageService);
  private readonly dateAdapter = inject<DateAdapter<Date>>(DateAdapter);

  /** Re-read every minute, so hours that just became too soon close. */
  protected readonly now = signal(new Date());

  protected readonly startDay = signal<CalendarDay | null>(null);
  protected readonly startHour = signal<number | null>(null);
  protected readonly endDay = signal<CalendarDay | null>(null);
  protected readonly endHour = signal<number | null>(null);

  protected readonly signedIn = computed(() => this.auth.isAuthenticated());
  protected readonly limits = computed(() => limitsFor(this.item()));
  private readonly hourly = computed(
    () => this.item().pricing.hourlyCents !== undefined,
  );

  protected readonly start = computed(() => {
    const day = this.startDay();
    const hour = this.startHour();
    return day && hour !== null ? athensInstant(day, hour) : null;
  });
  protected readonly end = computed(() => {
    const day = this.endDay();
    const hour = this.endHour();
    return day && hour !== null ? athensInstant(day, hour) : null;
  });

  protected readonly startRange = computed(() => startDayRange(this.now()));
  protected readonly endRange = computed(() => {
    const start = this.start();
    return start ? endDayRange(start, this.limits()) : null;
  });
  protected readonly startOptions = computed(() => {
    const day = this.startDay();
    return day ? startHourOptions(day, this.now(), this.store.busy()) : [];
  });
  protected readonly endOptions = computed(() => {
    const day = this.endDay();
    const start = this.start();
    return day && start
      ? endHourOptions(day, start, this.now(), this.limits(), this.store.busy())
      : [];
  });

  protected readonly problem = computed(() => {
    const start = this.start();
    const end = this.end();
    if (!start || !end) return null;
    return periodProblem(
      start,
      end,
      this.now(),
      this.limits(),
      this.store.busy(),
    );
  });
  /** The chosen period once it's complete and valid. */
  protected readonly period = computed<PeriodChoice | null>(
    () => {
      const start = this.start();
      const end = this.end();
      return start && end && this.problem() === null ? { start, end } : null;
    },
    {
      equal: (a, b) =>
        a?.start.getTime() === b?.start.getTime() &&
        a?.end.getTime() === b?.end.getTime(),
    },
  );
  protected readonly canRequest = computed(
    () =>
      this.period() !== null &&
      this.store.quoteStatus() === 'ready' &&
      !this.store.requesting(),
  );

  protected readonly busyShown = computed(() =>
    this.store
      .busy()
      .slice(0, BUSY_SHOWN)
      .map((b) => ({
        start: new Date(b.start).toISOString(),
        end: new Date(b.end).toISOString(),
      })),
  );
  protected readonly busyMore = computed(() =>
    Math.max(0, this.store.busy().length - BUSY_SHOWN),
  );

  protected readonly returnUrl = computed(() => {
    const path = `/items/${this.item().id}`;
    const period = this.period();
    if (!period) return path;
    const query = new URLSearchParams({
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    });
    return `${path}?${query.toString()}`;
  });

  protected readonly label = hourLabel;
  protected readonly units = unitParts;
  protected readonly duration = durationParts;
  protected readonly errorKey = bookingErrorKey;

  /** Days nobody could start on are greyed out in the calendar. */
  protected readonly startFilter = (date: Date | null): boolean =>
    date === null ||
    !dayFullyUnavailable(dayFromPicker(date), this.now(), this.store.busy());

  constructor() {
    effect(() => this.dateAdapter.setLocale(this.language.formatLocale()));
    effect(() => {
      const period = this.period();
      untracked(() => this.store.choose(this.item().id, period));
    });
    const timer = setInterval(() => this.now.set(new Date()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit(): void {
    void this.store.loadBusy(this.item().id);
    this.prefill(this.initialStart(), this.initialEnd());
  }

  protected pickerValue(day: CalendarDay | null): Date | null {
    return day ? dayToPicker(day) : null;
  }

  protected onStartDate(date: Date | null): void {
    if (!date) {
      this.startDay.set(null);
      return;
    }
    this.startDay.set(dayFromPicker(date));
    const options = this.startOptions().filter((o) => !o.disabled);
    const keep = options.find((o) => o.hour === this.startHour());
    const preferred = options.find((o) => o.hour === PREFERRED_START_HOUR);
    this.startHour.set((keep ?? preferred ?? options[0])?.hour ?? null);
    this.fitEnd();
  }

  protected onStartHour(hour: number): void {
    this.startHour.set(hour);
    this.fitEnd();
  }

  protected onEndDate(date: Date | null): void {
    if (!date) {
      this.endDay.set(null);
      return;
    }
    this.endDay.set(dayFromPicker(date));
    const options = this.endOptions().filter((o) => !o.disabled);
    const keep = options.find((o) => o.hour === this.endHour());
    const sameAsStart = options.find((o) => o.hour === this.startHour());
    this.endHour.set((keep ?? sameAsStart ?? options[0])?.hour ?? null);
  }

  protected onEndHour(hour: number): void {
    this.endHour.set(hour);
  }

  protected async request(): Promise<void> {
    const period = this.period();
    if (!period) return;
    const booking = await this.store.request(this.item().id, period);
    if (booking) await this.router.navigate(['/bookings', booking.id]);
  }

  /** After the start moves: keep the end if it still works, else suggest one. */
  private fitEnd(): void {
    const start = this.start();
    if (!start) return;
    if (this.end() && this.problem() === null) return;
    const end = suggestedEnd(
      start,
      this.hourly(),
      this.now(),
      this.limits(),
      this.store.busy(),
    );
    this.setEnd(end);
  }

  private setEnd(end: Date | null): void {
    if (!end) {
      this.endDay.set(null);
      this.endHour.set(null);
      return;
    }
    const p = athensParts(end);
    this.endDay.set({ year: p.year, month: p.month, day: p.day });
    this.endHour.set(p.hour);
  }

  private prefill(start: string | undefined, end: string | undefined): void {
    const s = start ? new Date(start) : null;
    const e = end ? new Date(end) : null;
    if (!s || Number.isNaN(s.getTime())) return;
    const sp = athensParts(s);
    const day = { year: sp.year, month: sp.month, day: sp.day };
    if (!dayWithin(day, this.startRange())) return;
    this.startDay.set(day);
    this.startHour.set(sp.hour);
    if (e && !Number.isNaN(e.getTime())) this.setEnd(e);
    else this.fitEnd();
  }
}
