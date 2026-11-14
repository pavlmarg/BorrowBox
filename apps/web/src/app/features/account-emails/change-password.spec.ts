import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { UserProfileResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { testUser, tick, translations } from '../../../testing/auth';
import { ChangePassword } from './change-password';

const apiError = (status: number, code: string) =>
  [
    JSON.stringify({ statusCode: status, code, message: code }),
    { status, statusText: code },
  ] as const;

describe('ChangePassword', () => {
  async function render(user: UserProfileResponse = testUser) {
    TestBed.configureTestingModule({
      imports: [
        ChangePassword,
        TranslocoTestingModule.forRoot({
          langs: { el: translations('el'), en: translations('en') },
          translocoConfig: { availableLangs: ['el', 'en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { user: signal(user) } },
      ],
    });
    const fixture = TestBed.createComponent(ChangePassword);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      el,
      http: TestBed.inject(HttpTestingController),
      inputs: () => Array.from(el.querySelectorAll<HTMLInputElement>('input')),
      fill(current: string, next: string, confirm = next) {
        [current, next, confirm].forEach((value, i) => {
          const input = this.inputs()[i];
          input.value = value;
          input.dispatchEvent(new Event('input'));
        });
      },
      submit: () =>
        el.querySelector<HTMLButtonElement>('button[type=submit]')?.click(),
      settle: async () => {
        await tick();
        await fixture.whenStable();
      },
    };
  }

  it('changes the password, clears the form and says the other devices are signed out', async () => {
    const t = await render();
    t.fill('old pass 1', 'new pass 42');
    t.submit();

    const req = t.http.expectOne('/api/me/password');
    expect(req.request.body).toEqual({
      currentPassword: 'old pass 1',
      newPassword: 'new pass 42',
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await t.settle();

    expect(t.el.textContent).toContain('other devices have been signed out');
    expect(t.inputs().map((i) => i.value)).toEqual(['', '', '']);
    t.http.verify();
  });

  it('says when the current password is wrong', async () => {
    const t = await render();
    t.fill('wrong pass 1', 'new pass 42');
    t.submit();
    t.http
      .expectOne('/api/me/password')
      .flush(...apiError(401, 'INVALID_CREDENTIALS'));
    await t.settle();

    expect(t.el.textContent).toContain('current password isn’t right');
  });

  it('switches to the reset link when the account has no password after all', async () => {
    const t = await render();
    t.fill('old pass 1', 'new pass 42');
    t.submit();
    t.http
      .expectOne('/api/me/password')
      .flush(...apiError(409, 'PASSWORD_NOT_SET'));
    await t.settle();

    expect(t.el.querySelector('form')).toBeNull();
    expect(t.el.textContent).toContain('You sign in with Google');
  });

  it('emails a Google-only account a link to set a password', async () => {
    const t = await render({
      ...testUser,
      hasPassword: false,
      providers: ['google'],
    });
    expect(t.el.querySelector('form')).toBeNull();

    t.el.querySelector<HTMLButtonElement>('.actions button')?.click();
    const req = t.http.expectOne('/api/auth/password-reset');
    expect(req.request.body).toEqual({ email: testUser.email });
    req.flush(null, { status: 202, statusText: 'Accepted' });
    await t.settle();

    expect(t.el.textContent).toContain(
      `sent a link to ${testUser.email}. It works for 10 minutes`,
    );
    t.http.verify();
  });
});
