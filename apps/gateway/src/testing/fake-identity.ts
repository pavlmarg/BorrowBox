// Test-only (excluded from the app build): a scriptable stand-in for the
// Identity service on real NestJS TCP, so gateway tests can check exactly what
// is forwarded and how each Identity answer is mapped. (Nx forbids importing
// the real Identity app; the end-to-end path is covered by the smoke script.)
import { createServer } from 'node:net';
import { Controller, Inject, type INestMicroservice } from '@nestjs/common';
import {
  MessagePattern,
  Payload,
  RpcException,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import {
  IdentityRpc,
  type IdentityRpcPattern,
  type RpcErrorBody,
  type RpcRequest,
} from '@borrowbox/contracts';

type Handler = (message: RpcRequest<unknown>) => unknown;

export interface RecordedCall {
  pattern: IdentityRpcPattern;
  message: RpcRequest<unknown>;
}

export class FakeIdentity {
  readonly calls: RecordedCall[] = [];
  private readonly handlers = new Map<IdentityRpcPattern, Handler>();
  private app?: INestMicroservice;
  port = 0;

  /** Answer `pattern` with `handler`'s result (a value, or throw an RpcErrorBody). */
  on(pattern: IdentityRpcPattern, handler: Handler): this {
    this.handlers.set(pattern, handler);
    return this;
  }

  /** Answer `pattern` with an error body, e.g. `{ code: 'EMAIL_TAKEN', message }`. */
  fail(pattern: IdentityRpcPattern, body: RpcErrorBody): this {
    return this.on(pattern, () => {
      throw body;
    });
  }

  reset(): void {
    this.calls.length = 0;
    this.handlers.clear();
  }

  callsTo(pattern: IdentityRpcPattern): RecordedCall[] {
    return this.calls.filter((c) => c.pattern === pattern);
  }

  async handle(
    pattern: IdentityRpcPattern,
    message: RpcRequest<unknown>,
  ): Promise<unknown> {
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
      controllers: [FakeIdentityController],
      providers: [{ provide: FakeIdentity, useValue: this }],
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
}

@Controller()
class FakeIdentityController {
  constructor(@Inject(FakeIdentity) private readonly fake: FakeIdentity) {}

  @MessagePattern(IdentityRpc.register)
  register(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.register, m);
  }
  @MessagePattern(IdentityRpc.login)
  login(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.login, m);
  }
  @MessagePattern(IdentityRpc.refresh)
  refresh(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.refresh, m);
  }
  @MessagePattern(IdentityRpc.logout)
  logout(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.logout, m);
  }
  @MessagePattern(IdentityRpc.googleExchange)
  googleExchange(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.googleExchange, m);
  }
  @MessagePattern(IdentityRpc.getMe)
  getMe(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.getMe, m);
  }
  @MessagePattern(IdentityRpc.updateMe)
  updateMe(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.updateMe, m);
  }
  @MessagePattern(IdentityRpc.exportMe)
  exportMe(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.exportMe, m);
  }
  @MessagePattern(IdentityRpc.deleteMe)
  deleteMe(@Payload() m: RpcRequest<unknown>) {
    return this.fake.handle(IdentityRpc.deleteMe, m);
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
