import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { publicItem } from '../../../testing/catalog';
import {
  ADVANCE_EVERY_MS,
  FeaturedCarousel,
  RESUME_AFTER_MS,
} from './featured-carousel';

/**
 * jsdom lays nothing out, so the track's sizes and scrolling are faked:
 * 4 cards of 168 px (+12 px gap) in a 300 px wide row.
 */
async function render(options: { reducedMotion?: boolean } = {}) {
  window.matchMedia = jest.fn().mockReturnValue({
    matches: options.reducedMotion ?? false,
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
    ],
  });
  const fixture = TestBed.createComponent(FeaturedCarousel);
  fixture.componentRef.setInput(
    'items',
    ['a', 'b', 'c', 'd'].map((id) => publicItem(id)),
  );
  const el = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();
  const track = el.querySelector('.track') as HTMLElement;
  let left = 0;
  Object.defineProperties(track, {
    clientWidth: { value: 300 },
    scrollWidth: { value: 4 * 168 + 3 * 12 },
    scrollLeft: {
      get: () => left,
      set: (v: number) => (left = v),
    },
  });
  for (const li of Array.from(track.querySelectorAll('li'))) {
    li.getBoundingClientRect = () => ({ width: 168 }) as DOMRect;
  }
  track.scrollBy = jest.fn((o: ScrollToOptions) => {
    left += o.left ?? 0;
  }) as typeof track.scrollBy;
  track.scrollTo = jest.fn((o: ScrollToOptions) => {
    left = o.left ?? 0;
  }) as typeof track.scrollTo;
  await fixture.whenStable();
  track.dispatchEvent(new Event('scroll'));
  fixture.detectChanges();
  return {
    fixture,
    el,
    track,
    scrollBy: track.scrollBy as jest.Mock,
    scrollTo: track.scrollTo as jest.Mock,
    setLeft: (v: number) => (left = v),
    button: (selector: string) =>
      el.querySelector(selector) as HTMLButtonElement,
  };
}

describe('FeaturedCarousel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('moves on by one card every few seconds, and back to the start after the last', async () => {
    const { scrollBy, scrollTo, setLeft, track } = await render();
    jest.advanceTimersByTime(ADVANCE_EVERY_MS);
    expect(scrollBy).toHaveBeenCalledWith({ left: 180, behavior: 'smooth' });

    setLeft(track.scrollWidth - track.clientWidth);
    jest.advanceTimersByTime(ADVANCE_EVERY_MS);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });

  it('waits while pointed at or focused', async () => {
    const { el, scrollBy } = await render();
    const viewport = el.querySelector('.viewport') as HTMLElement;
    viewport.dispatchEvent(new Event('mouseenter'));
    jest.advanceTimersByTime(ADVANCE_EVERY_MS * 2);
    expect(scrollBy).not.toHaveBeenCalled();
    viewport.dispatchEvent(new Event('mouseleave'));

    const section = el.querySelector('section') as HTMLElement;
    section.dispatchEvent(new FocusEvent('focusin'));
    jest.advanceTimersByTime(ADVANCE_EVERY_MS * 2);
    expect(scrollBy).not.toHaveBeenCalled();
    section.dispatchEvent(new FocusEvent('focusout'));

    jest.advanceTimersByTime(ADVANCE_EVERY_MS);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('steps with the arrows, wrapping around, then waits before moving by itself', async () => {
    const { button, scrollBy, scrollTo, track } = await render();
    button('.arrow.prev').click();
    expect(scrollTo).toHaveBeenCalledWith({
      left: track.scrollWidth,
      behavior: 'smooth',
    });
    button('.arrow.next').click();
    expect(scrollBy).toHaveBeenCalledTimes(0);
    scrollTo.mockClear();

    track.scrollLeft = 0;
    button('.arrow.next').click();
    expect(scrollBy).toHaveBeenCalledWith({ left: 180, behavior: 'smooth' });

    jest.advanceTimersByTime(RESUME_AFTER_MS - 1);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(ADVANCE_EVERY_MS);
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it('stops with the pause button; the arrows then stop at the ends', async () => {
    const { fixture, button, scrollBy, scrollTo } = await render();
    const pause = button('.pause');
    expect(pause.getAttribute('aria-label')).toBe('explore.featured.pause');
    pause.click();
    fixture.detectChanges();
    expect(pause.getAttribute('aria-label')).toBe('explore.featured.play');

    jest.advanceTimersByTime(ADVANCE_EVERY_MS * 3);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(button('.arrow.prev').disabled).toBe(true);
    button('.arrow.prev').click();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('never moves by itself for reduced motion, and jumps instead of gliding', async () => {
    const { button, el, scrollBy } = await render({ reducedMotion: true });
    expect(el.querySelector('.pause')).toBeNull();
    jest.advanceTimersByTime(ADVANCE_EVERY_MS * 3);
    expect(scrollBy).not.toHaveBeenCalled();

    button('.arrow.next').click();
    expect(scrollBy).toHaveBeenCalledWith({ left: 180, behavior: 'auto' });
  });

  it('links each card to its item page', async () => {
    const { el } = await render();
    const links = Array.from(el.querySelectorAll('a.card'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/items/a',
      '/items/b',
      '/items/c',
      '/items/d',
    ]);
  });
});
