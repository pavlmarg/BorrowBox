import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { EventBus, type MessagingLogger } from '@borrowbox/messaging';
import { OutboxRelay } from '@borrowbox/outbox';
import type { IdentityConfig } from '../config';
import { DATA_SOURCE } from '../database/database.module';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const OUTBOX_RELAY = Symbol('OUTBOX_RELAY');

/** Adapts Nest's Logger to the structured logger the libs expect. Never log payloads. */
function nestLogger(context: string): MessagingLogger {
  const logger = new Logger(context);
  const fmt = (msg: string, obj: Record<string, unknown>) =>
    `${msg} ${JSON.stringify(obj)}`;
  return {
    info: (obj, msg) => logger.log(fmt(msg, obj)),
    warn: (obj, msg) => logger.warn(fmt(msg, obj)),
    error: (obj, msg) => logger.error(fmt(msg, obj)),
  };
}

/**
 * Publishes Identity's outbox to RabbitMQ. Business code never publishes
 * directly: it calls `addToOutbox(tx, envelope)` inside its transaction.
 */
@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<IdentityConfig, true>) =>
        EventBus.connect({
          url: config.get('RABBITMQ_URL', { infer: true }),
          logger: nestLogger('EventBus'),
        }),
    },
    {
      provide: OUTBOX_RELAY,
      inject: [DATA_SOURCE, EVENT_BUS],
      useFactory: (dataSource: DataSource, bus: EventBus) =>
        new OutboxRelay({
          dataSource,
          publish: (envelope) => bus.publish(envelope),
          logger: nestLogger('OutboxRelay'),
        }),
    },
  ],
  exports: [EVENT_BUS],
})
export class EventsModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(OUTBOX_RELAY) private readonly relay: OutboxRelay,
  ) {}

  onApplicationBootstrap(): void {
    this.relay.start();
  }

  /** Runs before DatabaseModule destroys the DataSource: relay first (finishes its in-flight batch), then the connection. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.relay.stop();
    await this.bus.close();
  }
}
