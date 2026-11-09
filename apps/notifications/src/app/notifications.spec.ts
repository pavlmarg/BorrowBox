import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  BookingCancelledV1,
  BookingConfirmedV1,
  BookingPaidV1,
  BookingRequestedV1,
  ConversationUnreadV1,
  createEnvelope,
  NotificationsRpc,
  PaymentFailedV1,
  UserDeletionRequestedV1,
  UserProfileUpdatedV1,
  UserRegisteredV1,
  type BookingSnapshotV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { createMailer } from '@borrowbox/mailer';
import { EventBus, type MessagingLogger } from '@borrowbox/messaging';
import {
  startMailpit,
  startPostgres,
  startRabbitMq,
  type TestMailpit,
  type TestPostgres,
  type TestRabbitMq,
} from '@borrowbox/testing';
import {
  startNotifications,
  type NotificationsHarness,
} from '../testing/notifications-harness';
import { EmailSender } from './emails/email-sender';
import { EVENTS_QUEUE } from './events/events.consumer';
import { MIGRATIONS } from './database/database.module';

const silent: MessagingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Notifications end to end: events through a real RabbitMQ, jobs in
 * Postgres, emails caught by Mailpit.
 */
describe('Notifications (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let mailpit: TestMailpit;
  let service: NotificationsHarness;
  let bus: EventBus;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit, mailpit] = await Promise.all([
      startPostgres(),
      startRabbitMq(),
      startMailpit(),
    ]);
    service = await startNotifications({
      databaseUrl: pg.urlFor('notifications'),
      rabbitmqUrl: rabbit.url,
      smtp: { host: mailpit.smtpHost, port: mailpit.smtpPort },
    });
    bus = await EventBus.connect({ url: rabbit.url, logger: silent });
  });

  afterAll(async () => {
    await bus?.close();
    await service?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), mailpit?.stop()]);
  });

  async function deliver(envelope: EventEnvelope): Promise<void> {
    await bus.publish(envelope);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const rows = await service.dataSource.query(
        `SELECT 1 FROM processed_events WHERE consumer = $1 AND event_id = $2`,
        [EVENTS_QUEUE, envelope.eventId],
      );
      if (rows.length > 0) return;
      if (Date.now() > deadline)
        throw new Error(`${envelope.type} not handled`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function person(name: string, locale: 'el' | 'en' = 'en') {
    const userId = randomUUID();
    const email = `${name.toLowerCase()}-${userId.slice(0, 8)}@example.com`;
    await service.receive(
      createEnvelope(UserRegisteredV1, {
        userId,
        email,
        displayName: name,
        locale,
      }),
    );
    return { userId, email };
  }

  const booking = (lenderId: string, renterId: string): BookingSnapshotV1 => ({
    bookingId: randomUUID(),
    itemId: randomUUID(),
    itemTitle: 'Cordless drill',
    lenderId,
    renterId,
    start: '2026-11-01T08:00:00.000Z',
    end: '2026-11-01T11:00:00.000Z',
    rentCents: 600,
    depositCents: 5000,
  });

  it('migrates into the notifications schema', async () => {
    expect(await service.dataSource.showMigrations()).toBe(false);
    expect(MIGRATIONS).toHaveLength(3);
  });

  it('emails the lender a new request in their language, once per event', async () => {
    const lender = await person('Λένα', 'el');
    const renter = await person('Rafael');
    const event = createEnvelope(
      BookingRequestedV1,
      booking(lender.userId, renter.userId),
    );
    await deliver(event);
    await service.receive(event);
    await service.sendDue();

    const emails = await mailpit.waitForEmails(lender.email);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe('Νέο αίτημα για «Cordless drill»');
    // Athens is UTC+2 in November.
    expect(emails[0].text).toContain('Rafael θέλει να δανειστεί');
    expect(emails[0].text).toContain('10:00');
    expect(await mailpit.emailsTo(renter.email)).toEqual([]);
  });

  it('emails both people to arrange the meeting once confirmed', async () => {
    const lender = await person('Lena');
    const renter = await person('Rafael');
    await deliver(
      createEnvelope(BookingConfirmedV1, booking(lender.userId, renter.userId)),
    );
    await service.sendDue();
    const [toRenter] = await mailpit.waitForEmails(renter.email);
    const [toLender] = await mailpit.waitForEmails(lender.email);
    expect(toRenter.text).toContain('Arrange where and when to meet with Lena');
    expect(toLender.text).toContain(
      'Arrange where and when to meet with Rafael',
    );
  });

  it('emails both people once a booking is paid, once per event', async () => {
    const lender = await person('Lena');
    const renter = await person('Rafael');
    const paid = createEnvelope(
      BookingPaidV1,
      booking(lender.userId, renter.userId),
    );
    await service.receive(paid);
    await service.receive(paid);
    await service.sendDue();
    const [toRenter] = await mailpit.waitForEmails(renter.email);
    const [toLender] = await mailpit.waitForEmails(lender.email);
    expect(toRenter.subject).toBe('The booking of “Cordless drill” is paid');
    expect(toLender.text).toContain(
      'Arrange where and when to meet with Rafael',
    );
    expect(await mailpit.emailsTo(renter.email)).toHaveLength(1);
  });

  it('tells the renter when a payment fails, once per event', async () => {
    const lender = await person('Lena');
    const renter = await person('Rafael');
    const failed = createEnvelope(PaymentFailedV1, {
      bookingId: randomUUID(),
      renterId: renter.userId,
      lenderId: lender.userId,
      itemTitle: 'Cordless drill',
      amountCents: 7200,
      payBy: '2026-11-02T08:00:00.000Z',
    });
    await service.receive(failed);
    await service.receive(failed);
    await service.sendDue();
    const emails = await mailpit.waitForEmails(renter.email);
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toContain('€72.00');
    expect(await mailpit.emailsTo(lender.email)).toEqual([]);
  });

  it('waits for a recipient it does not know yet, then sends', async () => {
    const lender = await person('Lena');
    const renterId = randomUUID();
    await service.receive(
      createEnvelope(ConversationUnreadV1, {
        conversationId: randomUUID(),
        itemId: randomUUID(),
        itemTitle: 'Ladder',
        recipientId: renterId,
        senderId: lender.userId,
        unreadCount: 2,
      }),
    );
    expect(await service.sendDue()).toBe(0);

    // Only the name first (no email yet), then the registration.
    await service.receive(
      createEnvelope(UserProfileUpdatedV1, {
        userId: renterId,
        displayName: 'Rafael',
        locale: 'en',
      }),
    );
    await service.receive(
      createEnvelope(
        UserRegisteredV1,
        {
          userId: renterId,
          email: 'late-rafael@example.com',
          displayName: 'Old name',
          locale: 'el',
        },
        { occurredAt: new Date(Date.now() - 60_000) },
      ),
    );
    // The job waits 5 minutes for the recipient; pretend they passed.
    const later = new Date(Date.now() + 6 * 60_000);
    await service.dataSource.query(
      `UPDATE email_jobs SET next_attempt_at = now() WHERE recipient_id = $1`,
      [renterId],
    );
    expect(await service.sendDue(later)).toBe(1);
    const [email] = await mailpit.waitForEmails('late-rafael@example.com');
    // The newer name and language win; the older event still gave the email.
    expect(email.subject).toBe('New messages about “Ladder”');
    expect(email.text).toContain('Hi Rafael,');
    expect(email.text).toContain('Lena sent you 2 messages.');
  });

  it('forgets an erased account: no emails, no data, a name no longer used', async () => {
    const lender = await person('Lena');
    const renter = await person('Rafael');
    await service.receive(
      createEnvelope(BookingRequestedV1, booking(lender.userId, renter.userId)),
    );
    await service.receive(
      createEnvelope(BookingRequestedV1, booking(renter.userId, lender.userId)),
    );
    // Held back until the erasure is processed: the service's own sender
    // polls every 2 seconds and must not send them earlier.
    const hold = (interval: string) =>
      service.dataSource.query(
        `UPDATE email_jobs SET next_attempt_at = now() + $2::interval
          WHERE recipient_id = ANY($1::uuid[]) AND status = 'PENDING'`,
        [[lender.userId, renter.userId], interval],
      );
    await hold('1 hour');
    await deliver(
      createEnvelope(UserDeletionRequestedV1, { userId: renter.userId }),
    );
    await hold('0 seconds');
    // A late registration can't bring them back.
    await service.receive(
      createEnvelope(UserRegisteredV1, {
        userId: renter.userId,
        email: renter.email,
        displayName: 'Rafael',
        locale: 'en',
      }),
    );
    await service.sendDue();

    const [email] = await mailpit.waitForEmails(lender.email);
    expect(email.text).toContain('Someone would like to borrow');
    expect(await mailpit.emailsTo(renter.email)).toEqual([]);
    const exported = await service.send(
      NotificationsRpc.exportMe,
      {},
      { accessToken: await service.tokenFor(renter.userId) },
    );
    expect(exported).toMatchObject({ recipient: null, emails: [] });
  });

  it('exports what it knows and which emails it sent', async () => {
    const lender = await person('Lena');
    const renter = await person('Rafael');
    await service.receive(
      createEnvelope(BookingRequestedV1, booking(lender.userId, renter.userId)),
    );
    await service.sendDue();
    const exported = await service.send(
      NotificationsRpc.exportMe,
      {},
      { accessToken: await service.tokenFor(lender.userId) },
    );
    expect(exported.recipient).toMatchObject({
      email: lender.email,
      displayName: 'Lena',
      locale: 'en',
    });
    expect(exported.emails).toEqual([
      expect.objectContaining({
        kind: 'BOOKING_REQUESTED',
        sentAt: expect.any(String),
      }),
    ]);
  });

  it("queues an erasure's cancellations 10 minutes ahead", async () => {
    const lender = await person('Lena');
    const renter = await person('Rafael');
    const b = booking(lender.userId, renter.userId);
    await service.receive(
      createEnvelope(BookingCancelledV1, { ...b, reason: 'ACCOUNT_DELETED' }),
    );
    const jobs = await service.dataSource.query(
      `SELECT extract(epoch FROM next_attempt_at - created_at)::int AS delay
         FROM email_jobs WHERE data->>'bookingId' = $1`,
      [b.bookingId],
    );
    expect(jobs).toEqual([{ delay: 600 }, { delay: 600 }]);
    expect(await service.sendDue()).toBe(0);
  });

  describe('a sender that can’t send', () => {
    const jobOf = async (bookingId: string) =>
      (
        await service.dataSource.query(
          `SELECT status, attempts, next_attempt_at > now() AS later
             FROM email_jobs WHERE data->>'bookingId' = $1`,
          [bookingId],
        )
      )[0];

    it('never counts an email as sent while sending is disabled', async () => {
      const lender = await person('Lena');
      const renter = await person('Rafael');
      const b = booking(lender.userId, renter.userId);
      await service.receive(createEnvelope(BookingRequestedV1, b));

      const disabled = new EmailSender(
        service.dataSource,
        createMailer(
          { port: 25, secure: false, from: 'x@example.com' },
          { warn: () => undefined },
        ),
        service.app.get(ConfigService),
      );
      expect(await disabled.sendDue()).toBe(0);
      // A failed attempt, retried later: setting the host recovers it.
      expect(await jobOf(b.bookingId)).toEqual({
        status: 'PENDING',
        attempts: 1,
        later: true,
      });
      expect(await mailpit.emailsTo(lender.email)).toEqual([]);
    });

    it('drops a job that can’t be rendered instead of retrying it forever', async () => {
      const lender = await person('Lena');
      const bookingId = randomUUID();
      await service.dataSource.query(
        `INSERT INTO email_jobs (kind, recipient_id, data)
         VALUES ('BOOKING_REQUESTED', $1, $2)`,
        [
          lender.userId,
          JSON.stringify({
            otherId: randomUUID(),
            itemTitle: 'Drill',
            bookingId,
            start: 'not a time',
          }),
        ],
      );
      await service.sendDue();
      expect(await jobOf(bookingId)).toMatchObject({ status: 'DROPPED' });
    });
  });
});
