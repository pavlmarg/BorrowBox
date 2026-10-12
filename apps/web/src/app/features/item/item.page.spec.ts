import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import type { PublicItemDetailResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { AppConfigService } from '../../core/config/app-config';
import { tick } from '../../../testing/auth';
import { publicItem } from '../../../testing/catalog';
import { ItemPage } from './item.page';

const detail = (
  overrides: Partial<PublicItemDetailResponse> = {},
): PublicItemDetailResponse => ({
  id: 'i-1',
  title: 'Bosch drill',
  description: 'Line one\nLine two',
  category: 'tools',
  pricing: { free: false, dailyCents: 800, weeklyCents: 3500 },
  depositCents: 5000,
  photos: [
    {
      id: 'p-1',
      urls: { small: 's.webp', medium: 'm.webp', large: 'l.webp' },
    },
  ],
  lender: { id: 'lender-1', displayName: 'Eleni' },
  approximateLocation: { lat: 37.98, lng: 23.73 },
  publishedAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

async function render(userId: string | null = null) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: AppConfigService,
        useValue: { load: () => Promise.resolve({ mapStyleUrl: null }) },
      },
      {
        provide: AuthStore,
        useValue: { user: signal(userId ? { id: userId } : null) },
      },
    ],
  });
  const fixture = TestBed.createComponent(ItemPage);
  fixture.componentRef.setInput('id', 'i-1');
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const respond = async (
    item: PublicItemDetailResponse | 'missing',
    similar = [publicItem('s-1', { title: 'Other drill' })],
  ) => {
    const get = http.expectOne('/api/items/i-1');
    if (item === 'missing') {
      get.flush(
        { statusCode: 404, code: 'NOT_FOUND', message: 'Item not found' },
        { status: 404, statusText: 'Not Found' },
      );
    } else {
      get.flush(item);
    }
    http.expectOne('/api/items/i-1/similar').flush({ items: similar });
    await tick();
    await fixture.whenStable();
  };
  return { fixture, el: fixture.nativeElement as HTMLElement, respond };
}

describe('ItemPage', () => {
  it('shows the item, its rates and deposit, and similar items', async () => {
    const { el, respond } = await render();
    await respond(detail());

    expect(el.querySelector('h1')?.textContent).toContain('Bosch drill');
    const rates = [...el.querySelectorAll('.rate')].map((r) =>
      r.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(rates).toEqual(['catalog.units.DAY€8', 'catalog.units.WEEK€35']);
    expect(el.querySelector('.deposit')?.textContent).toContain('€50');
    expect(el.querySelector('.description')?.textContent).toContain(
      'Line one\nLine two',
    );
    expect(el.querySelector('.cta')?.hasAttribute('disabled')).toBe(true);
    expect(el.querySelectorAll('.similar bb-result-row').length).toBe(1);
    expect(el.querySelector('.owner-note')).toBeNull();
  });

  it('says free for free items', async () => {
    const { el, respond } = await render();
    await respond(detail({ pricing: { free: true }, depositCents: 0 }), []);
    expect(el.querySelector('.free')?.textContent).toContain('catalog.free');
    expect(el.querySelector('.rates')).toBeNull();
    expect(el.querySelector('.deposit')?.textContent).toContain(
      'item.noDeposit',
    );
    expect(el.querySelector('.similar')).toBeNull();
  });

  it('tells the owner it is theirs, with a link to edit it', async () => {
    const { el, respond } = await render('lender-1');
    await respond(detail());
    const note = el.querySelector('.owner-note');
    expect(note?.textContent).toContain('item.yours');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe(
      '/my-items/i-1/edit',
    );
  });

  it('says when the item is gone', async () => {
    const { el, respond } = await render();
    await respond('missing');
    expect(el.textContent).toContain('item.notFound');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/explore');
  });
});
