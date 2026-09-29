import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { InvalidAccessTokenError, type AuthUser } from './access-token';
import { JwtAuthGuard } from './jwt-auth.guard';

const TOKEN = 'aaa.bbb.ccc';
const USER: AuthUser = { userId: 'u-1', tokenId: 't-1' };

function httpContext(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; user?: AuthUser } = {
    headers,
  };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  const verifier = {
    verify: jest.fn(async (token: string) => {
      if (token === TOKEN) return USER;
      throw new InvalidAccessTokenError('ERR_JWS_INVALID');
    }),
  };
  const guard = new JwtAuthGuard(verifier);

  it('accepts a valid bearer token and exposes the user', async () => {
    const { context, request } = httpContext({
      authorization: `Bearer ${TOKEN}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(USER);
  });

  it.each([
    ['no header', {}],
    ['wrong scheme', { authorization: `Basic ${TOKEN}` }],
    ['not a JWT', { authorization: 'Bearer abc' }],
    ['invalid token', { authorization: 'Bearer xxx.yyy.zzz' }],
  ])('returns 401 for %s', async (_, headers) => {
    const { context, request } = httpContext(headers);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });

  it('does not turn unexpected errors into 401', async () => {
    verifier.verify.mockRejectedValueOnce(new Error('boom'));
    const { context } = httpContext({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(context)).rejects.toThrow('boom');
  });
});
