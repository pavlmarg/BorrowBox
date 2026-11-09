import { takeLinkToken } from './link-token';

describe('takeLinkToken', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('reads the token and removes the fragment from the address bar', () => {
    window.history.replaceState(
      { navigationId: 1 },
      '',
      '/auth/verify-email?x=1#t=abc_DEF-1',
    );

    expect(takeLinkToken(document)).toBe('abc_DEF-1');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe(
      '/auth/verify-email?x=1',
    );
    // The router's history state is kept.
    expect(window.history.state).toEqual({ navigationId: 1 });
  });

  it('is null without a token, e.g. after a reload', () => {
    window.history.replaceState(null, '', '/auth/reset-password');
    expect(takeLinkToken(document)).toBeNull();

    window.history.replaceState(null, '', '/auth/reset-password#other=1');
    expect(takeLinkToken(document)).toBeNull();
    expect(window.location.hash).toBe('');
  });
});
