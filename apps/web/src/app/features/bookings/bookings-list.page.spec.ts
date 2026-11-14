import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { tick } from '../../../testing/auth';
import { booking } from '../../../testing/bookings';
import { BookingsListPage } from './bookings-list.page';

async function render(query: { role?: string; show?: string } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
    ],
  });
  const fixture = TestBed.createComponent(BookingsListPage);
  if (query.role) fixture.componentRef.setInput('role', query.role);
  if (query.show) fixture.componentRef.setInput('show', query.show);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const settle = async () => {
    await tick();
    await fixture.whenStable();
  };
  const list = (): TestRequest =>
    http.expectOne((r) => r.url === '/api/me/bookings');
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    http,
    settle,
    list,
  };
}

describe('BookingsListPage', () => {
  it('lists current rentals, then loads more with the cursor', async () => {
    const { el, settle, list } = await render();
    const first = list();
    expect(first.request.params.get('role')).toBe('RENTER');
    expect(first.request.params.getAll('statuses')).toContain('REQUESTED');
    expect(first.request.params.getAll('statuses')).not.toContain('CANCELLED');
    first.flush({
      bookings: [booking(), booking({ id: 'b-2', status: 'PAID' })],
      nextCursor: 'c-1',
    });
    await settle();

    const rows = el.querySelectorAll('a.row');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('href')).toBe('/bookings/b-1');
    expect(rows[0].textContent).toContain('Bosch drill');
    expect(rows[0].textContent).toContain('bookings.withLender');
    expect(rows[0].textContent).toContain('bookings.status.REQUESTED');
    expect(rows[0].textContent).toContain('€72');
    expect(el.querySelector('a.tab.active')?.getAttribute('aria-current')).toBe(
      'page',
    );

    (el.querySelector('.more button') as HTMLButtonElement).click();
    await settle();
    const more = list();
    expect(more.request.params.get('cursor')).toBe('c-1');
    more.flush({
      bookings: [booking({ id: 'b-3', status: 'ACCEPTED' })],
      nextCursor: null,
    });
    await settle();
    expect(el.querySelectorAll('a.row').length).toBe(3);
    expect(el.querySelector('.more')).toBeNull();
  });

  it('shows the lending side from the URL, with its own empty state', async () => {
    const { el, settle, list } = await render({ role: 'lender', show: 'all' });
    const req = list();
    expect(req.request.params.get('role')).toBe('LENDER');
    expect(req.request.params.has('statuses')).toBe(false);
    req.flush({ bookings: [], nextCursor: null });
    await settle();
    expect(el.textContent).toContain('bookings.list.empty.all');
    expect(el.querySelector('.message a')?.getAttribute('href')).toBe(
      '/my-items',
    );
    const tabs = [...el.querySelectorAll('a.tab')].map((a) =>
      a.getAttribute('href'),
    );
    expect(tabs).toEqual([
      '/bookings?role=renter&show=all',
      '/bookings?role=lender&show=all',
    ]);
  });

  it('offers a retry when loading fails', async () => {
    const { el, settle, list } = await render({ show: 'past' });
    list().flush(
      { statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'down' },
      { status: 503, statusText: 'Unavailable' },
    );
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'errors.SERVICE_UNAVAILABLE',
    );
    (el.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await settle();
    expect(list().request.params.getAll('statuses')).toContain('CANCELLED');
  });
});
