import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import type { BookingViewResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { booking } from '../../../testing/bookings';
import { HandoffScan } from './handoff-scan';

// jsdom has no camera (navigator.mediaDevices is undefined), which is also
// what a phone on plain http gets: the screen falls back to the code.
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
  const fixture = TestBed.createComponent(HandoffScan);
  fixture.componentRef.setInput('bookingId', 'b-1');
  fixture.componentRef.setInput('phase', 'PICKUP');
  const scanned: BookingViewResponse[] = [];
  fixture.componentInstance.scanned.subscribe((b) => scanned.push(b));
  await fixture.whenStable();
  const settle = async () => {
    await tick();
    await fixture.whenStable();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const type = async (value: string) => {
    const field = el.querySelector<HTMLInputElement>('#handoff-code')!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle();
  };
  return {
    el,
    http: TestBed.inject(HttpTestingController),
    settle,
    type,
    scanned,
  };
}

describe('HandoffScan', () => {
  it('falls back to typing the code when there is no camera', async () => {
    const { el } = await render();
    expect(el.querySelector('#handoff-code')).not.toBeNull();
    expect(el.textContent).toContain('handoff.scan.camera.unavailable');
    expect(el.querySelector('video')).toBeNull();
  });

  it('sends the code by itself at the sixth digit, then reports success', async () => {
    const { http, type, settle, scanned } = await render();
    await type('482 91');
    http.expectNone('/api/bookings/b-1/handoff');

    await type('482 913');
    const req = http.expectOne('/api/bookings/b-1/handoff');
    expect(req.request.body).toEqual({ phase: 'PICKUP', code: '482913' });
    req.flush(booking({ status: 'PICKED_UP' }));
    await settle();
    expect(scanned.map((b) => b.status)).toEqual(['PICKED_UP']);
  });

  it('explains a wrong code and clears the field for another try', async () => {
    const { el, http, type, settle } = await render();
    await type('111111');
    http
      .expectOne('/api/bookings/b-1/handoff')
      .flush(
        { statusCode: 400, code: 'TOKEN_INVALID', message: 'no' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    expect(el.textContent).toContain('handoff.errors.TOKEN_INVALID_CODE');
    expect(el.querySelector<HTMLInputElement>('#handoff-code')?.value).toBe('');
  });

  it('says when too many wrong codes were tried', async () => {
    const { el, http, type, settle } = await render();
    await type('222222');
    http
      .expectOne('/api/bookings/b-1/handoff')
      .flush(
        { statusCode: 429, code: 'RATE_LIMITED', message: 'no' },
        { status: 429, statusText: 'Too Many Requests' },
      );
    await settle();
    expect(el.textContent).toContain('handoff.errors.RATE_LIMITED');
  });
});
