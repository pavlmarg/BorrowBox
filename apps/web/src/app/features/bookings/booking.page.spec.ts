import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import type { BookingViewResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { booking } from '../../../testing/bookings';
import { BookingPage, cancelPolicy } from './booking.page';

const H = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();

async function render(shown: BookingViewResponse | 'missing') {
  const opened: Array<{ title: string; message: string }> = [];
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: MatDialog,
        useValue: {
          open: (
            _: unknown,
            config: { data: { title: string; message: string } },
          ) => {
            opened.push(config.data);
            return { afterClosed: () => of(true) };
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(BookingPage);
  fixture.componentRef.setInput('id', 'b-1');
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const settle = async () => {
    await tick();
    await fixture.whenStable();
  };
  const get = http.expectOne('/api/bookings/b-1');
  if (shown === 'missing') {
    get.flush(
      { statusCode: 404, code: 'NOT_FOUND', message: 'Not found' },
      { status: 404, statusText: 'Not Found' },
    );
  } else {
    get.flush(shown);
  }
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const button = (key: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === key,
    ) as HTMLButtonElement | undefined;
  return { fixture, el, http, settle, button, opened };
}

describe('cancelPolicy', () => {
  const now = Date.parse('2026-11-09T10:00:00Z');
  it('depends on who cancels and how long before the start', () => {
    expect(cancelPolicy(booking({ status: 'ACCEPTED' }), now)).toBe(
      'nothingPaid',
    );
    expect(
      cancelPolicy(
        booking({ status: 'PAID', start: '2026-11-11T10:00:00Z' }),
        now,
      ),
    ).toBe('renterEarly');
    expect(
      cancelPolicy(
        booking({ status: 'PAID', start: '2026-11-10T09:00:00Z' }),
        now,
      ),
    ).toBe('renterLate');
    expect(cancelPolicy(booking({ status: 'PAID', role: 'LENDER' }), now)).toBe(
      'lenderPaid',
    );
  });
});

describe('BookingPage', () => {
  it('lets the lender accept a request', async () => {
    const { el, http, settle, button, opened } = await render(
      booking({ role: 'LENDER', start: inHours(48), end: inHours(72) }),
    );
    expect(el.querySelector('h1 a')?.getAttribute('href')).toBe('/items/i-1');
    expect(el.textContent).toContain('bookings.state.REQUESTED.LENDER');
    expect(button('bookings.detail.decline')).toBeDefined();

    button('bookings.detail.accept')?.click();
    await settle();
    expect(opened[0].title).toBe('bookings.confirm.accept.title');
    const req = http.expectOne('/api/bookings/b-1/accept');
    expect(req.request.method).toBe('POST');
    req.flush(
      booking({
        role: 'LENDER',
        status: 'ACCEPTED',
        start: inHours(48),
        end: inHours(72),
        payBy: inHours(24),
      }),
    );
    await settle();
    expect(el.textContent).toContain('bookings.state.ACCEPTED.LENDER');
    expect(button('bookings.detail.accept')).toBeUndefined();
  });

  it('links to payouts when the lender has none set up', async () => {
    const { el, http, settle, button } = await render(
      booking({ role: 'LENDER', start: inHours(48), end: inHours(72) }),
    );
    button('bookings.detail.accept')?.click();
    await settle();
    http
      .expectOne('/api/bookings/b-1/accept')
      .flush(
        { statusCode: 409, code: 'PAYOUTS_NOT_SET_UP', message: 'no' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('bookings.errors.PAYOUTS_NOT_SET_UP');
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe(
      '/settings/payouts',
    );
  });

  it('shows the renter what to pay and by when, with a link to pay', async () => {
    const { el, fixture } = await render(
      booking({
        status: 'ACCEPTED',
        start: inHours(48),
        end: inHours(72),
        expiresAt: null,
        payBy: inHours(5),
      }),
    );
    expect(el.querySelector('.countdown')?.textContent).toContain(
      'bookings.detail.timeLeft',
    );
    expect(el.querySelector('a.pay-now')?.getAttribute('href')).toBe(
      '/bookings/b-1/pay',
    );
    const totals = el.querySelector('.total')?.textContent;
    expect(totals).toContain('€72');
    fixture.destroy();
  });

  it('explains the cancellation policy and reloads when the booking changed', async () => {
    const { el, http, settle, button, opened } = await render(
      booking({
        status: 'PAID',
        start: inHours(48),
        end: inHours(72),
        expiresAt: null,
      }),
    );
    expect(el.textContent).toContain('bookings.policy.nowEarly');
    expect(el.textContent).toContain('bookings.detail.meet');

    button('bookings.detail.cancel')?.click();
    await settle();
    expect(opened[0].title).toBe('bookings.confirm.cancel.title');
    expect(opened[0].message).toContain('bookings.policy.renterEarlyShort');
    http
      .expectOne('/api/bookings/b-1/cancel')
      .flush(
        { statusCode: 409, code: 'INVALID_STATE', message: 'no' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    http.expectOne('/api/bookings/b-1').flush(
      booking({
        status: 'CANCELLED',
        reason: 'LENDER',
        start: inHours(48),
        end: inHours(72),
        expiresAt: null,
      }),
    );
    await settle();
    expect(el.textContent).toContain('bookings.detail.changed');
    expect(el.textContent).toContain('bookings.reason.CANCELLED_LENDER.RENTER');
    expect(button('bookings.detail.cancel')).toBeUndefined();
  });

  it('lets the renter withdraw a request', async () => {
    const { http, settle, button, opened } = await render(
      booking({ start: inHours(48), end: inHours(72) }),
    );
    button('bookings.detail.withdraw')?.click();
    await settle();
    expect(opened[0].title).toBe('bookings.confirm.withdraw.title');
    http
      .expectOne('/api/bookings/b-1/cancel')
      .flush(booking({ status: 'CANCELLED', reason: 'RENTER' }));
    await settle();
  });

  it('shows the lender what they receive', async () => {
    const { el } = await render(
      booking({ role: 'LENDER', status: 'DECLINED', reason: 'OVERLAP' }),
    );
    expect(el.textContent).toContain('bookings.reason.DECLINED_OVERLAP.LENDER');
    expect(el.querySelector('.total')?.textContent).toContain('€18.50');
    expect(el.textContent).toContain('bookings.price.lenderFee');
  });

  it('says when the booking is not there', async () => {
    const { el } = await render('missing');
    expect(el.textContent).toContain('bookings.errors.NOT_FOUND');
  });
});
