import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { ITEM_CATEGORIES } from '@borrowbox/contracts';
import { CategoryRail } from './category-rail';
import { ExploreStore } from './explore.store';

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
  const fixture = TestBed.createComponent(CategoryRail);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const buttons = () => [...el.querySelectorAll('button')];
  return { fixture, store: TestBed.inject(ExploreStore), buttons };
}

describe('CategoryRail', () => {
  it('lists "All" and every category, each in its colour', async () => {
    const { buttons } = await render();
    expect(buttons()).toHaveLength(ITEM_CATEGORIES.length + 1);
    expect(buttons()[0].getAttribute('aria-pressed')).toBe('true');
    const tools = buttons().find((b) =>
      b.textContent?.includes('catalog.categories.tools'),
    ) as HTMLButtonElement;
    expect(tools.style.getPropertyValue('--cat')).toBe('#c2410c');
  });

  it('sets the Category filter, and "All" clears it', async () => {
    const { fixture, store, buttons } = await render();
    const garden = buttons().find((b) =>
      b.textContent?.includes('catalog.categories.garden'),
    ) as HTMLButtonElement;
    garden.click();
    await fixture.whenStable();
    expect(store.filters().category).toBe('garden');
    expect(garden.getAttribute('aria-pressed')).toBe('true');

    buttons()[0].click();
    await fixture.whenStable();
    expect(store.filters().category).toBeNull();
  });
});
