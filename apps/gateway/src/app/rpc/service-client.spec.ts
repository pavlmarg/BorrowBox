import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { NO_MESSAGE_HANDLER } from '@nestjs/microservices/constants';
import { EMPTY, NEVER, of, throwError, type Observable } from 'rxjs';
import {
  GOOGLE_EXCHANGE_MAX_REQUESTS,
  GOOGLE_EXCHANGE_TIMEOUT_MS,
  GOOGLE_HTTP_TIMEOUT_MS,
  IdentityRpc,
} from '@borrowbox/contracts';
import { IdentityClient } from '../identity/identity.client';
import { ServiceClient } from './service-client';

interface TestContract {
  'test.echo': { request: { text: string }; response: { text: string } };
  'test.slow': { request: Record<string, never>; response: void };
}
type TestErrorCode = 'NOT_FOUND' | 'INTERNAL';

class TestClient extends ServiceClient<TestContract, TestErrorCode> {
  constructor(proxy: ClientProxy) {
    super({
      name: 'Test',
      proxy,
      defaultTimeoutMs: 20,
      statusByCode: {
        NOT_FOUND: HttpStatus.NOT_FOUND,
        INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
      },
      timeoutOverridesMs: { 'test.slow': 80 },
    });
  }
}

describe('ServiceClient', () => {
  let reply: () => Observable<unknown>;
  const send = jest.fn((_pattern: string, _message: unknown) => reply());
  const proxy = { send, close: jest.fn() } as unknown as ClientProxy;
  const client = new TestClient(proxy);
  let logError: jest.SpyInstance;

  beforeEach(() => {
    send.mockClear();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  const ctx = { correlationId: 'corr-1' };
  const failure = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const e = err as HttpException;
      return { status: e.getStatus(), body: e.getResponse() };
    }
    throw new Error('expected the call to fail');
  };

  it('wraps the data in an RpcRequest and resolves with the response', async () => {
    reply = () => of({ text: 'hi' });
    await expect(
      client.call('test.echo', { text: 'hi' }, { ...ctx, accessToken: 'tok' }),
    ).resolves.toEqual({ text: 'hi' });
    expect(send).toHaveBeenCalledWith('test.echo', {
      correlationId: 'corr-1',
      accessToken: 'tok',
      data: { text: 'hi' },
    });
  });

  it('omits the access token for anonymous calls', async () => {
    reply = () => of({ text: 'x' });
    await client.call('test.echo', { text: 'x' }, ctx);
    expect(send.mock.calls[0][1]).toEqual({
      correlationId: 'corr-1',
      data: { text: 'x' },
    });
  });

  it('resolves void handlers that complete without a value', async () => {
    reply = () => EMPTY;
    await expect(client.call('test.slow', {}, ctx)).resolves.toBeUndefined();
  });

  it('maps a known error code to its status and passes the message through', async () => {
    reply = () =>
      throwError(() => ({ code: 'NOT_FOUND', message: 'Item not found' }));
    expect(await failure(client.call('test.echo', { text: '' }, ctx))).toEqual({
      status: 404,
      body: { statusCode: 404, code: 'NOT_FOUND', message: 'Item not found' },
    });
  });

  it('answers 500 INTERNAL for an unmapped code and logs which one', async () => {
    reply = () =>
      throwError(() => ({ code: 'BRAND_NEW_CODE', message: 'details' }));
    expect(await failure(client.call('test.echo', { text: '' }, ctx))).toEqual({
      status: 500,
      body: { statusCode: 500, code: 'INTERNAL', message: 'Internal error' },
    });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('unmapped error code BRAND_NEW_CODE'),
    );
  });

  it('answers 500 INTERNAL when the service has no handler for the pattern', async () => {
    // What Nest's TCP server replies with: a plain string, not an RpcErrorBody.
    reply = () => throwError(() => NO_MESSAGE_HANDLER);
    expect(await failure(client.call('test.echo', { text: '' }, ctx))).toEqual({
      status: 500,
      body: { statusCode: 500, code: 'INTERNAL', message: 'Internal error' },
    });
    expect(logError).toHaveBeenCalledWith(
      'Test has no handler for test.echo (correlationId=corr-1)',
    );
  });

  it('answers 503 with a generic message when the service is unreachable', async () => {
    // Transport errors are Error instances, even when they carry a string code.
    reply = () =>
      throwError(() =>
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      );
    expect(await failure(client.call('test.echo', { text: '' }, ctx))).toEqual({
      status: 503,
      body: {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable, try again later',
      },
    });
    expect(logError).toHaveBeenCalledWith(
      'Test call test.echo failed: ECONNREFUSED (correlationId=corr-1)',
    );
  });

  it('answers 503 on timeout, and never logs the payload', async () => {
    reply = () => NEVER;
    const res = await failure(
      client.call('test.echo', { text: 'secret-password' }, ctx),
    );
    expect(res.status).toBe(503);
    expect(logError).toHaveBeenCalledWith(
      'Test call test.echo failed: timeout (correlationId=corr-1)',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('secret');
  });

  it('waits longer for calls with a timeout override', async () => {
    jest.useFakeTimers();
    try {
      reply = () => NEVER;
      let settled = false;
      const call = client.call('test.slow', {}, ctx).catch(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(50); // past the 20 ms default
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(40); // past the 80 ms override
      await call;
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for Google sign-in longer than Identity waits for Google', async () => {
    jest.useFakeTimers();
    try {
      reply = () => NEVER;
      const identity = new IdentityClient(proxy, 5_000);
      let settled = false;
      const call = identity
        .call(
          IdentityRpc.googleExchange,
          {
            code: 'c',
            codeVerifier: 'v',
            nonce: 'n',
            redirectUri: 'https://x',
          },
          ctx,
        )
        .catch(() => {
          settled = true;
        });
      // Still waiting after every Google request Identity may make has timed out.
      const identityMax = GOOGLE_HTTP_TIMEOUT_MS * GOOGLE_EXCHANGE_MAX_REQUESTS;
      await jest.advanceTimersByTimeAsync(identityMax);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(
        GOOGLE_EXCHANGE_TIMEOUT_MS - identityMax,
      );
      await call;
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes its connection on shutdown', async () => {
    await client.onApplicationShutdown();
    expect(proxy.close).toHaveBeenCalled();
  });
});

// Compile-time checks: a wrong pattern or request shape doesn't build.
export function typeChecks(client: TestClient) {
  // @ts-expect-error unknown pattern
  void client.call('test.missing', {}, { correlationId: 'x' });
  // @ts-expect-error wrong request shape for the pattern
  void client.call('test.echo', { text: 1 }, { correlationId: 'x' });
}
