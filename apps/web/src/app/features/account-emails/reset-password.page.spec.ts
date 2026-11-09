import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { tick, translations } from '../../../testing/auth';
import { ResetPasswordPage } from './reset-password.page';

describe('ResetPasswordPage', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  async function render(url = '/auth/reset-password#t=reset-token') {
    window.history.replaceState(null, '', url);
    const auth = { signedOut: jest.fn() };
    TestBed.configureTestingModule({
      imports: [
        ResetPasswordPage,
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
    const fixture = TestBed.createComponent(ResetPasswordPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    return {
      el,
      auth,
      navigate,
      http: TestBed.inject(HttpTestingController),
      fill: (password: string, confirm = password) => {
        const [first, second] = Array.from(
          el.querySelectorAll<HTMLInputElement>('input'),
        );
        first.value = password;
        first.dispatchEvent(new Event('input'));
        second.value = confirm;
        second.dispatchEvent(new Event('input'));
      },
      submit: () =>
        el.querySelector<HTMLButtonElement>('button[type=submit]')?.click(),
      settle: async () => {
        await tick();
        await fixture.whenStable();
      },
    };
  }

  it('sets the new password, signs out locally and goes to sign in', async () => {
    const { http, fill, submit, settle, auth, navigate } = await render();
    expect(window.location.hash).toBe('');

    fill('new pass 42');
    submit();
    const req = http.expectOne('/api/auth/password-reset/confirm');
    expect(req.request.body).toEqual({
      token: 'reset-token',
      newPassword: 'new pass 42',
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(auth.signedOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], {
      queryParams: { reset: 1 },
      replaceUrl: true,
    });
    http.verify();
  });

  it('checks the shared password rule and the confirmation first', async () => {
    const { el, http, fill, submit, settle } = await render();
    fill('short', 'other');
    submit();
    await settle();

    expect(el.textContent).toContain('at least one letter and one digit');
    expect(el.textContent).toContain('Passwords don’t match');
    http.expectNone('/api/auth/password-reset/confirm');
  });

  it('offers a new link when this one expired', async () => {
    const { el, http, fill, submit, settle, auth } = await render();
    fill('new pass 42');
    submit();
    const body = { statusCode: 400, code: 'TOKEN_EXPIRED', message: 'x' };
    const req = http.expectOne('/api/auth/password-reset/confirm');
    req.flush(JSON.stringify(body), { status: 400, statusText: 'Bad Request' });
    await settle();

    expect(el.textContent).toContain('This link has expired');
    expect(el.querySelector('a[href="/auth/forgot-password"]')).not.toBeNull();
    expect(el.querySelector('form')).toBeNull();
    expect(auth.signedOut).not.toHaveBeenCalled();
  });

  it('without a token, shows the invalid link straight away', async () => {
    const { el } = await render('/auth/reset-password');
    expect(el.textContent).toContain('doesn’t work any more');
    expect(el.querySelector('form')).toBeNull();
  });
});
