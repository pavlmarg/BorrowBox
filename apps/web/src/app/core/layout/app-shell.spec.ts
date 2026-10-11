import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { AuthStore } from '../auth/auth.store';
import { AppShell } from './app-shell';

@Component({ template: '' })
class Blank {}

async function render(signedIn: boolean, url = '/explore?q=drill') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'explore', component: Blank, data: { fullBleed: true } },
        { path: 'profile', component: Blank },
      ]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: AuthStore,
        useValue: {
          isAuthenticated: signal(signedIn),
          user: signal(null),
          logout: () => Promise.resolve(),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(AppShell);
  await TestBed.inject(Router).navigateByUrl(url);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const links = [...el.querySelectorAll('nav a, nav button')].map((a) => ({
    text: a.textContent?.trim() ?? '',
    href: a.getAttribute('href'),
  }));
  return { el, links };
}

describe('AppShell', () => {
  it('offers sign-in to visitors, coming back to the same search', async () => {
    const { links } = await render(false);
    const texts = links.map((l) => l.text);
    expect(texts).toContain('nav.login');
    expect(texts).toContain('nav.register');
    expect(texts).not.toContain('nav.profile');
    expect(texts).not.toContain('nav.settings');
    expect(texts).not.toContain('nav.logout');
    expect(links.find((l) => l.text === 'nav.login')?.href).toBe(
      '/auth/login?returnUrl=%2Fexplore%3Fq%3Ddrill',
    );
  });

  it('shows the account pages once signed in', async () => {
    const { links } = await render(true);
    const texts = links.map((l) => l.text);
    expect(texts).toEqual(
      expect.arrayContaining(['nav.profile', 'nav.settings', 'nav.logout']),
    );
    expect(texts).not.toContain('nav.login');
  });

  it('gives full-bleed pages the whole area', async () => {
    const wide = await render(true, '/explore');
    expect(wide.el.querySelector('main')?.classList).toContain('full-bleed');
    TestBed.resetTestingModule();
    const narrow = await render(true, '/profile');
    expect(narrow.el.querySelector('main')?.classList).not.toContain(
      'full-bleed',
    );
  });
});
