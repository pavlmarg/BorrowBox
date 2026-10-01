import { registerLocaleData } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import localeEl from '@angular/common/locales/el';
import localeEnGb from '@angular/common/locales/en-GB';
import { DOCUMENT, Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  TranslocoService,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import type { Locale } from '../../api/models';

export const LANGUAGES: readonly Locale[] = ['el', 'en'];
export const DEFAULT_LANGUAGE: Locale = 'el';
const STORAGE_KEY = 'bb.lang';

/** Formatting locale per UI language (dates, numbers, later EUR amounts). */
const FORMAT_LOCALE: Record<Locale, string> = { el: 'el-GR', en: 'en-GB' };
registerLocaleData(localeEl, 'el-GR');
registerLocaleData(localeEnGb, 'en-GB');

/** Loads `public/i18n/<lang>.json`. */
@Injectable({ providedIn: 'root' })
export class TranslationLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);
  getTranslation(lang: string) {
    return this.http.get<Translation>(`/i18n/${lang}.json`);
  }
}

export function isLanguage(value: unknown): value is Locale {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

/** Saved choice, else the browser's preference, else Greek. */
export function initialLanguage(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage unavailable: fall through.
  }
  const browser =
    typeof navigator === 'undefined' ? '' : navigator.language.slice(0, 2);
  return isLanguage(browser) ? browser : DEFAULT_LANGUAGE;
}

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  readonly current = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });
  /** For `date`/`number` pipes. */
  readonly formatLocale = computed(() =>
    isLanguage(this.current())
      ? FORMAT_LOCALE[this.current() as Locale]
      : 'el-GR',
  );

  use(lang: Locale): void {
    this.transloco.setActiveLang(lang);
    this.document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }
}
