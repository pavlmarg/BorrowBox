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
import type { OwnItemResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { MyItemsPage, coverOf, missingForPublish } from './my-items.page';

const own = (
  id: string,
  overrides: Partial<OwnItemResponse> = {},
): OwnItemResponse => ({
  id,
  status: 'ACTIVE',
  title: `Item ${id}`,
  description: '',
  category: 'tools',
  pricing: { free: false, dailyCents: 500 },
  depositCents: 0,
  location: { lat: 37.98, lng: 23.73 },
  approximateLocation: { lat: 37.981, lng: 23.731 },
  photos: [
    {
      id: 'p',
      position: 0,
      status: 'READY',
      urls: { small: 's', medium: 'm', large: 'l' },
    },
  ],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  publishedAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

async function render(items: OwnItemResponse[], confirm = true) {
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
        useValue: { open: () => ({ afterClosed: () => of(confirm) }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(MyItemsPage);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/me/items').flush(items);
  await tick();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const buttons = (row: number) =>
    [
      ...el
        .querySelectorAll('.row')
        [row].querySelectorAll('.actions a, .actions button'),
    ].map((b) => ({
      text: b.textContent?.trim(),
      disabled: b.hasAttribute('disabled'),
    }));
  return { fixture, el, http, buttons };
}

describe('missingForPublish / coverOf', () => {
  it('lists what a draft still needs', () => {
    expect(missingForPublish(own('a', { location: null, photos: [] }))).toEqual(
      ['location', 'photo'],
    );
    expect(missingForPublish(own('a'))).toEqual([]);
  });

  it('uses the first processed photo as the cover', () => {
    const item = own('a', {
      photos: [
        { id: 'x', position: 0, status: 'PENDING', urls: null },
        {
          id: 'y',
          position: 2,
          status: 'READY',
          urls: { small: 'late', medium: '', large: '' },
        },
        {
          id: 'z',
          position: 1,
          status: 'READY',
          urls: { small: 'first', medium: '', large: '' },
        },
      ],
    });
    expect(coverOf(item)).toBe('first');
  });
});

describe('MyItemsPage', () => {
  it('offers the actions that fit each status', async () => {
    const { buttons } = await render([
      own('a'),
      own('b', { status: 'PAUSED' }),
      own('c', { status: 'DRAFT', location: null }),
    ]);
    expect(buttons(0).map((b) => b.text)).toEqual([
      'item.edit',
      'myItems.view',
      'myItems.pause',
      'myItems.delete',
    ]);
    expect(buttons(1).map((b) => b.text)).toEqual([
      'item.edit',
      'myItems.unpause',
      'myItems.delete',
    ]);
    // A draft without a location can't be published yet.
    expect(buttons(2).find((b) => b.text === 'listing.publish')?.disabled).toBe(
      true,
    );
  });

  it('replaces the row with the saved item after an action', async () => {
    const { fixture, el, http } = await render([own('a')]);
    (el.querySelectorAll('.actions button')[0] as HTMLButtonElement).click();
    http
      .expectOne({ method: 'POST', url: '/api/me/items/a/pause' })
      .flush(own('a', { status: 'PAUSED' }));
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('.status')?.textContent).toContain(
      'myItems.status.PAUSED',
    );
  });

  it('deletes after confirmation', async () => {
    const { fixture, el, http } = await render([own('a'), own('b')]);
    (el.querySelector('.row .delete') as HTMLButtonElement).click();
    await tick();
    http.expectOne({ method: 'DELETE', url: '/api/me/items/a' }).flush(null);
    await tick();
    await fixture.whenStable();
    expect(el.querySelectorAll('.row').length).toBe(1);
  });

  it('keeps the item when the deletion is cancelled', async () => {
    const { el, http } = await render([own('a')], false);
    (el.querySelector('.row .delete') as HTMLButtonElement).click();
    await tick();
    http.expectNone({ method: 'DELETE' });
    expect(el.querySelectorAll('.row').length).toBe(1);
  });

  it('invites a first listing when there is none', async () => {
    const { el } = await render([]);
    expect(el.textContent).toContain('myItems.empty');
    expect(el.querySelector('.message a')?.getAttribute('href')).toBe(
      '/my-items/new',
    );
  });
});
