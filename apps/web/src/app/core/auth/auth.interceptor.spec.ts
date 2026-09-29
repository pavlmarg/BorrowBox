import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { session, setupAuth, tick } from '../../../testing/auth';

describe('authInterceptor', () => {
  async function signedIn(ttlMs?: number) {
    const ctx = setupAuth();
    const login = ctx.store.login({ email: 'a@b.c', password: 'pw' });
    ctx.http.expectOne('/api/auth/login').flush(session(1, ttlMs));
    await login;
    return { ...ctx, client: TestBed.inject(HttpClient) };
  }

  it('adds the bearer token to API calls but never to /api/auth/*', async () => {
    const { client, http } = await signedIn();

    const me = firstValueFrom(client.get('/api/me'));
    await tick();
    const meReq = http.expectOne('/api/me');
    expect(meReq.request.headers.get('Authorization')).toBe('Bearer access-1');
    meReq.flush({});
    await me;

    const logout = firstValueFrom(client.post('/api/auth/logout', {}));
    const logoutReq = http.expectOne('/api/auth/logout');
    expect(logoutReq.request.headers.has('Authorization')).toBe(false);
    logoutReq.flush(null);
    await logout;

    const i18n = firstValueFrom(client.get('/i18n/el.json'));
    expect(
      http.expectOne('/i18n/el.json').request.headers.has('Authorization'),
    ).toBe(false);
    http.match('/i18n/el.json');
    void i18n.catch(() => undefined);
  });

  it('on 401 UNAUTHENTICATED refreshes once and retries with the new token', async () => {
    const { client, http } = await signedIn();

    const call = firstValueFrom(client.get('/api/me'));
    await tick();
    http
      .expectOne('/api/me')
      .flush(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'x' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await tick();
    http.expectOne('/api/auth/refresh').flush(session(2));
    await tick();
    const retry = http.expectOne('/api/me');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer access-2');
    retry.flush({ ok: true });

    await expect(call).resolves.toEqual({ ok: true });
    http.verify();
  });

  it('does not refresh for other 401s, e.g. a wrong password on account deletion', async () => {
    const { client, http } = await signedIn();
    const call = firstValueFrom(
      client.delete('/api/me', { body: { password: 'x' } }),
    );
    await tick();
    http.expectOne('/api/me').flush(
      {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Wrong password',
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    await expect(call).rejects.toMatchObject({ status: 401 });
    http.verify();
  });

  it('refreshes before sending when the token is about to expire', async () => {
    const { client, http } = await signedIn(10_000); // inside the 30 s margin
    const call = firstValueFrom(client.get('/api/me'));
    await tick();
    http.expectOne('/api/auth/refresh').flush(session(3));
    await tick();
    const req = http.expectOne('/api/me');
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-3');
    req.flush({});
    await call;
  });

  it('sends the user to login when the refresh fails', async () => {
    const { client, http, store } = await signedIn();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    const call = firstValueFrom(client.get('/api/me'));
    await tick();
    http
      .expectOne('/api/me')
      .flush(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'x' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await tick();
    http
      .expectOne('/api/auth/refresh')
      .flush(
        { statusCode: 401, code: 'INVALID_REFRESH_TOKEN', message: 'x' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(call).rejects.toMatchObject({ status: 401 });
    expect(store.status()).toBe('anonymous');
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], expect.anything());
  });
});
