import { DOCUMENT, InjectionToken, inject } from '@angular/core';

export type MapLibre = typeof import('maplibre-gl');

/**
 * Loads MapLibre on first use, so it never weighs on pages without a map
 * (ADR-0008). Its stylesheet and worker are copied to `vendor/maplibre/` by
 * the build (project.json assets) and served from our own origin; the
 * version in the URL keeps caches right across upgrades. Tests provide a
 * fake: jsdom has no WebGL.
 */
export const MAP_LIBRE = new InjectionToken<() => Promise<MapLibre>>(
  'MAP_LIBRE',
  {
    providedIn: 'root',
    factory: () => {
      const document = inject(DOCUMENT);
      return retryableOnce(() => loadMapLibre(document));
    },
  },
);

/**
 * Runs `load` once and shares its result. A failure (offline, a chunk that
 * didn't download) is forgotten, so the next map tries again instead of
 * staying unavailable until the page is reloaded.
 */
export function retryableOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () =>
    (loading ??= load().catch((err: unknown) => {
      loading = undefined;
      throw err;
    }));
}

const VENDOR = '/vendor/maplibre';

async function loadMapLibre(document: Document): Promise<MapLibre> {
  const maplibre = await import('maplibre-gl');
  const version = encodeURIComponent(maplibre.getVersion());
  maplibre.setWorkerUrl(`${VENDOR}/maplibre-gl-worker.mjs?v=${version}`);
  await addStylesheet(document, `${VENDOR}/maplibre-gl.css?v=${version}`);
  return maplibre;
}

/** Resolves once loaded; a failed stylesheet only costs looks, so it resolves too. */
function addStylesheet(document: Document, href: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}
