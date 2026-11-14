import { TestBed } from '@angular/core/testing';
import {
  ThemeService,
  applyInitialTheme,
  resolveTheme,
  storedThemePreference,
} from './theme';

/** A device whose dark-mode setting the test can flip. */
function fakeDevice(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
      listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
      listeners.delete(fn),
  };
  window.matchMedia = jest.fn().mockReturnValue(query);
  return {
    listeners,
    set(next: boolean) {
      query.matches = next;
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
    },
  };
}

const shown = () => document.documentElement.getAttribute('data-theme');

describe('theme', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  describe('the stored preference', () => {
    it('defaults to the device', () => {
      expect(storedThemePreference()).toBe('system');
    });

    it('returns a saved choice and ignores anything else', () => {
      localStorage.setItem('bb.theme', 'dark');
      expect(storedThemePreference()).toBe('dark');
      localStorage.setItem('bb.theme', 'purple');
      expect(storedThemePreference()).toBe('system');
    });

    it('follows the device when storage throws', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(storedThemePreference()).toBe('system');
    });
  });

  it('resolves "system" from the device', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  describe('before Angular starts', () => {
    it("marks <html> with the device's theme by default", () => {
      fakeDevice(true);
      applyInitialTheme();
      expect(shown()).toBe('dark');
    });

    it('marks <html> with the saved choice', () => {
      fakeDevice(true);
      localStorage.setItem('bb.theme', 'light');
      applyInitialTheme();
      expect(shown()).toBe('light');
    });

    it('works without matchMedia', () => {
      window.matchMedia = undefined as unknown as typeof window.matchMedia;
      applyInitialTheme();
      expect(shown()).toBe('light');
    });
  });

  describe('ThemeService', () => {
    it('follows the device while on "system"', () => {
      const device = fakeDevice(false);
      const theme = TestBed.inject(ThemeService);
      expect(theme.preference()).toBe('system');
      expect(shown()).toBe('light');

      device.set(true);
      expect(theme.theme()).toBe('dark');
      expect(shown()).toBe('dark');
    });

    it('saves and applies a choice, which then ignores the device', () => {
      const device = fakeDevice(false);
      const theme = TestBed.inject(ThemeService);

      theme.use('dark');
      expect(shown()).toBe('dark');
      expect(localStorage.getItem('bb.theme')).toBe('dark');

      device.set(false);
      expect(shown()).toBe('dark');
    });

    it('starts from the saved choice', () => {
      fakeDevice(true);
      localStorage.setItem('bb.theme', 'light');
      const theme = TestBed.inject(ThemeService);
      expect(theme.preference()).toBe('light');
      expect(shown()).toBe('light');
    });

    it('still switches when storage throws', () => {
      fakeDevice(false);
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const theme = TestBed.inject(ThemeService);
      theme.use('dark');
      expect(theme.preference()).toBe('dark');
      expect(shown()).toBe('dark');
    });

    it('stops listening to the device when destroyed', () => {
      const device = fakeDevice(false);
      TestBed.inject(ThemeService);
      expect(device.listeners.size).toBe(1);
      TestBed.resetTestingModule();
      expect(device.listeners.size).toBe(0);
    });
  });
});
