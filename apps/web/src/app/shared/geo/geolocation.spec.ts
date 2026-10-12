import { TestBed } from '@angular/core/testing';
import { GeolocationError, GeolocationService } from './geolocation';

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

function fakeGeolocation(
  answer: (ok: Success, fail: Failure, options?: PositionOptions) => void,
) {
  const getCurrentPosition = jest.fn(answer);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

function positionError(code: number): GeolocationPositionError {
  return {
    code,
    message: '',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

describe('GeolocationService', () => {
  const service = () => TestBed.inject(GeolocationService);

  afterEach(() => {
    delete (navigator as { geolocation?: unknown }).geolocation;
  });

  it('returns the point, coarse by default', async () => {
    const get = fakeGeolocation((ok) =>
      ok({ coords: { latitude: 37.98, longitude: 23.72 } } as never),
    );
    await expect(service().currentPosition()).resolves.toEqual({
      lat: 37.98,
      lng: 23.72,
    });
    expect(get.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false });
  });

  it('asks for a fresh, precise fix when placing a pin', async () => {
    const get = fakeGeolocation((ok) =>
      ok({ coords: { latitude: 1, longitude: 2 } } as never),
    );
    await service().currentPosition({ precise: true });
    expect(get.mock.calls[0][2]).toMatchObject({
      enableHighAccuracy: true,
      maximumAge: 0,
    });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps browser error %i to %s', async (code, expected) => {
    fakeGeolocation((_, fail) => fail(positionError(code)));
    await expect(service().currentPosition()).rejects.toEqual(
      new GeolocationError(expected as never),
    );
  });

  it('says unsupported without the API', async () => {
    await expect(service().currentPosition()).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});
