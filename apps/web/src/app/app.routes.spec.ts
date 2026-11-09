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
    ['/', false, '/explore'],
    ['/unknown/page', false, '/explore'],
    ['/auth', false, '/auth/register'],
    ['/', true, '/explore'],
    ['/unknown/page', true, '/explore'],
    ['/explore', false, '/explore'],
    ['/settings', true, '/settings'],
    ['/settings', false, '/auth/login?returnUrl=%2Fsettings'],
    [
      '/bookings/b-1/pay',
      false,
      '/auth/login?returnUrl=%2Fbookings%2Fb-1%2Fpay',
    ],
  ])('%s (signed in: %s) lands on %s', async (url, signedIn, expected) => {
    expect(await landOn(url, signedIn)).toBe(expected);
  });

  it("drops Stripe's return parameters from the login's returnUrl", async () => {
    expect(
      await landOn(
        '/bookings/b-1/pay?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_x&redirect_status=succeeded',
        false,
      ),
    ).toBe('/auth/login?returnUrl=%2Fbookings%2Fb-1%2Fpay');
  });

  it('still sends a protected deep link to login, keeping where it was going', async () => {
    expect(await landOn('/profile?tab=data', false)).toBe(
      '/auth/login?returnUrl=%2Fprofile%3Ftab%3Ddata',
    );
  });
});
