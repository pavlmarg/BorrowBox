import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { ThemeService } from './theme';
import { ThemeToggle } from './theme-toggle';

async function render() {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
    ],
  });
  const fixture = TestBed.createComponent(ThemeToggle);
  await fixture.whenStable();
  const button = (fixture.nativeElement as HTMLElement).querySelector(
    'button.toggle',
  ) as HTMLButtonElement;
  const open = async () => {
    button.click();
    await fixture.whenStable();
    return [...document.querySelectorAll<HTMLButtonElement>('.theme-choice')];
  };
  return { fixture, button, open, theme: TestBed.inject(ThemeService) };
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
  });
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('names the current choice and opens a menu', async () => {
    const { button } = await render();
    expect(button.getAttribute('aria-label')).toBe('theme.button');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('offers the three choices, the current one checked', async () => {
    const { open } = await render();
    const items = await open();
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'theme.system',
      'theme.light',
      'theme.dark',
    ]);
    expect(items.map((i) => i.getAttribute('role'))).toEqual([
      'menuitemradio',
      'menuitemradio',
      'menuitemradio',
    ]);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('switches to the chosen theme', async () => {
    const { open, theme, fixture } = await render();
    const items = await open();
    items[2].click();
    await fixture.whenStable();
    expect(theme.preference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('bb.theme')).toBe('dark');

    const again = await open();
    expect(again[2].getAttribute('aria-checked')).toBe('true');
  });
});
