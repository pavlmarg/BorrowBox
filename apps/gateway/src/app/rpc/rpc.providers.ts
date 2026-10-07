import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import type { GatewayConfig } from '../config';

/** Default wait for a service's answer (`RPC_TIMEOUT_MS`). */
export const RPC_TIMEOUT_MS = Symbol('RPC_TIMEOUT_MS');

export const rpcTimeoutProvider: Provider = {
  provide: RPC_TIMEOUT_MS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<GatewayConfig, true>) =>
    config.get('RPC_TIMEOUT_MS', { infer: true }),
};

type ConfigKey = keyof GatewayConfig & string;

/**
 * A NestJS TCP connection to a service (ADR-0005), from its host and port in
 * config. Connects lazily, on the first call.
 */
export function tcpClientProvider(
  token: symbol,
  hostKey: ConfigKey,
  portKey: ConfigKey,
): Provider {
  return {
    provide: token,
    inject: [ConfigService],
    useFactory: (config: ConfigService<GatewayConfig, true>) =>
      ClientProxyFactory.create({
        transport: Transport.TCP,
        options: {
          host: String(config.get(hostKey)),
          port: Number(config.get(portKey)),
        },
      }),
  };
}
