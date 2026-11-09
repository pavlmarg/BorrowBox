import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';

/** What the user chose: follow the device, or always light / dark. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What the page actually shows. */
export type Theme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  'system',
  'light',
  'dark',
];
const STORAGE_KEY = 'bb.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return (THEME_PREFERENCES as readonly unknown[]).includes(value);
}

/** The saved choice, else `system` (also when storage is unavailable). */
export function storedThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(saved)) return saved;
  } catch {
    // Storage unavailable: follow the device.
  }
  return 'system';
}

function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

/** The device's dark-mode query, or null where matchMedia is missing. */
function darkQuery(view: Window | null | undefined): MediaQueryList | null {
  try {
    return view?.matchMedia?.(DARK_QUERY) ?? null;
  } catch {
    return null;
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

/**
 * Marks `<html>` with the theme; styles.scss switches `color-scheme` (which
 * flips Material's `light-dark()` tokens) and the brand variables on it.
 */
export function applyTheme(doc: Document, theme: Theme): void {
  doc.documentElement.setAttribute('data-theme', theme);
}

/** Called in main.ts before Angular starts, so pages never flash light. */
export function applyInitialTheme(doc: Document = document): void {
  const systemDark = darkQuery(doc.defaultView)?.matches ?? false;
  applyTheme(doc, resolveTheme(storedThemePreference(), systemDark));
}

/** The light / dark / device choice, saved in this browser only. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly systemDark = signal(false);

  readonly preference = signal<ThemePreference>(storedThemePreference());
  readonly theme = computed(() =>
    resolveTheme(this.preference(), this.systemDark()),
  );

  constructor() {
    const query = darkQuery(this.document.defaultView);
    if (query) {
      this.systemDark.set(query.matches);
      // Follows the device while the choice is `system`.
      const onChange = (event: MediaQueryListEvent) => {
        this.systemDark.set(event.matches);
        this.apply();
      };
      query.addEventListener?.('change', onChange);
      inject(DestroyRef).onDestroy(() =>
        query.removeEventListener?.('change', onChange),
      );
    }
    this.apply();
  }

  use(preference: ThemePreference): void {
    this.preference.set(preference);
    saveThemePreference(preference);
    this.apply();
  }

  private apply(): void {
    applyTheme(this.document, this.theme());
  }
}
