// Test-only (excluded from the app build): scriptable stand-ins for the
// services on real NestJS TCP, so gateway tests can check exactly what is
// forwarded and how each answer is mapped. (Nx forbids importing the real
// service apps; each service tests its own handlers.)
import { createServer } from 'node:net';
import { Controller, type INestMicroservice } from '@nestjs/common';
import {
  MessagePattern,
  Payload,
  RpcException,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import {
  CatalogRpc,
  IdentityRpc,
  type CatalogRpcPattern,
  type IdentityRpcPattern,
  type RpcErrorBody,
  type RpcRequest,
} from '@borrowbox/contracts';

type Handler = (message: RpcRequest<unknown>) => unknown;

export interface RecordedCall<P extends string> {
  pattern: P;
  message: RpcRequest<unknown>;
}

/**
 * Answers every pattern of a service's contract. Unscripted patterns answer
 * `INTERNAL`, so a test notices a call it didn't expect.
 */
export class FakeService<P extends string> {
  readonly calls: RecordedCall<P>[] = [];
  private readonly handlers = new Map<P, Handler>();
  private app?: INestMicroservice;
  port = 0;

  constructor(private readonly patterns: readonly P[]) {}

  /** Answer `pattern` with `handler`'s result (a value, or throw an RpcErrorBody). */
  on(pattern: P, handler: Handler): this {
    this.handlers.set(pattern, handler);
    return this;
  }

  /** Answer `pattern` with an error body, e.g. `{ code: 'EMAIL_TAKEN', message }`. */
  fail(pattern: P, body: RpcErrorBody): this {
    return this.on(pattern, () => {
      throw body;
    });
  }

  reset(): void {
    this.calls.length = 0;
    this.handlers.clear();
  }

  callsTo(pattern: P): RecordedCall<P>[] {
    return this.calls.filter((c) => c.pattern === pattern);
  }

  async handle(pattern: P, message: RpcRequest<unknown>): Promise<unknown> {
    this.calls.push({ pattern, message });
    const handler = this.handlers.get(pattern);
    try {
      if (!handler)
        throw { code: 'INTERNAL', message: `no fake for ${pattern}` };
      return await handler(message);
    } catch (err) {
      throw new RpcException(err as RpcErrorBody);
    }
  }

  async start(): Promise<void> {
    this.port = await freePort();
    const moduleRef = await Test.createTestingModule({
      controllers: [this.controllerClass()],
    }).compile();
    this.app = moduleRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: this.port },
      logger: false,
    });
    await this.app.listen();
  }

  async stop(): Promise<void> {
    await this.app?.close();
  }

  /** A controller with one `@MessagePattern` handler per contract pattern. */
  private controllerClass(): new () => object {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fake = this;
    class FakeController {}
    const proto = FakeController.prototype as unknown as Record<
      string,
      (m: RpcRequest<unknown>) => Promise<unknown>
    >;
    this.patterns.forEach((pattern, i) => {
      const name = `handle${i}`;
      proto[name] = (m) => fake.handle(pattern, m);
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (!descriptor) throw new Error('unreachable');
      MessagePattern(pattern)(proto, name, descriptor);
      Payload()(proto, name, 0);
    });
    Controller()(FakeController);
    return FakeController;
  }
}

export class FakeIdentity extends FakeService<IdentityRpcPattern> {
  constructor() {
    super(Object.values(IdentityRpc));
  }
}

export class FakeCatalog extends FakeService<CatalogRpcPattern> {
  constructor() {
    super(Object.values(CatalogRpc));
  }
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}
