import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppConfigService, parseAppConfig } from './app-config';

const STYLE = 'https://api.maptiler.com/maps/streets-v2/style.json?key=abc';
const KEY = 'pk_test_51AbCdEfGhIjKlMnOpQrStUv';

describe('parseAppConfig', () => {
  it('keeps an https style URL', () => {
    expect(parseAppConfig({ mapStyleUrl: STYLE })).toEqual({
      mapStyleUrl: STYLE,
      stripePublishableKey: null,
    });
  });

  it('keeps a Stripe test-mode publishable key', () => {
    expect(parseAppConfig({ stripePublishableKey: KEY })).toEqual({
      mapStyleUrl: null,
      stripePublishableKey: KEY,
    });
  });

  it.each([
    ['a live key', 'pk_live_51AbCdEfGhIjKlMnOpQrStUv'],
    ['a secret key', 'sk_test_51AbCdEfGhIjKlMnOpQrStUv'],
    ['the example placeholder', 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY'],
    ['not a string', 42],
  ])('refuses %s', (_, stripePublishableKey) => {
    expect(parseAppConfig({ stripePublishableKey })).toEqual({
      mapStyleUrl: null,
      stripePublishableKey: null,
    });
  });

  it.each([
    ['missing', {}],
    ['not an object', 'nope'],
    ['plain http', { mapStyleUrl: 'http://example.com/style.json' }],
    [
      'the example placeholder',
      {
        mapStyleUrl:
          'https://api.maptiler.com/maps/streets-v2/style.json?key=YOUR_MAPTILER_KEY',
      },
    ],
  ])('turns %s into "no map"', (_, raw) => {
    expect(parseAppConfig(raw)).toEqual({
      mapStyleUrl: null,
      stripePublishableKey: null,
    });
  });
});

describe('AppConfigService', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      service: TestBed.inject(AppConfigService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('fetches /config.json once', async () => {
    const { service, http } = setup();
    const both = Promise.all([service.load(), service.load()]);
    http.expectOne('/config.json').flush({ mapStyleUrl: STYLE });
    expect(await both).toEqual([
      { mapStyleUrl: STYLE, stripePublishableKey: null },
      { mapStyleUrl: STYLE, stripePublishableKey: null },
    ]);
    http.verify();
  });

  it('means "no map" when the file is missing', async () => {
    const { service, http } = setup();
    const config = service.load();
    http
      .expectOne('/config.json')
      .flush('', { status: 404, statusText: 'Not Found' });
    expect(await config).toEqual({
      mapStyleUrl: null,
      stripePublishableKey: null,
    });
  });
});
