import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InvalidAccessTokenError, type AuthUser } from './access-token';
import { JwtAuthGuard, RpcJwtAuthGuard } from './jwt-auth.guard';

const TOKEN = 'aaa.bbb.ccc';
const USER: AuthUser = { userId: 'u-1', tokenId: 't-1' };

const verifier = {
  verify: jest.fn(async (token: string) => {
    if (token === TOKEN) return USER;
    throw new InvalidAccessTokenError('ERR_JWS_INVALID');
  }),
};

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

function rpcContext(data: unknown) {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({ getData: () => data }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
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

  it('refuses to guard RPC handlers', async () => {
    await expect(guard.canActivate(rpcContext({}))).rejects.toThrow(
      /use RpcJwtAuthGuard/,
    );
  });
});

describe('RpcJwtAuthGuard', () => {
  const guard = new RpcJwtAuthGuard(verifier);

  it('accepts a valid RpcRequest.accessToken', async () => {
    const message = { correlationId: 'c', accessToken: TOKEN, data: {} };
    await expect(guard.canActivate(rpcContext(message))).resolves.toBe(true);
  });

  it.each([
    ['no token', { correlationId: 'c', data: {} }],
    ['invalid token', { correlationId: 'c', accessToken: 'x.y.z', data: {} }],
    ['non-string token', { correlationId: 'c', accessToken: 42, data: {} }],
    ['no message', null],
  ])('rejects %s with UNAUTHENTICATED', async (_, message) => {
    const err = await guard.canActivate(rpcContext(message)).catch((e) => e);
    expect(err).toBeInstanceOf(RpcException);
    expect((err as RpcException).getError()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
  });

  it('does not hide unexpected errors', async () => {
    verifier.verify.mockRejectedValueOnce(new Error('boom'));
    const message = { correlationId: 'c', accessToken: TOKEN, data: {} };
    await expect(guard.canActivate(rpcContext(message))).rejects.toThrow(
      'boom',
    );
  });
});
