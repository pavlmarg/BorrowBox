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
  return { fixture, button, theme: TestBed.inject(ThemeService) };
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

  it('offers dark while light, named for what it does', async () => {
    const { button } = await render();
    expect(button.getAttribute('aria-label')).toBe('theme.dark');
    expect(button.getAttribute('aria-haspopup')).toBeNull();
  });

  it('switches with one click each way, and remembers it', async () => {
    const { button, theme, fixture } = await render();
    button.click();
    await fixture.whenStable();
    expect(theme.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('bb.theme')).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('theme.light');

    button.click();
    await fixture.whenStable();
    expect(theme.theme()).toBe('light');
    expect(localStorage.getItem('bb.theme')).toBe('light');
  });
});
