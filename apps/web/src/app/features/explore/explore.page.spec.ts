import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { AppConfigService } from '../../core/config/app-config';
import { tick } from '../../../testing/auth';
import { publicItem } from '../../../testing/catalog';
import { ExplorePage } from './explore.page';

const SEARCH = { method: 'POST', url: '/api/items/search' };
const FEATURED = { method: 'POST', url: '/api/items/featured' };

async function render(url = '/explore') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: 'explore', component: ExplorePage }]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      // No map in tests (jsdom has no WebGL): the page works without it.
      {
        provide: AppConfigService,
        useValue: { load: () => Promise.resolve({ mapStyleUrl: null }) },
      },
    ],
  });
  await TestBed.inject(Router).navigateByUrl(url);
  const fixture = TestBed.createComponent(ExplorePage);
  await fixture.whenStable();
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
  };
}

describe('ExplorePage', () => {
  it('shows placeholder rows, then the results', async () => {
    const { fixture, el, http } = await render();
    expect(el.querySelectorAll('.skeleton li').length).toBeGreaterThan(0);

    http.expectOne(SEARCH).flush({
      items: [publicItem('a', { title: 'Drill' }), publicItem('b')],
      nextCursor: null,
    });
    await tick();
    await fixture.whenStable();

    const rows = el.querySelectorAll('bb-result-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Drill');
    // The title and the photo link to the item; only the title is
    // reachable by keyboard and screen readers.
    const title = rows[0].querySelector('a.title');
    const photo = rows[0].querySelector('a.photo');
    expect(title?.getAttribute('href')).toBe('/items/a');
    expect(photo?.getAttribute('href')).toBe('/items/a');
    expect(photo?.getAttribute('tabindex')).toBe('-1');
    expect(photo?.getAttribute('aria-hidden')).toBe('true');
    expect(rows[0].querySelectorAll('a')).toHaveLength(2);
    // Its category in the category's colour, and the description's start.
    expect(rows[0].textContent).toContain('catalog.categories.tools');
    expect(rows[0].textContent).toContain('Works well');
    const row = rows[0].querySelector('.row') as HTMLElement;
    expect(row.style.getPropertyValue('--cat')).toBe('#c2410c');
  });

  it('says when there is nothing nearby', async () => {
    const { fixture, el, http } = await render();
    http.expectOne(SEARCH).flush({ items: [], nextCursor: null });
    await tick();
    await fixture.whenStable();
    expect(el.textContent).toContain('explore.empty');
  });

  it('switches between the list and the map', async () => {
    const { fixture, el, http } = await render();
    http.expectOne(SEARCH).flush({ items: [], nextCursor: null });
    const toggle = el.querySelector('button.view-toggle') as HTMLButtonElement;
    const pane = el.querySelector('.map-pane') as HTMLElement;
    expect(pane.classList).not.toContain('open');
    expect(pane.hasAttribute('inert')).toBe(true);

    toggle.click();
    await fixture.whenStable();
    expect(pane.classList).toContain('open');
    expect(pane.hasAttribute('inert')).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('searches with the filters in the URL, and keeps them there', async () => {
    const { fixture, http, router } = await render(
      '/explore?category=garden&radius=10',
    );
    const req = http.expectOne(SEARCH);
    expect(req.request.body).toEqual(
      expect.objectContaining({ category: 'garden', radiusKm: 10 }),
    );
    req.flush({ items: [], nextCursor: null });
    await fixture.whenStable();
    expect(router.url).toContain('category=garden');
    expect(router.url).toContain('radius=10');
    expect(router.url).not.toContain('lat');
  });

  it('shows featured items above the results', async () => {
    const { fixture, el, http } = await render();
    http
      .expectOne(FEATURED)
      .flush({ items: [publicItem('f', { title: 'Tent' })] });
    http.expectOne(SEARCH).flush({ items: [], nextCursor: null });
    await tick();
    await fixture.whenStable();
    const carousel = el.querySelector('bb-featured-carousel');
    expect(carousel?.textContent).toContain('Tent');
    expect(carousel?.querySelector('a')?.getAttribute('href')).toBe('/items/f');
  });

  it('leaves featured items out while searching for text', async () => {
    const { fixture, el, http } = await render('/explore?q=drill');
    http.expectOne(FEATURED).flush({ items: [publicItem('f')] });
    http.expectOne(SEARCH).flush({ items: [], nextCursor: null });
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('bb-featured-carousel')).toBeNull();
  });
});
