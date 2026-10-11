import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Settings read at runtime from `/config.json` (gitignored; copy
 * `public/config.example.json`), so one build serves every environment and
 * changing the map key needs no rebuild (ADR-0008).
 */
export interface AppConfig {
  /** MapLibre style URL, key included, e.g. MapTiler's `…/style.json?key=…`. Null: no map. */
  mapStyleUrl: string | null;
}

const NO_CONFIG: AppConfig = { mapStyleUrl: null };

/** Keeps only well-formed values: a broken file means "no map", never a crash. */
export function parseAppConfig(raw: unknown): AppConfig {
  const value =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)['mapStyleUrl']
      : undefined;
  const mapStyleUrl =
    typeof value === 'string' &&
    /^https:\/\/\S+$/.test(value) &&
    !value.includes('YOUR_MAPTILER_KEY')
      ? value
      : null;
  return { mapStyleUrl };
}

/** Loaded once, on first use (only pages with a map need it). */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = inject(HttpClient);
  private loading?: Promise<AppConfig>;

  load(): Promise<AppConfig> {
    this.loading ??= firstValueFrom(this.http.get<unknown>('/config.json'))
      .then(parseAppConfig)
      .catch(() => NO_CONFIG);
    return this.loading;
  }
}
