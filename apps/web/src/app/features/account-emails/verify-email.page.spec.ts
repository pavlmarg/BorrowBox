import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { UserProfileResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { testUser, tick, translations } from '../../../testing/auth';
import { VerifyEmailPage } from './verify-email.page';

const apiError = (status: number, code: string) =>
  [
    { statusCode: status, code, message: code },
    { status, statusText: code },
  ] as const;

describe('VerifyEmailPage', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  async function render({
    url = '/auth/verify-email#t=good-token',
    user = null as UserProfileResponse | null,
  } = {}) {
    window.history.replaceState(null, '', url);
    const userSignal = signal(user);
    const auth = {
      init: jest.fn().mockResolvedValue(undefined),
      user: userSignal,
      isAuthenticated: signal(user !== null),
      updateUser: jest.fn((u: UserProfileResponse) => userSignal.set(u)),
    };
    TestBed.configureTestingModule({
      imports: [
        VerifyEmailPage,
        TranslocoTestingModule.forRoot({
          langs: { el: translations('el'), en: translations('en') },
          translocoConfig: { availableLangs: ['el', 'en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthStore, useValue: auth },
      ],
    });
    const fixture = TestBed.createComponent(VerifyEmailPage);
    fixture.detectChanges();
    await tick();
    const http = TestBed.inject(HttpTestingController);
    const settle = async () => {
      await tick();
      await fixture.whenStable();
    };
    return {
      fixture,
      el: fixture.nativeElement as HTMLElement,
      http,
      auth,
      settle,
    };
  }

  it('takes the token from the fragment, hides it and confirms the email', async () => {
    const { el, http, settle, auth } = await render();
    expect(window.location.hash).toBe('');
    expect(el.textContent).toContain('Confirming your email');

    const req = http.expectOne('/api/auth/verify-email');
    expect(req.request.body).toEqual({ token: 'good-token' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(el.textContent).toContain('Your email is confirmed');
    // Signed out: no profile to refresh, and the way on is signing in.
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(el.querySelector('a[href="/auth/login"]')).not.toBeNull();
    http.verify();
  });

  it('signed in, refreshes the profile so the app knows the email is verified', async () => {
    const { el, http, settle, auth } = await render({ user: testUser });
    http
      .expectOne('/api/auth/verify-email')
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    http.expectOne('/api/me').flush({ ...testUser, emailVerified: true });
    await settle();

    expect(auth.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true }),
    );
    expect(el.querySelector('a[href="/profile"]')).not.toBeNull();
    http.verify();
  });

  it('offers a signed-in user a new link when this one expired', async () => {
    const { el, http, settle } = await render({ user: testUser });
    http
      .expectOne('/api/auth/verify-email')
      .flush(...apiError(400, 'TOKEN_EXPIRED'));
    await settle();
    expect(el.textContent).toContain('This link has expired');

    el.querySelector<HTMLButtonElement>('.actions button')?.click();
    http
      .expectOne('/api/me/verification-email')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await settle();

    expect(el.textContent).toContain(`sent a new link to ${testUser.email}`);
    http.verify();
  });

  it('asks a signed-out user to sign in for a new link', async () => {
    const { el, http, settle } = await render();
    http
      .expectOne('/api/auth/verify-email')
      .flush(...apiError(400, 'TOKEN_INVALID'));
    await settle();

    expect(el.textContent).toContain('doesn’t work any more');
    expect(el.textContent).toContain('Sign in and ask for a new link');
    expect(
      el.querySelector('a[href="/auth/login?returnUrl=%2Fsettings"]'),
    ).not.toBeNull();
  });

  it('says so when a used link belongs to an account that is already verified', async () => {
    const { el, http, settle } = await render({
      user: { ...testUser, emailVerified: true },
    });
    http
      .expectOne('/api/auth/verify-email')
      .flush(...apiError(400, 'TOKEN_INVALID'));
    await settle();

    expect(el.textContent).toContain('Your email is already confirmed');
  });

  it('without a token, sends nothing and explains the link is invalid', async () => {
    const { el, http, settle } = await render({ url: '/auth/verify-email' });
    await settle();
    http.expectNone('/api/auth/verify-email');
    expect(el.textContent).toContain('doesn’t work any more');
  });

  it('lets the user try again after a rate limit, with the same token', async () => {
    const { el, http, settle } = await render();
    http
      .expectOne('/api/auth/verify-email')
      .flush(...apiError(429, 'RATE_LIMITED'));
    await settle();
    expect(el.textContent).toContain('Too many attempts');

    el.querySelector<HTMLButtonElement>('.actions button')?.click();
    const retry = http.expectOne('/api/auth/verify-email');
    expect(retry.request.body).toEqual({ token: 'good-token' });
    retry.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(el.textContent).toContain('Your email is confirmed');
  });
});
