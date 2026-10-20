// Test-only entry point (`@borrowbox/service-kit/testing`), for the services'
// `src/testing` harnesses, which their app builds exclude.
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import type { INestMicroservice, Type } from '@nestjs/common';
import {
  ClientProxyFactory,
  Transport,
  type ClientProxy,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { lastValueFrom } from 'rxjs';
import type { DataSource } from 'typeorm';
import type { RpcRequest } from '@borrowbox/contracts';
import { DATA_SOURCE } from './lib/database';

export interface TestKeys {
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
}

/** A fresh Ed25519 token-signing key pair. */
export function generateTestKeys(): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    keyId: 'test-key',
  };
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

/** Maps each RPC pattern to its response type, like `CatalogRpcContract`. */
export type RpcContractMap<C> = { [P in keyof C]: { response: unknown } };

export interface ServiceHarness<C extends RpcContractMap<C>> {
  app: INestMicroservice;
  dataSource: DataSource;
  /** Resolves with the response, rejects with the `RpcErrorBody`. */
  send<P extends keyof C & string>(
    pattern: P,
    data: unknown,
    options?: { accessToken?: string; correlationId?: string },
  ): Promise<C[P]['response']>;
  close(): Promise<void>;
}

/**
 * Boots a service as a real TCP microservice and talks to it the way the
 * gateway does, through a ClientProxy. `env` must include the service's
 * host/port keys set to `127.0.0.1` and `port`.
 */
export async function startServiceHarness<
  C extends RpcContractMap<C>,
>(options: {
  port: number;
  env: Record<string, string>;
  /**
   * Imports the app module. ConfigModule validates env when it is first
   * imported, so it must be loaded only after `env` is applied.
   */
  loadAppModule: () => Promise<Type>;
}): Promise<ServiceHarness<C>> {
  Object.assign(process.env, options.env);
  const appModule = await options.loadAppModule();
  const moduleRef = await Test.createTestingModule({
    imports: [appModule],
  }).compile();
  const app = moduleRef.createNestMicroservice({
    transport: Transport.TCP,
    options: { host: '127.0.0.1', port: options.port },
  });
  await app.listen();

  const client: ClientProxy = ClientProxyFactory.create({
    transport: Transport.TCP,
    options: { host: '127.0.0.1', port: options.port },
  });
  await client.connect();

  return {
    app,
    dataSource: app.get<DataSource>(DATA_SOURCE),
    send: (pattern, data, sendOptions = {}) => {
      const message: RpcRequest<unknown> = {
        correlationId: sendOptions.correlationId ?? 'test-correlation',
        ...(sendOptions.accessToken
          ? { accessToken: sendOptions.accessToken }
          : {}),
        data,
      };
      // void handlers complete without a value.
      return lastValueFrom(client.send(pattern, message), {
        defaultValue: undefined,
      });
    },
    close: async () => {
      await client.close();
      await app.close();
    },
  };
}
