import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { toCanvas } from 'qrcode';
import { tick } from '../../../testing/auth';
import { HandoffShow } from './handoff-show';

// jsdom has no canvas drawing: the QR library itself is not under test.
jest.mock('qrcode', () => ({
  toCanvas: jest.fn().mockResolvedValue(undefined),
}));
const drawn = toCanvas as unknown as jest.Mock;

const tokenUrl = '/api/bookings/b-1/handoff-token';

async function render() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
    ],
  });
  const fixture = TestBed.createComponent(HandoffShow);
  fixture.componentRef.setInput('bookingId', 'b-1');
  fixture.componentRef.setInput('phase', 'PICKUP');
  await fixture.whenStable();
  const settle = async () => {
    await tick();
    await fixture.whenStable();
  };
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    settle,
  };
}

const token = (code: string, expiresInS: number) => ({
  token: `v1.payload-${code}.sig`,
  code,
  refreshAfterSeconds: 30,
  expiresAt: new Date(Date.now() + expiresInS * 1000).toISOString(),
});

describe('HandoffShow', () => {
  afterEach(() => drawn.mockClear());

  it('draws the QR code and shows the 6-digit code in threes', async () => {
    const { el, http, settle, fixture } = await render();
    const req = http.expectOne((r) => r.url === tokenUrl);
    expect(req.request.params.get('phase')).toBe('PICKUP');
    req.flush(token('482913', 45));
    await settle();

    expect(drawn).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      'v1.payload-482913.sig',
      expect.objectContaining({ errorCorrectionLevel: 'M' }),
    );
    expect(el.querySelector('.code')?.textContent?.trim()).toBe('482 913');
    expect(el.textContent).toContain('handoff.show.renews');
    fixture.destroy();
  });

  it('fetches the next code before the shown one expires', async () => {
    const { http, settle, fixture } = await render();
    // Expires in 11 s: renewed after 1 s, not the server's 30.
    http.expectOne((r) => r.url === tokenUrl).flush(token('111111', 11));
    await settle();
    await new Promise((r) => setTimeout(r, 1_100));
    http.expectOne((r) => r.url === tokenUrl).flush(token('222222', 45));
    await settle();
    expect(drawn).toHaveBeenLastCalledWith(
      expect.anything(),
      'v1.payload-222222.sig',
      expect.anything(),
    );
    fixture.destroy();
  });

  it('takes the code down and says why when the handoff closed', async () => {
    const { el, http, settle, fixture } = await render();
    http
      .expectOne((r) => r.url === tokenUrl)
      .flush(
        { statusCode: 409, code: 'INVALID_STATE', message: 'no' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    expect(el.querySelector('.code')).toBeNull();
    expect(el.textContent).toContain('handoff.errors.INVALID_STATE');
    fixture.destroy();
  });
});
