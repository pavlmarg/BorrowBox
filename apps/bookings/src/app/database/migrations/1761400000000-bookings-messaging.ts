import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * In-app chat (ADR-0017) and price offers (ADR-0018), in the bookings schema
 * until Messaging moves into its own service.
 *
 * Lists and limits are literals on purpose (see BookingsInitial): codes
 * mirror libs/contracts' messaging.ts, 2000 is MESSAGE_TEXT_MAX_LENGTH.
 */
export class BookingsMessaging1761400000000 implements MigrationInterface {
  name = 'BookingsMessaging1761400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // One per item and asker; it carries on into their bookings.
    await queryRunner.query(`
      CREATE TABLE conversations (
        id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id            uuid        NOT NULL,
        lender_id          uuid        NOT NULL,
        renter_id          uuid        NOT NULL,
        item_title         text        NOT NULL,
        created_at         timestamptz NOT NULL
                           DEFAULT date_trunc('milliseconds', now()),
        last_message_at    timestamptz NOT NULL
                           DEFAULT date_trunc('milliseconds', now()),
        renter_read_at     timestamptz,
        lender_read_at     timestamptz,
        -- When each was last emailed about unread messages (30-minute gap).
        renter_reminded_at timestamptz,
        lender_reminded_at timestamptz,
        CONSTRAINT conversations_one_per_asker UNIQUE (item_id, renter_id),
        CONSTRAINT conversations_two_people CHECK (renter_id <> lender_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX conversations_renter_idx ON conversations (renter_id, last_message_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX conversations_lender_idx ON conversations (lender_id, last_message_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX conversations_retention_idx ON conversations (last_message_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE offers (
        id              uuid        PRIMARY KEY,
        conversation_id uuid        NOT NULL
                        REFERENCES conversations (id) ON DELETE CASCADE,
        item_id         uuid        NOT NULL,
        lender_id       uuid        NOT NULL,
        renter_id       uuid        NOT NULL,
        period          tstzrange   NOT NULL,
        rent_cents      integer     NOT NULL CHECK (rent_cents >= 0),
        deposit_cents   integer     NOT NULL CHECK (deposit_cents >= 0),
        -- The rate card's rent for the period; offers are discounts only.
        list_rent_cents integer     NOT NULL,
        status          text        NOT NULL CHECK (status IN (
          'OPEN', 'USED', 'WITHDRAWN', 'REPLACED', 'EXPIRED')),
        expires_at      timestamptz NOT NULL,
        booking_id      uuid,
        created_at      timestamptz NOT NULL
                        DEFAULT date_trunc('milliseconds', now()),
        CONSTRAINT offers_discount_only CHECK (rent_cents <= list_rent_cents)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX offers_one_open ON offers (conversation_id) WHERE status = 'OPEN'`,
    );

    await queryRunner.query(`
      CREATE TABLE messages (
        id              uuid        PRIMARY KEY,
        conversation_id uuid        NOT NULL
                        REFERENCES conversations (id) ON DELETE CASCADE,
        kind            text        NOT NULL
                        CHECK (kind IN ('TEXT', 'SYSTEM', 'OFFER')),
        sender_id       uuid,
        body            text        CHECK (char_length(body) BETWEEN 1 AND 2000),
        -- The sender's account was erased: the text is gone.
        deleted         boolean     NOT NULL DEFAULT false,
        system_code     text        CHECK (system_code IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_DECLINED', 'BOOKING_CANCELLED', 'BOOKING_EXPIRED',
          'OFFER_WITHDRAWN')),
        booking_id      uuid,
        offer_id        uuid        REFERENCES offers (id) ON DELETE CASCADE,
        created_at      timestamptz NOT NULL
                        DEFAULT date_trunc('milliseconds', now()),
        CONSTRAINT messages_sender CHECK ((kind = 'SYSTEM') = (sender_id IS NULL)),
        CONSTRAINT messages_text CHECK (
          (kind = 'TEXT' AND (deleted OR body IS NOT NULL))
          OR (kind <> 'TEXT' AND body IS NULL)),
        CONSTRAINT messages_system_code CHECK ((kind = 'SYSTEM') = (system_code IS NOT NULL)),
        CONSTRAINT messages_offer CHECK ((kind = 'OFFER') = (offer_id IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX messages_sender_idx ON messages (sender_id) WHERE sender_id IS NOT NULL`,
    );

    // Waits for the admin area.
    await queryRunner.query(`
      CREATE TABLE message_reports (
        message_id  uuid        NOT NULL
                    REFERENCES messages (id) ON DELETE CASCADE,
        reporter_id uuid        NOT NULL,
        reason      text        NOT NULL
                    CHECK (reason IN ('SPAM', 'SCAM', 'ABUSE', 'OTHER')),
        created_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, reporter_id)
      )
    `);

    // A booking made from an offer.
    await queryRunner.query(`ALTER TABLE bookings ADD COLUMN offer_id uuid`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE bookings DROP COLUMN offer_id`);
    await queryRunner.query(`DROP TABLE message_reports`);
    await queryRunner.query(`DROP TABLE messages`);
    await queryRunner.query(`DROP TABLE offers`);
    await queryRunner.query(`DROP TABLE conversations`);
  }
}
