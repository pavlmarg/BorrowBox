import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppConfigService, parseAppConfig } from './app-config';

const STYLE = 'https://api.maptiler.com/maps/streets-v2/style.json?key=abc';

describe('parseAppConfig', () => {
  it('keeps an https style URL', () => {
    expect(parseAppConfig({ mapStyleUrl: STYLE })).toEqual({
      mapStyleUrl: STYLE,
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
    expect(parseAppConfig(raw)).toEqual({ mapStyleUrl: null });
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
      { mapStyleUrl: STYLE },
      { mapStyleUrl: STYLE },
    ]);
    http.verify();
  });

  it('means "no map" when the file is missing', async () => {
    const { service, http } = setup();
    const config = service.load();
    http
      .expectOne('/config.json')
      .flush('', { status: 404, statusText: 'Not Found' });
    expect(await config).toEqual({ mapStyleUrl: null });
  });
});
