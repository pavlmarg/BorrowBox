// Test-only (excluded from the app build): boots Notifications as a real TCP
// microservice against the given Postgres/RabbitMQ (and Mailpit), and talks
// to it the way the gateway does.
import { randomUUID } from 'node:crypto';
import { createAccessTokenSigner } from '@borrowbox/auth';
import type {
  EventEnvelope,
  NotificationsRpcContract,
} from '@borrowbox/contracts';
import {
  freePort,
  generateTestKeys,
  startServiceHarness,
  type ServiceHarness,
} from '@borrowbox/service-kit/testing';
import { EmailSender } from '../app/emails/email-sender';
import { EventsConsumer } from '../app/events/events.consumer';

export interface NotificationsHarness extends ServiceHarness<NotificationsRpcContract> {
  tokenFor(userId: string): Promise<string>;
  /** Hands an event straight to the consumer (no broker). */
  receive(envelope: EventEnvelope): Promise<void>;
  /** Sends every due email now; returns how many were sent. */
  sendDue(now?: Date): Promise<number>;
}

export async function startNotifications(urls: {
  databaseUrl: string;
  rabbitmqUrl: string;
  /** Mailpit; without it, sending is disabled (skipped with a warning). */
  smtp?: { host: string; port: number };
}): Promise<NotificationsHarness> {
  const keys = generateTestKeys();
  const port = await freePort();
  const harness = await startServiceHarness<NotificationsRpcContract>({
    port,
    env: {
      DATABASE_URL: urls.databaseUrl,
      RABBITMQ_URL: urls.rabbitmqUrl,
      NOTIFICATIONS_HOST: '127.0.0.1',
      NOTIFICATIONS_PORT: String(port),
      DB_MIGRATIONS_RUN: 'true',
      JWT_PUBLIC_KEY: keys.publicKeyPem,
      JWT_KEY_ID: keys.keyId,
      SMTP_HOST: urls.smtp?.host ?? '',
      SMTP_PORT: String(urls.smtp?.port ?? 1025),
      WEB_BASE_URL: 'https://borrowbox.test',
    },
    loadAppModule: async () => (await import('../app/app.module')).AppModule,
  });
  const signer = await createAccessTokenSigner({
    privateKeyPem: keys.privateKeyPem,
    keyId: keys.keyId,
  });
  const consumer = harness.app.get(EventsConsumer);
  const sender = harness.app.get(EmailSender);
  return {
    ...harness,
    tokenFor: async (userId) =>
      (await signer.sign({ userId, sessionId: randomUUID() })).token,
    receive: (envelope) =>
      consumer.handle(envelope, `${envelope.type}.v${envelope.version}`),
    sendDue: (now) => sender.sendDue(now),
  };
}
