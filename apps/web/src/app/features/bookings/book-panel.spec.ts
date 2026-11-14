import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import type { PublicItemDetailResponse, QuoteResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { athensDay, athensInstant } from '../../shared/format/athens';
import { tick } from '../../../testing/auth';
import { booking } from '../../../testing/bookings';
import { BookPanel } from './book-panel';
import { QUOTE_DEBOUNCE_MS } from './book.store';

const item: PublicItemDetailResponse = {
  id: 'i-1',
  title: 'Bosch drill',
  description: '',
  category: 'tools',
  pricing: { free: false, dailyCents: 2000 },
  depositCents: 5000,
  photos: [],
  lender: { id: 'lender-1', displayName: 'Eleni' },
  approximateLocation: { lat: 37.98, lng: 23.73 },
  publishedAt: '2026-10-01T10:00:00.000Z',
  minRentalHours: null,
  maxRentalHours: null,
};

/** 10:00 Athens time, two days from now, for one day. */
function period() {
  const day = athensDay(Date.now() + 48 * 3_600_000);
  const start = athensInstant(day, 10) as Date;
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

const quote = (p: { start: string; end: string }): QuoteResponse => ({
  itemId: 'i-1',
  start: p.start,
  end: p.end,
  rentCents: 2000,
  depositCents: 5000,
  feeCents: 200,
  totalCents: 7200,
  lenderFeeCents: 150,
  payoutCents: 1850,
  units: { HOUR: 0, DAY: 1, WEEK: 0, MONTH: 0 },
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function render(signedIn: boolean, initial = period()) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: AuthStore,
        useValue: { isAuthenticated: signal(signedIn) },
      },
    ],
  });
  const fixture = TestBed.createComponent(BookPanel);
  fixture.componentRef.setInput('item', item);
  fixture.componentRef.setInput('initialStart', initial.start);
  fixture.componentRef.setInput('initialEnd', initial.end);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/items/i-1/busy').flush({ periods: [] });
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await tick();
    await fixture.whenStable();
  };
  const answerQuote = async () => {
    await wait(QUOTE_DEBOUNCE_MS + 50);
    const req = http.expectOne((r) => r.url === '/api/items/i-1/quote');
    expect(req.request.params.get('start')).toBe(initial.start);
    expect(req.request.params.get('end')).toBe(initial.end);
    req.flush(quote(initial));
    await settle();
  };
  const cta = () => el.querySelector('.cta') as HTMLButtonElement;
  const clickRequest = async (): Promise<TestRequest> => {
    cta().click();
    await settle();
    return http.expectOne('/api/bookings');
  };
  return { fixture, el, http, settle, answerQuote, cta, clickRequest };
}

describe('BookPanel', () => {
  // The first render compiles Material's date picker and select: slow on a
  // busy machine.
  jest.setTimeout(30_000);

  it('prices the period: rent, fee, deposit and total, explaining the deposit', async () => {
    const { el, answerQuote } = await render(true);
    expect(el.textContent).toContain('bookings.book.pricing');
    await answerQuote();
    const lines = [...el.querySelectorAll('.line')].map((l) =>
      [...l.children]
        .map((c) => c.textContent?.replace(/\s+/g, ' ').trim())
        .join(' '),
    );
    expect(lines).toEqual([
      'bookings.price.rent bookings.units.DAY.one €20',
      'bookings.price.fee €2',
      'bookings.price.deposit €50',
      'bookings.price.total €72',
    ]);
    expect(el.textContent).toContain('bookings.book.depositExplained');
  });

  it('requests the booking and opens it', async () => {
    const { answerQuote, clickRequest, settle } = await render(true);
    await answerQuote();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const req = await clickRequest();
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      bookingId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      itemId: 'i-1',
      ...period(),
    });
    req.flush(booking({ id: 'b-9' }));
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/bookings', 'b-9']);
  });

  it('retries the same attempt with the same id, and says why it failed', async () => {
    const { el, http, answerQuote, clickRequest, settle } = await render(true);
    await answerQuote();
    const first = await clickRequest();
    const id = first.request.body.bookingId;
    first.flush(
      { statusCode: 403, code: 'EMAIL_NOT_VERIFIED', message: 'no' },
      { status: 403, statusText: 'Forbidden' },
    );
    await settle();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('bookings.errors.EMAIL_NOT_VERIFIED');
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/settings');

    const second = await clickRequest();
    expect(second.request.body.bookingId).toBe(id);
    second.flush(
      { statusCode: 409, code: 'SLOT_TAKEN', message: 'taken' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    expect(el.textContent).toContain('bookings.errors.SLOT_TAKEN');
    // The held periods are fetched again.
    http.expectOne('/api/items/i-1/busy').flush({ periods: [] });
  });

  it('sends visitors to sign in, coming back to the same period', async () => {
    const p = period();
    const { el, answerQuote } = await render(false, p);
    await answerQuote();
    const link = el.querySelector('a.cta');
    const href = link?.getAttribute('href') ?? '';
    expect(href.startsWith('/auth/login?returnUrl=')).toBe(true);
    const returnUrl = new URLSearchParams(href.split('?')[1]).get('returnUrl');
    expect(returnUrl).toBe(`/items/i-1?${new URLSearchParams(p).toString()}`);
  });

  it('says what is wrong with a period instead of pricing it', async () => {
    const start = new Date(Date.now() + 48 * 3_600_000);
    const day = athensDay(start);
    const s = athensInstant(day, 10) as Date;
    const tooShortEnd = new Date(s.getTime());
    const { el, http } = await render(true, {
      start: s.toISOString(),
      end: tooShortEnd.toISOString(),
    });
    // The end is suggested afresh only when none is given; an equal end is
    // reported, and nothing is priced.
    await wait(QUOTE_DEBOUNCE_MS + 50);
    http.expectNone((r) => r.url === '/api/items/i-1/quote');
    expect(el.querySelector('.problem')?.textContent).toContain(
      'bookings.book.problem.endBeforeStart',
    );
  });
});
