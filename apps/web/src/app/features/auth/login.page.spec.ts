import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { FormControl } from '@angular/forms';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { testUser, tick, translations } from '../../../testing/auth';
import { LoginPage } from './login.page';
import { passwordValidator } from './password.validator';

describe('LoginPage', () => {
  async function render(inputs: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [
        LoginPage,
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
    const fixture = TestBed.createComponent(LoginPage);
    for (const [k, v] of Object.entries(inputs))
      fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    return {
      fixture,
      el: fixture.nativeElement as HTMLElement,
      http: TestBed.inject(HttpTestingController),
      router: TestBed.inject(Router),
    };
  }

  const find = <T extends Element>(el: HTMLElement, selector: string): T => {
    const found = el.querySelector<T>(selector);
    if (!found) throw new Error(`No element matches ${selector}`);
    return found;
  };
  const type = (el: HTMLElement, selector: string, value: string) => {
    const input = find<HTMLInputElement>(el, selector);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = (el: HTMLElement) =>
    find<HTMLButtonElement>(el, 'button[type=submit]').click();

  it('shows translated validation errors and sends nothing when invalid', async () => {
    const { fixture, el, http } = await render();
    submit(el);
    await fixture.whenStable();
    expect(el.textContent).toContain('Required');
    http.verify();
  });

  it('signs in and follows a safe returnUrl', async () => {
    const { fixture, el, http, router } = await render({
      returnUrl: '/profile',
    });
    const navigate = jest
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);
    type(el, 'input[type=email]', 'ana@example.com');
    type(el, 'input[type=password]', 'correct horse 42');
    submit(el);

    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({
      email: 'ana@example.com',
      password: 'correct horse 42',
    });
    req.flush({
      accessToken: 'a',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      user: testUser,
    });
    await tick();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/profile');
  });

  it('shows the API error in the current language', async () => {
    const { fixture, el, http } = await render({
      returnUrl: 'https://evil.example',
    });
    type(el, 'input[type=email]', 'ana@example.com');
    type(el, 'input[type=password]', 'wrong');
    submit(el);
    http
      .expectOne('/api/auth/login')
      .flush(
        { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'Wrong email or password.',
    );
  });

  it('links Google sign-in to the gateway, not an XHR', async () => {
    const { el } = await render();
    expect(el.querySelector('bb-google-button a')?.getAttribute('href')).toBe(
      '/api/auth/google',
    );
  });
});

describe('passwordValidator', () => {
  it.each([
    ['correct horse 42', true],
    ['κωδικός9', true],
    ['short1', false],
    ['nodigitshere', false],
    ['12345678', false],
  ])('%p valid: %p', (value, valid) => {
    expect(passwordValidator(new FormControl(value)) === null).toBe(valid);
  });
});
