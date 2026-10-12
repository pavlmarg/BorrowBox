import { Injectable } from '@angular/core';
import type { GeoPoint } from '@borrowbox/contracts';

/** Why there's no position; each has a message under `geo.errors.*`. */
export type GeolocationErrorCode =
  'denied' | 'unavailable' | 'timeout' | 'unsupported';

export class GeolocationError extends Error {
  constructor(readonly code: GeolocationErrorCode) {
    super(`Geolocation failed: ${code}`);
    this.name = 'GeolocationError';
  }
}

export interface LocateOptions {
  /**
   * True for placing an item's pin; false (default) for searching, where a
   * neighbourhood is enough and a coarse fix is faster and cheaper on battery.
   */
  precise?: boolean;
}

const TIMEOUT_MS = 10_000;
/** A fix this recent is reused instead of asking the device again. */
const MAX_AGE_MS = 5 * 60_000;

/**
 * The device's position, from the browser (needs a secure context:
 * https, or localhost in development). The point is only ever used for the
 * request at hand; it isn't stored.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  currentPosition(options: LocateOptions = {}): Promise<GeoPoint> {
    const geolocation =
      typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geolocation) {
      return Promise.reject(new GeolocationError('unsupported'));
    }
    return new Promise((resolve, reject) =>
      geolocation.getCurrentPosition(
        ({ coords }) =>
          resolve({ lat: coords.latitude, lng: coords.longitude }),
        (error) => reject(new GeolocationError(errorCode(error))),
        {
          enableHighAccuracy: options.precise ?? false,
          timeout: TIMEOUT_MS,
          maximumAge: options.precise ? 0 : MAX_AGE_MS,
        },
      ),
    );
  }
}

function errorCode(error: GeolocationPositionError): GeolocationErrorCode {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'denied';
    case error.TIMEOUT:
      return 'timeout';
    default:
      return 'unavailable';
  }
}
