import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import type { UserProfileResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { tick } from '../../../testing/auth';
import { SettingsPage } from './settings.page';

const user = (
  overrides: Partial<UserProfileResponse> = {},
): UserProfileResponse => ({
  id: 'u-1',
  email: 'ana@example.com',
  displayName: 'Ana',
  locale: 'en',
  emailVerified: true,
  hasPassword: true,
  providers: [],
  photo: null,
  photoUpload: null,
  bio: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

async function render(profile: UserProfileResponse, confirm = false) {
  const current = signal(profile);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MatDialog,
        useValue: { open: jest.fn(() => ({ afterClosed: () => of(confirm) })) },
      },
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: AuthStore,
        useValue: {
          user: current,
          isAuthenticated: signal(true),
          updateUser: (u: UserProfileResponse) => current.set(u),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(SettingsPage);
  await fixture.whenStable();
  TestBed.inject(HttpTestingController)
    .match('/api/me')
    .forEach((r) => r.flush(profile));
  await tick();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('SettingsPage', () => {
  it('has one headed section per topic, reachable from the jump menu', async () => {
    const el = await render(user());
    const ids = [...el.querySelectorAll('section.section')].map((s) => s.id);
    expect(ids).toEqual([
      'photo',
      'details',
      'password',
      'appearance',
      'payouts',
      'data',
      'delete',
    ]);
    for (const s of el.querySelectorAll('section.section')) {
      expect(s.querySelector('h2')).not.toBeNull();
      expect(s.querySelector('.info')).not.toBeNull();
    }
    const links = [...el.querySelectorAll('nav.jump a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(ids.map((id) => `/settings#${id}`));
    // The sign-in methods list is gone.
    expect(el.textContent).not.toContain('profile.signIn');
  });

  it('changes the password on its own page', async () => {
    const el = await render(user());
    const link = el.querySelector('#password a');
    expect(link?.getAttribute('href')).toBe('/settings/password');
    expect(link?.textContent).toContain('settings.password.change');
    expect(el.querySelector('bb-change-password')).toBeNull();
  });

  it('offers Google-only accounts to set a password', async () => {
    const el = await render(
      user({ hasPassword: false, providers: ['google'] }),
    );
    expect(el.querySelector('#password a')?.textContent).toContain(
      'settings.password.set',
    );
  });

  it('puts the photo buttons below the photo, Remove only with a photo', async () => {
    const without = await render(user());
    expect(without.querySelectorAll('#photo .pill').length).toBe(1);
    TestBed.resetTestingModule();
    const withPhoto = await render(
      user({ photo: { small: 's.webp', large: 'l.webp' } }),
    );
    const pills = withPhoto.querySelectorAll('#photo .pill');
    expect([...pills].map((p) => p.textContent?.trim())).toEqual([
      'profile.photo.change',
      'profile.photo.remove',
    ]);
    expect(pills[1].classList).toContain('danger');
  });

  it.each([
    [false, 0],
    [true, 1],
  ])(
    'asks before removing the photo (confirmed: %s)',
    async (confirm, deletes) => {
      const el = await render(
        user({ photo: { small: 's.webp', large: 'l.webp' } }),
        confirm,
      );
      (el.querySelector('#photo .pill.danger') as HTMLButtonElement).click();
      await tick();
      expect(TestBed.inject(MatDialog).open).toHaveBeenCalledTimes(1);
      const requests = TestBed.inject(HttpTestingController).match(
        (r) => r.method === 'DELETE' && r.url === '/api/me/photo',
      );
      expect(requests.length).toBe(deletes);
    },
  );
});
