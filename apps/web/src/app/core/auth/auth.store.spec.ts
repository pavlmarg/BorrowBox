import {
  session,
  setupAuth,
  testUser,
  tick,
  unauthorized,
} from '../../../testing/auth';

describe('AuthStore', () => {
  it('starts unknown and becomes anonymous when there is no refresh cookie', async () => {
    const { store, http } = setupAuth();
    expect(store.status()).toBe('unknown');

    const init = store.init();
    await tick();
    http
      .expectOne({ method: 'POST', url: '/api/auth/refresh' })
      .flush(...unauthorized('INVALID_REFRESH_TOKEN'));
    await init;

    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
    http.verify();
  });

  it('keeps the access token in memory only, and tells other tabs about the sign-in', async () => {
    const { store, http, channel } = setupAuth();
    const login = store.login({ email: 'ana@example.com', password: 'pw' });
    http.expectOne('/api/auth/login').flush(session(1));
    await login;

    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('access-1');
    expect(store.user()).toEqual(testUser);
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain('access-1');
    expect(channel.posted).toEqual([
      {
        type: 'session',
        session: expect.objectContaining({ accessToken: 'access-1' }),
      },
    ]);
  });

  it('sends one refresh when several callers refresh at once (refresh tokens are single-use)', async () => {
    const { store, http } = setupAuth();
    const results = Promise.all([
      store.refresh(),
      store.refresh(),
      store.refresh(),
    ]);
    await tick();
    http.expectOne('/api/auth/refresh').flush(session(2));
    expect(await results).toEqual([true, true, true]);
    expect(store.accessToken()).toBe('access-2');
    http.verify();
  });

  it('adopts sessions and logouts broadcast by other tabs', () => {
    const { store, channel } = setupAuth();
    channel.messages.next({ type: 'session', session: session(7) });
    expect(store.accessToken()).toBe('access-7');

    channel.messages.next({ type: 'logout' });
    expect(store.status()).toBe('anonymous');
    expect(store.user()).toBeNull();
    expect(channel.posted).toEqual([]); // no echo back
  });

  it('logout clears the session even if the call fails, and tells other tabs', async () => {
    const { store, http, channel } = setupAuth();
    const login = store.login({ email: 'a@b.c', password: 'pw' });
    http.expectOne('/api/auth/login').flush(session(1));
    await login;

    const logout = store.logout();
    http
      .expectOne('/api/auth/logout')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await expect(logout).rejects.toBeDefined();

    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
    expect(channel.posted.at(-1)).toEqual({ type: 'logout' });
  });

  it('does not sign out on a network error during refresh', async () => {
    const { store, http } = setupAuth();
    const login = store.login({ email: 'a@b.c', password: 'pw' });
    http.expectOne('/api/auth/login').flush(session(1));
    await login;

    const refresh = store.refresh();
    await tick();
    http
      .expectOne('/api/auth/refresh')
      .error(new ProgressEvent('error'), { status: 0 });
    expect(await refresh).toBe(false);
    expect(store.isAuthenticated()).toBe(true);
  });
});
