// Test-only (excluded from the app build): boots Bookings as a real TCP
// microservice against the given Postgres/RabbitMQ/Redis and talks to it the
// way the gateway will, through a ClientProxy.
import { randomUUID } from 'node:crypto';
import { createAccessTokenSigner } from '@borrowbox/auth';
import {
  createEnvelope,
  ItemCreatedV1,
  ItemDeletedV1,
  ItemUpdatedV1,
  PaymentAccountReadyV1,
  PaymentCapturedV1,
  UserDeletionRequestedV1,
  UserEmailVerifiedV1,
  UserRegisteredV1,
  type BookingsRpcContract,
  type MessagingRpcContract,
  type EventEnvelope,
  type ItemSnapshotV1,
} from '@borrowbox/contracts';
import {
  freePort,
  generateTestKeys,
  startServiceHarness,
  type ServiceHarness,
  type TestKeys,
} from '@borrowbox/service-kit/testing';
import { PaymentEventsConsumer } from '../app/bookings/payment-events.consumer';
import { ItemEventsConsumer } from '../app/read-models/item-events.consumer';
import { UserEventsConsumer } from '../app/read-models/user-events.consumer';

/** Bookings serves Messaging's patterns too (ADR-0017). */
export type BookingsServiceContract = BookingsRpcContract &
  MessagingRpcContract;

export interface BookingsHarness extends ServiceHarness<BookingsServiceContract> {
  keys: TestKeys;
  /** A valid access token for `userId`, signed as Identity would. */
  tokenFor(userId: string): Promise<string>;
  /** Hands an event straight to Bookings' consumer (no broker). */
  receive(envelope: EventEnvelope): Promise<void>;
  /**
   * A user Bookings knows by name, with a verified email and payouts set up
   * (so they can accept paid bookings) unless told otherwise.
   */
  addUser(options?: {
    name?: string;
    verified?: boolean;
    payable?: boolean;
  }): Promise<string>;
  /** Plays Payments: the renter paid `bookingId` (rent + deposit + fee). */
  pay(bookingId: string, amountCents: number): Promise<void>;
  /** A bookable item (ACTIVE unless told otherwise) of `lenderId`. */
  addItem(
    lenderId: string,
    overrides?: Partial<ItemSnapshotV1>,
  ): Promise<ItemSnapshotV1>;
  updateItem(item: ItemSnapshotV1): Promise<void>;
  deleteItem(item: ItemSnapshotV1): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export async function startBookings(urls: {
  databaseUrl: string;
  rabbitmqUrl: string;
  redisUrl: string;
}): Promise<BookingsHarness> {
  const keys = generateTestKeys();
  const port = await freePort();
  const harness = await startServiceHarness<BookingsServiceContract>({
    port,
    env: {
      DATABASE_URL: urls.databaseUrl,
      RABBITMQ_URL: urls.rabbitmqUrl,
      REDIS_URL: urls.redisUrl,
      BOOKINGS_HOST: '127.0.0.1',
      BOOKINGS_PORT: String(port),
      DB_MIGRATIONS_RUN: 'true',
      // Bookings only gets the public key; tests sign tokens with
      // `keys.privateKeyPem`, playing Identity's part.
      JWT_PUBLIC_KEY: keys.publicKeyPem,
      JWT_KEY_ID: keys.keyId,
    },
    loadAppModule: async () => (await import('../app/app.module')).AppModule,
  });

  const signer = await createAccessTokenSigner({
    privateKeyPem: keys.privateKeyPem,
    keyId: keys.keyId,
  });
  const items = harness.app.get(ItemEventsConsumer);
  const users = harness.app.get(UserEventsConsumer);
  const payments = harness.app.get(PaymentEventsConsumer);

  const receive = async (envelope: EventEnvelope) => {
    const routingKey = `${envelope.type}.v${envelope.version}`;
    if (envelope.type.startsWith('item.')) {
      await items.handle(envelope, routingKey);
    } else if (envelope.type.startsWith('payment.')) {
      await payments.handle(envelope, routingKey);
    } else {
      await users.handle(envelope, routingKey);
    }
  };

  return {
    ...harness,
    keys,
    tokenFor: async (userId) =>
      (await signer.sign({ userId, sessionId: randomUUID() })).token,
    receive,
    addUser: async ({
      name = 'Maria',
      verified = true,
      payable = true,
    } = {}) => {
      const userId = randomUUID();
      await receive(
        createEnvelope(UserRegisteredV1, {
          userId,
          email: 'private@example.com',
          displayName: name,
          locale: 'el',
        }),
      );
      if (verified) {
        await receive(createEnvelope(UserEmailVerifiedV1, { userId }));
      }
      if (payable) {
        await receive(createEnvelope(PaymentAccountReadyV1, { userId }));
      }
      return userId;
    },
    pay: (bookingId, amountCents) =>
      receive(createEnvelope(PaymentCapturedV1, { bookingId, amountCents })),
    addItem: async (lenderId, overrides = {}) => {
      const item: ItemSnapshotV1 = {
        itemId: randomUUID(),
        lenderId,
        title: 'Cordless drill',
        category: 'tools',
        pricing: { free: false, hourlyCents: 200, dailyCents: 1000 },
        depositCents: 5000,
        minRentalHours: null,
        maxRentalHours: null,
        status: 'ACTIVE',
        ...overrides,
      };
      await receive(createEnvelope(ItemCreatedV1, item));
      return item;
    },
    updateItem: (item) => receive(createEnvelope(ItemUpdatedV1, item)),
    deleteItem: (item) =>
      receive(
        createEnvelope(ItemDeletedV1, {
          itemId: item.itemId,
          lenderId: item.lenderId,
        }),
      ),
    deleteUser: (userId) =>
      receive(createEnvelope(UserDeletionRequestedV1, { userId })),
  };
}
