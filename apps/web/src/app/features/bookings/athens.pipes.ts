import { Pipe, inject, type PipeTransform } from '@angular/core';
import { LanguageService } from '../../core/i18n/language';
import {
  formatAthensPeriod,
  formatAthensTime,
} from '../../shared/format/athens';

/**
 * Not pure, so they follow a language switch; each keeps its last answer,
 * so a page that re-renders every second (a countdown) formats only once.
 */
abstract class CachedFormat {
  private readonly language = inject(LanguageService);
  private last: { key: string; text: string } | null = null;

  protected format(key: string, make: (locale: string) => string): string {
    const locale = this.language.formatLocale();
    const full = `${locale}|${key}`;
    if (this.last?.key !== full) {
      this.last = { key: full, text: make(locale) };
    }
    return this.last.text;
  }
}

/** `{{ iso | athensTime }}` → "Sat 14 Nov, 10:00", Athens time, in the UI language. */
@Pipe({ name: 'athensTime', pure: false })
export class AthensTimePipe extends CachedFormat implements PipeTransform {
  transform(iso: string | null | undefined): string {
    if (!iso) return '';
    return this.format(iso, (locale) => formatAthensTime(iso, locale));
  }
}

/** `{{ booking | athensPeriod }}` → "Sat 14 Nov, 10:00 – Mon 16 Nov, 18:00". */
@Pipe({ name: 'athensPeriod', pure: false })
export class AthensPeriodPipe extends CachedFormat implements PipeTransform {
  transform(period: { start: string; end: string } | null | undefined): string {
    if (!period) return '';
    const { start, end } = period;
    return this.format(`${start}|${end}`, (locale) =>
      formatAthensPeriod(start, end, locale),
    );
  }
}
