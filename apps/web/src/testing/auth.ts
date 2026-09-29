// Test-only helpers (excluded from the app build).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Translation } from '@jsverse/transloco';
import type { AuthResponse, UserProfileResponse } from '../app/api/models';
import { AuthChannel, type AuthMessage } from '../app/core/auth/auth-channel';
import { authInterceptor } from '../app/core/auth/auth.interceptor';
import { AuthStore } from '../app/core/auth/auth.store';

export const testUser: UserProfileResponse = {
  id: 'u-1',
  email: 'ana@example.com',
  displayName: 'Ana',
  locale: 'el',
  emailVerified: false,
  hasPassword: true,
  providers: [],
  createdAt: '2026-09-01T10:00:00.000Z',
};

export const session = (n: number, ttlMs = 15 * 60_000): AuthResponse => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: new Date(Date.now() + ttlMs).toISOString(),
  user: testUser,
});

/** Records broadcasts instead of using a real BroadcastChannel. */
export class FakeAuthChannel extends AuthChannel {
  readonly posted: AuthMessage[] = [];
  override post(message: AuthMessage): void {
    this.posted.push(message);
  }
}

/** AuthStore with the real interceptor over HttpTestingController. */
export function setupAuth() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: AuthChannel, useClass: FakeAuthChannel },
    ],
  });
  return {
    store: TestBed.inject(AuthStore),
    http: TestBed.inject(HttpTestingController),
    channel: TestBed.inject(AuthChannel) as FakeAuthChannel,
  };
}

/** Lets pending promise callbacks run. */
export const tick = () => new Promise((r) => setTimeout(r, 0));

export const unauthorized = (code: string) =>
  [
    { statusCode: 401, code, message: code },
    { status: 401, statusText: 'Unauthorized' },
  ] as const;

export function translations(lang: 'el' | 'en'): Translation {
  return JSON.parse(
    readFileSync(join(__dirname, '../../public/i18n', `${lang}.json`), 'utf8'),
  );
}
