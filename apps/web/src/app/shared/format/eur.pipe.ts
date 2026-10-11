import { Pipe, inject, type PipeTransform } from '@angular/core';
import { LanguageService } from '../../core/i18n/language';
import { formatCents } from './money';

/**
 * `{{ 550 | eur }}` → `5,50 €` in Greek, `€5.50` in English. Not pure, so it
 * follows a language switch (formatting a number is cheap).
 */
@Pipe({ name: 'eur', pure: false })
export class EurPipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(cents: number | null | undefined): string {
    return cents === null || cents === undefined
      ? ''
      : formatCents(cents, this.language.formatLocale());
  }
}
