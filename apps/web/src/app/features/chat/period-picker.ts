import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DateAdapter, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  BOOKING_MAX_AHEAD_DAYS,
  BOOKING_MAX_HOURS,
  BOOKING_MIN_LEAD_HOURS,
} from '@borrowbox/contracts';
import { LanguageService } from '../../core/i18n/language';
import { athensParts, athensToUtc } from './athens-time';

const HOUR_MS = 3_600_000;

/** A booking period, as the API takes it. */
export interface Period {
  start: string;
  end: string;
}

export type PeriodProblem = 'order' | 'tooSoon' | 'tooFar' | 'tooLong';

/** Whole hours `[start, end)`, ADR-0015's limits; null if it's fine. */
export function periodProblem(
  start: Date,
  end: Date,
  now = Date.now(),
): PeriodProblem | null {
  if (end.getTime() <= start.getTime()) return 'order';
  if (start.getTime() < now + BOOKING_MIN_LEAD_HOURS * HOUR_MS) {
    return 'tooSoon';
  }
  if (start.getTime() > now + BOOKING_MAX_AHEAD_DAYS * 24 * HOUR_MS) {
    return 'tooFar';
  }
  if (end.getTime() - start.getTime() > BOOKING_MAX_HOURS * HOUR_MS) {
    return 'tooLong';
  }
  return null;
}

/** The picked calendar day (the datepicker's local midnight) at an Athens hour. */
function at(day: Date, hour: number): Date {
  return athensToUtc({
    year: day.getFullYear(),
    month: day.getMonth() + 1,
    day: day.getDate(),
    hour,
  });
}

/** Today in Athens, as the datepicker's local midnight. */
function athensToday(): Date {
  const p = athensParts(new Date());
  return new Date(p.year, p.month - 1, p.day);
}

/**
 * A booking period: a start and an end day (Material datepicker) and hour,
 * in Athens time, whole hours. Emits the period once it's valid, null
 * otherwise. Chat's own picker (offers); the item page's booking panel has
 * a similar one, to be unified later.
 */
@Component({
  selector: 'bb-period-picker',
  imports: [
    FormsModule,
    TranslocoDirective,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  providers: [provideNativeDateAdapter()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="picker" *transloco="let t">
      <legend class="legend">{{ t('offers.period') }}</legend>
      @for (side of sides; track side) {
        <div class="row">
          <mat-form-field class="day">
            <mat-label>{{ t('offers.' + side + 'Day') }}</mat-label>
            <input
              matInput
              readonly
              [matDatepicker]="picker"
              [min]="minDay"
              [max]="maxDay"
              [ngModel]="side === 'start' ? startDay() : endDay()"
              (ngModelChange)="setDay(side, $event)"
              (click)="picker.open()"
            />
            <mat-datepicker-toggle matIconSuffix [for]="picker" />
            <mat-datepicker #picker />
          </mat-form-field>
          <mat-form-field class="hour">
            <mat-label>{{ t('offers.' + side + 'Hour') }}</mat-label>
            <mat-select
              [ngModel]="side === 'start' ? startHour() : endHour()"
              (ngModelChange)="setHour(side, $event)"
            >
              @for (h of hours; track h) {
                <mat-option [value]="h">{{ label(h) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      }
      <p class="hint">{{ t('offers.athensTime') }}</p>
      @if (problem(); as p) {
        <p class="problem" role="alert">{{ t('offers.problems.' + p) }}</p>
      }
    </fieldset>
  `,
  styles: `
    .picker {
      border: 0;
      margin: 0;
      min-width: 0;
      padding: 0;
    }
    .legend {
      font: var(--mat-sys-title-small);
      margin: 0 0 8px;
      padding: 0;
    }
    .row {
      display: flex;
      gap: 12px;
    }
    .day {
      flex: 1;
      min-width: 0;
    }
    .hour {
      flex: none;
      width: 112px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: -8px 0 0;
    }
    .problem {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
      margin: 6px 0 0;
    }
  `,
})
export class PeriodPicker {
  /** The period once valid, else null. */
  readonly periodChange = output<Period | null>();

  private readonly adapter = inject<DateAdapter<Date>>(DateAdapter);

  protected readonly sides = ['start', 'end'] as const;
  protected readonly hours = Array.from({ length: 24 }, (_, h) => h);
  protected readonly minDay = athensToday();
  protected readonly maxDay = new Date(
    this.minDay.getFullYear(),
    this.minDay.getMonth(),
    this.minDay.getDate() + BOOKING_MAX_AHEAD_DAYS,
  );

  protected readonly startDay = signal<Date | null>(null);
  protected readonly startHour = signal(10);
  protected readonly endDay = signal<Date | null>(null);
  protected readonly endHour = signal(18);

  private readonly range = computed(() => {
    const startDay = this.startDay();
    const endDay = this.endDay();
    if (!startDay || !endDay) return null;
    return {
      start: at(startDay, this.startHour()),
      end: at(endDay, this.endHour()),
    };
  });
  protected readonly problem = computed(() => {
    const range = this.range();
    return range ? periodProblem(range.start, range.end) : null;
  });

  constructor() {
    const language = inject(LanguageService);
    effect(() => this.adapter.setLocale(language.formatLocale()));
    effect(() => {
      const range = this.range();
      this.periodChange.emit(
        range && !this.problem()
          ? { start: range.start.toISOString(), end: range.end.toISOString() }
          : null,
      );
    });
  }

  protected setDay(side: 'start' | 'end', day: Date | null): void {
    if (side === 'start') {
      this.startDay.set(day);
      // A natural default: the end on the same day, unless already set.
      if (day && !this.endDay()) this.endDay.set(day);
    } else {
      this.endDay.set(day);
    }
  }

  protected setHour(side: 'start' | 'end', hour: number): void {
    (side === 'start' ? this.startHour : this.endHour).set(hour);
  }

  protected label(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }
}
