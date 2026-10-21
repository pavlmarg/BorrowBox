import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bookings' schema (ADR-0015): bookings, plus read models of items and
 * users kept from Catalog's and Identity's events.
 *
 * Lists and limits are literals on purpose, so this migration never changes
 * with the code: statuses and reasons mirror libs/contracts' bookings.ts,
 * 2160 hours is BOOKING_MAX_HOURS.
 */
export class BookingsInitial1761200000000 implements MigrationInterface {
  name = 'BookingsInitial1761200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Catalog's item snapshot (item.created / item.updated); the newest
    // snapshot wins. DELETED is final.
    await queryRunner.query(`
      CREATE TABLE items (
        item_id          uuid        PRIMARY KEY,
        lender_id        uuid        NOT NULL,
        title            text        NOT NULL,
        pricing          jsonb       NOT NULL,
        deposit_cents    integer     NOT NULL CHECK (deposit_cents >= 0),
        min_rental_hours integer,
        max_rental_hours integer,
        status           text        NOT NULL
          CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'DELETED')),
        -- occurredAt of the snapshot applied last.
        snapshot_at      timestamptz NOT NULL
      )
    `);

    // Identity's user events. A row may exist without a name (the email
    // was verified first). Deletion is final: name and verification go,
    // the id stays so late events can't bring them back.
    await queryRunner.query(`
      CREATE TABLE users (
        user_id           uuid        PRIMARY KEY,
        display_name      text,
        name_updated_at   timestamptz,
        email_verified_at timestamptz,
        deleted_at        timestamptz,
        CONSTRAINT users_deleted_forgotten CHECK (
          deleted_at IS NULL
          OR (display_name IS NULL AND email_verified_at IS NULL))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE bookings (
        id            uuid        PRIMARY KEY,
        item_id       uuid        NOT NULL,
        lender_id     uuid        NOT NULL,
        renter_id     uuid        NOT NULL,
        -- Fixed when requested: later item changes don't touch a booking.
        item_title    text        NOT NULL,
        pricing       jsonb       NOT NULL,
        units         jsonb       NOT NULL,
        rent_cents    integer     NOT NULL CHECK (rent_cents >= 0),
        deposit_cents integer     NOT NULL CHECK (deposit_cents >= 0),
        period        tstzrange   NOT NULL,
        status        text        NOT NULL CHECK (status IN (
          'REQUESTED', 'ACCEPTED', 'CONFIRMED', 'DECLINED', 'EXPIRED',
          'CANCELLED', 'PAID', 'PICKED_UP', 'RETURNED', 'COMPLETED',
          'DISPUTED')),
        reason        text        CHECK (reason IN (
          'LENDER', 'OVERLAP', 'RENTER', 'ITEM_DELETED', 'ACCOUNT_DELETED',
          'NO_ANSWER', 'STARTED')),
        -- While REQUESTED: when the request expires without an answer.
        expires_at    timestamptz,
        -- Milliseconds, like JS dates, so list cursors round-trip exactly.
        created_at    timestamptz NOT NULL
                      DEFAULT date_trunc('milliseconds', now()),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT bookings_not_own_item CHECK (renter_id <> lender_id),
        -- [start, end) on whole hours, 1 hour to 90 days.
        CONSTRAINT bookings_period_whole_hours CHECK (
          NOT isempty(period)
          AND lower_inc(period) AND NOT upper_inc(period)
          AND NOT lower_inf(period) AND NOT upper_inf(period)
          AND mod(extract(epoch FROM lower(period)), 3600) = 0
          AND mod(extract(epoch FROM upper(period)), 3600) = 0
          AND upper(period) - lower(period)
              BETWEEN interval '1 hour' AND interval '2160 hours'),
        -- No double booking (ARCHITECTURE.md §2/§4, ADR-0015).
        CONSTRAINT bookings_no_double_booking
          EXCLUDE USING gist (item_id WITH =, period WITH &&)
          WHERE (status IN ('ACCEPTED', 'CONFIRMED', 'PAID', 'PICKED_UP'))
      )
    `);
    // The two tabs of "my bookings", newest first.
    await queryRunner.query(
      `CREATE INDEX bookings_renter_idx ON bookings (renter_id, created_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX bookings_lender_idx ON bookings (lender_id, created_at DESC, id DESC)`,
    );
    // Open requests that overlap an accepted one; busy periods.
    await queryRunner.query(
      `CREATE INDEX bookings_item_period_idx ON bookings USING gist (item_id, period)`,
    );
    // The expiry sweeper.
    await queryRunner.query(
      `CREATE INDEX bookings_requested_expiry_idx ON bookings (expires_at) WHERE status = 'REQUESTED'`,
    );
    await queryRunner.query(
      `CREATE INDEX bookings_accepted_start_idx ON bookings (lower(period)) WHERE status = 'ACCEPTED'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE bookings`);
    await queryRunner.query(`DROP TABLE users`);
    await queryRunner.query(`DROP TABLE items`);
  }
}
