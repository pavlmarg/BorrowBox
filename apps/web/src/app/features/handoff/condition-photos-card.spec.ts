import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import type { ConditionPhotoResponse } from '../../api/models';
import { booking } from '../../../testing/bookings';
import { ConditionPhotosCard, photoProblemKey } from './condition-photos-card';
import { ConditionPhotosStore } from './condition-photos.store';

const photo = (
  over: Partial<ConditionPhotoResponse> = {},
): ConditionPhotoResponse => ({
  id: 'p1',
  phase: 'PICKUP',
  status: 'READY',
  mine: true,
  takenBy: 'LENDER',
  takenAt: '2026-11-20T07:00:00.000Z',
  urls: { thumb: 'https://e.test/t1', large: 'https://e.test/l1' },
  urlsExpireAt: new Date(Date.now() + 300_000).toISOString(),
  ...over,
});

async function render(
  photos: ConditionPhotoResponse[],
  canAdd = { PICKUP: true, RETURN: false },
) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      ConditionPhotosStore,
    ],
  });
  const loading = TestBed.inject(ConditionPhotosStore).load('b-1');
  TestBed.inject(HttpTestingController)
    .expectOne('/api/bookings/b-1/photos')
    .flush({ photos, canAdd });
  await loading;
  const fixture = TestBed.createComponent(ConditionPhotosCard);
  fixture.componentRef.setInput('booking', booking({ status: 'PAID' }));
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('photoProblemKey', () => {
  it('reuses the listing words for file problems, own words otherwise', () => {
    expect(photoProblemKey('tooSmall')).toBe('listing.photoErrors.tooSmall');
    expect(photoProblemKey('REJECTED')).toBe('handoff.photos.rejected');
    expect(photoProblemKey('PHOTO_LIMIT_REACHED')).toBe('handoff.photos.limit');
    expect(photoProblemKey('NOT_FOUND')).toBe('bookings.errors.NOT_FOUND');
  });
});

describe('ConditionPhotosCard', () => {
  it('stays hidden without photos or an open window', async () => {
    const { el, fixture } = await render([], { PICKUP: false, RETURN: false });
    expect(el.textContent?.trim()).toBe('');
    fixture.destroy();
  });

  it('shows both people’s photos with who took them, and the add button', async () => {
    const { el, fixture } = await render([
      photo(),
      photo({
        id: 'p2',
        mine: false,
        takenBy: 'RENTER',
        status: 'PENDING',
        urls: null,
      }),
    ]);
    expect(el.querySelectorAll('li.photo')).toHaveLength(2);
    expect(el.querySelector('a.thumb')?.getAttribute('href')).toBe(
      'https://e.test/l1',
    );
    expect(el.textContent).toContain('handoff.photos.byYou');
    expect(el.textContent).toContain('handoff.photos.by.RENTER');
    expect(el.textContent).toContain('handoff.photos.processing');
    expect(el.textContent).toContain('handoff.photos.add');
    // Remove only on one's own photo.
    expect(el.querySelectorAll('button.remove')).toHaveLength(1);
    fixture.destroy();
  });

  it('hides adding once three are mine, and removing once the window closed', async () => {
    const mine = [1, 2, 3].map((n) => photo({ id: `p${n}` }));
    const { el, fixture } = await render(mine, {
      PICKUP: false,
      RETURN: false,
    });
    expect(el.textContent).not.toContain('handoff.photos.add');
    expect(el.querySelectorAll('button.remove')).toHaveLength(0);
    fixture.destroy();
  });
});
