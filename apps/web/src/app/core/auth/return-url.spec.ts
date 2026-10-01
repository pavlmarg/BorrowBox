import {
  DEFAULT_AFTER_LOGIN,
  rememberReturnUrl,
  safeReturnUrl,
  takeReturnUrl,
} from './return-url';

describe('safeReturnUrl', () => {
  it.each(['/profile', '/items/42?tab=photos', '/a/b#c'])('keeps %p', (url) =>
    expect(safeReturnUrl(url)).toBe(url),
  );

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    '/auth/login',
    '/ok\u0000',
  ])('rejects %p (open redirect / loops)', (url) =>
    expect(safeReturnUrl(url)).toBe(DEFAULT_AFTER_LOGIN),
  );

  it('survives the Google round-trip once', () => {
    rememberReturnUrl('/items/7');
    expect(takeReturnUrl()).toBe('/items/7');
    expect(takeReturnUrl()).toBe(DEFAULT_AFTER_LOGIN);
  });
});
