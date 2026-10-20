import type { ArgumentsHost } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { IsString } from 'class-validator';
import {
  CorrelationIdPipe,
  RpcErrorFilter,
  ServiceError,
  rpcValidationPipe,
} from './rpc';

class ShopError extends ServiceError<'OUT_OF_STOCK' | 'VALIDATION_FAILED'> {}

class NameDto {
  @IsString()
  name!: string;
}

const host = {
  switchToRpc: () => ({ getContext: () => ({ getPattern: () => 'shop.buy' }) }),
} as unknown as ArgumentsHost;

function bodyOf(exception: unknown): Promise<unknown> {
  return lastValueFrom(new RpcErrorFilter().catch(exception, host)).catch(
    (body: unknown) => body,
  );
}

describe('ServiceError', () => {
  it('is named after the subclass', () => {
    const err = new ShopError('OUT_OF_STOCK', 'Out of stock');
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.name).toBe('ShopError');
    expect(err.code).toBe('OUT_OF_STOCK');
  });
});

describe('RpcErrorFilter', () => {
  it('passes a service error through as its code and message', async () => {
    await expect(
      bodyOf(new ShopError('OUT_OF_STOCK', 'Out of stock')),
    ).resolves.toEqual({ code: 'OUT_OF_STOCK', message: 'Out of stock' });
  });

  it('passes an RpcException body through', async () => {
    const body = { code: 'UNAUTHENTICATED', message: 'Sign in' };
    await expect(bodyOf(new RpcException(body))).resolves.toEqual(body);
  });

  it('hides anything else as INTERNAL', async () => {
    await expect(
      bodyOf(new Error('duplicate key: alice@example.com')),
    ).resolves.toEqual({ code: 'INTERNAL', message: 'Internal error' });
  });
});

describe('rpcValidationPipe', () => {
  it('names invalid and unknown fields, never their values', async () => {
    const err = await rpcValidationPipe
      .transform(
        { name: 42, secret: 'hunter2' },
        { type: 'body', metatype: NameDto },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe('VALIDATION_FAILED');
    const message = (err as ServiceError).message;
    expect(message).toMatch(/^Invalid fields: /);
    expect(message.replace('Invalid fields: ', '').split(', ').sort()).toEqual([
      'name',
      'secret',
    ]);
    expect(message).not.toContain('hunter2');
  });
});

describe('CorrelationIdPipe', () => {
  const pipe = new CorrelationIdPipe();

  it('accepts a short, inert id', () => {
    expect(pipe.transform('req-1:abc.DEF_2')).toBe('req-1:abc.DEF_2');
  });

  it.each([undefined, '', 'has space', 'x'.repeat(129), '<script>'])(
    'rejects %p',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(ServiceError);
    },
  );
});
