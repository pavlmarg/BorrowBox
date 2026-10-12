import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { HowItWorks, STEP_EVERY_MS } from './how-it-works';

async function render(options: { reducedMotion?: boolean } = {}) {
  window.matchMedia = jest.fn().mockReturnValue({
    matches: options.reducedMotion ?? false,
  });
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
    ],
  });
  const fixture = TestBed.createComponent(HowItWorks);
  const el = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();
  await fixture.whenStable();
  const caption = () => {
    fixture.detectChanges();
    return el.querySelector('.caption strong')?.textContent ?? '';
  };
  return { fixture, el, caption };
}

describe('HowItWorks', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('moves through the three steps by itself, then starts over', async () => {
    const { caption } = await render();
    expect(caption()).toContain('explore.how.find.title');
    jest.advanceTimersByTime(STEP_EVERY_MS);
    expect(caption()).toContain('explore.how.pay.title');
    jest.advanceTimersByTime(STEP_EVERY_MS);
    expect(caption()).toContain('explore.how.handoff.title');
    jest.advanceTimersByTime(STEP_EVERY_MS);
    expect(caption()).toContain('explore.how.find.title');
  });

  it('waits while pointed at, and stops with the pause button', async () => {
    const { el, caption } = await render();
    const section = el.querySelector('section') as HTMLElement;
    section.dispatchEvent(new Event('mouseenter'));
    jest.advanceTimersByTime(STEP_EVERY_MS * 2);
    expect(caption()).toContain('explore.how.find.title');
    section.dispatchEvent(new Event('mouseleave'));

    (el.querySelector('.pause') as HTMLButtonElement).click();
    jest.advanceTimersByTime(STEP_EVERY_MS * 2);
    expect(caption()).toContain('explore.how.find.title');
  });

  it('shows a step picked with its dot', async () => {
    const { el, caption } = await render();
    const dots = el.querySelectorAll<HTMLButtonElement>('.dot');
    expect(dots).toHaveLength(3);
    dots[2].click();
    expect(caption()).toContain('explore.how.handoff.title');
    expect(dots[2].getAttribute('aria-current')).toBe('step');
  });

  it('never moves by itself for reduced motion', async () => {
    const { el, caption } = await render({ reducedMotion: true });
    expect(el.querySelector('.pause')).toBeNull();
    jest.advanceTimersByTime(STEP_EVERY_MS * 3);
    expect(caption()).toContain('explore.how.find.title');
  });
});
