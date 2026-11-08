// Test-only (excluded from the app build): boots Payments as a real TCP
// microservice against the given Postgres/RabbitMQ, with Stripe replaced by
// FakeStripe, and talks to it the way the gateway does.
import { randomUUID } from 'node:crypto';
import { createAccessTokenSigner } from '@borrowbox/auth';
import {
  PaymentsRpc,
  type EventEnvelope,
  type PaymentsRpcContract,
  type WebhookSource,
} from '@borrowbox/contracts';
import {
  freePort,
  generateTestKeys,
  startServiceHarness,
  type ServiceHarness,
} from '@borrowbox/service-kit/testing';
import { BookingEventsConsumer } from '../app/checkout/booking-events.consumer';
import { PaymentsWorker } from '../app/payments.worker';
import { STRIPE_API } from '../app/stripe/stripe-api';
import { UserEventsConsumer } from '../app/users/user-events.consumer';
import {
  FakeStripe,
  TEST_CONNECT_WEBHOOK_SECRET,
  TEST_WEBHOOK_SECRET,
} from './fake-stripe';

export interface PaymentsHarness extends ServiceHarness<PaymentsRpcContract> {
  stripe: FakeStripe;
  tokenFor(userId: string): Promise<string>;
  /** Hands an event straight to the consumer (no broker). */
  receive(envelope: EventEnvelope): Promise<void>;
  /** Sends Stripe's webhook as the gateway forwards it, signed unless `signature` is given. */
  webhook(
    source: WebhookSource,
    event: {
      id: string;
      type: string;
      account?: string;
      data?: { object: { id: string } };
    },
    signature?: string,
  ): Promise<void>;
  /** Runs the worker once, now. */
  runDue(now?: Date): Promise<void>;
}

export async function startPayments(urls: {
  databaseUrl: string;
  rabbitmqUrl: string;
}): Promise<PaymentsHarness> {
  const keys = generateTestKeys();
  const port = await freePort();
  const stripe = new FakeStripe();
  const harness = await startServiceHarness<PaymentsRpcContract>({
    port,
    env: {
      DATABASE_URL: urls.databaseUrl,
      RABBITMQ_URL: urls.rabbitmqUrl,
      PAYMENTS_HOST: '127.0.0.1',
      PAYMENTS_PORT: String(port),
      DB_MIGRATIONS_RUN: 'true',
      JWT_PUBLIC_KEY: keys.publicKeyPem,
      JWT_KEY_ID: keys.keyId,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      STRIPE_CONNECT_WEBHOOK_SECRET: TEST_CONNECT_WEBHOOK_SECRET,
      STRIPE_ACCOUNT_COUNTRY: 'GR',
      WEB_BASE_URL: 'https://borrowbox.test',
    },
    loadAppModule: async () => (await import('../app/app.module')).AppModule,
    overrides: [{ token: STRIPE_API, value: stripe }],
  });
  const signer = await createAccessTokenSigner({
    privateKeyPem: keys.privateKeyPem,
    keyId: keys.keyId,
  });
  const consumer = harness.app.get(UserEventsConsumer);
  const bookingEvents = harness.app.get(BookingEventsConsumer);
  const worker = harness.app.get(PaymentsWorker);
  return {
    ...harness,
    stripe,
    tokenFor: async (userId) =>
      (await signer.sign({ userId, sessionId: randomUUID() })).token,
    receive: (envelope) => {
      const routingKey = `${envelope.type}.v${envelope.version}`;
      return envelope.type.startsWith('booking.')
        ? bookingEvents.handle(envelope, routingKey)
        : consumer.handle(envelope, routingKey);
    },
    webhook: (source, event, signature) => {
      const payload = JSON.stringify({ object: 'event', ...event });
      const secret =
        source === 'connect'
          ? TEST_CONNECT_WEBHOOK_SECRET
          : TEST_WEBHOOK_SECRET;
      return harness.send(PaymentsRpc.receiveWebhook, {
        source,
        payload,
        signature: signature ?? stripe.sign(payload, secret),
      });
    },
    runDue: (now) => worker.runDue(now),
  };
}
