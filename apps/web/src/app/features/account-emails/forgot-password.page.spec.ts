import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { tick, translations } from '../../../testing/auth';
import { ForgotPasswordPage } from './forgot-password.page';

describe('ForgotPasswordPage', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  async function render(state: unknown = null) {
    window.history.replaceState(state, '', '/auth/forgot-password');
    TestBed.configureTestingModule({
      imports: [
        ForgotPasswordPage,
        TranslocoTestingModule.forRoot({
          langs: { el: translations('el'), en: translations('en') },
          translocoConfig: { availableLangs: ['el', 'en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      http: TestBed.inject(HttpTestingController),
      input: el.querySelector<HTMLInputElement>(
        'input[type=email]',
      ) as HTMLInputElement,
      settle: async () => {
        await tick();
        await fixture.whenStable();
      },
    };
  }
  const submit = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>('button[type=submit]')?.click();

  it('always answers with the same message once the request went through', async () => {
    const { el, http, input, settle } = await render();
    input.value = ' ana@example.com ';
    input.dispatchEvent(new Event('input'));
    submit(el);

    const req = http.expectOne('/api/auth/password-reset');
    expect(req.request.body).toEqual({ email: 'ana@example.com' });
    req.flush(null, { status: 202, statusText: 'Accepted' });
    await settle();

    expect(el.textContent).toContain('Check your email');
    expect(el.textContent).toContain(
      'If there’s an account for ana@example.com',
    );
    http.verify();
  });

  it('starts with the address typed on the login page', async () => {
    const { input } = await render({ email: 'ana@example.com' });
    expect(input.value).toBe('ana@example.com');
  });

  it('checks the address before sending, and shows a rate limit', async () => {
    const { el, http, input, settle } = await render();
    submit(el);
    await settle();
    expect(el.textContent).toContain('Required');
    http.expectNone('/api/auth/password-reset');

    input.value = 'ana@example.com';
    input.dispatchEvent(new Event('input'));
    submit(el);
    http
      .expectOne('/api/auth/password-reset')
      .flush(
        JSON.stringify({ statusCode: 429, code: 'RATE_LIMITED', message: 'x' }),
        { status: 429, statusText: 'Too Many Requests' },
      );
    await settle();
    expect(el.textContent).toContain('Too many attempts');
    expect(el.textContent).not.toContain('Check your email');
  });
});
