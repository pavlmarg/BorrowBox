import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { appRoutes } from './app.routes';
import { AuthStore } from './core/auth/auth.store';

describe('start page', () => {
  async function landOn(url: string, signedIn: boolean): Promise<string> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(appRoutes),
        {
          provide: AuthStore,
          useValue: {
            isAuthenticated: signal(signedIn),
            init: () => Promise.resolve(),
          },
        },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router.url;
  }

  it.each([
    ['/', false, '/auth/register'],
    ['/unknown/page', false, '/auth/register'],
    ['/auth', false, '/auth/register'],
    ['/', true, '/profile'],
    ['/unknown/page', true, '/profile'],
    ['/settings', true, '/settings'],
    ['/settings', false, '/auth/login?returnUrl=%2Fsettings'],
  ])('%s (signed in: %s) lands on %s', async (url, signedIn, expected) => {
    expect(await landOn(url, signedIn)).toBe(expected);
  });

  it('still sends a protected deep link to login, keeping where it was going', async () => {
    expect(await landOn('/profile?tab=data', false)).toBe(
      '/auth/login?returnUrl=%2Fprofile%3Ftab%3Ddata',
    );
  });
});
