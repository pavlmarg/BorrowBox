import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { lockBooking } from '../bookings/bookings.repository';
import { findClaim } from './claims.repository';
import { resolveClaim } from './resolve-claim';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `nx run bookings:resolve-dispute -- --booking <id> --award-cents <n>`:
 * decides an open dispute as an admin will in Phase 6 (ADR-0028), through
 * the same code path, so the money can be tested end to end now. For
 * development and test mode only: refused when NODE_ENV is production.
 *
 * The running Bookings' relay publishes the events; Payments settles.
 */
export async function resolveDispute(
  dataSource: DataSource,
  _config: ConfigService,
  argv: string[] = process.argv.slice(3),
): Promise<string> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('resolve-dispute is for development only');
  }
  const bookingId = argValue(argv, '--booking');
  const award = Number(argValue(argv, '--award-cents'));
  if (!bookingId || !UUID.test(bookingId) || !Number.isInteger(award)) {
    throw new Error(
      'Usage: resolve-dispute --booking <uuid> --award-cents <integer>',
    );
  }
  return dataSource.transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    const claim = booking && (await findClaim(tx, bookingId));
    if (!booking || !claim) throw new Error('No claim for that booking');
    if (booking.status !== 'DISPUTED') {
      throw new Error(`The booking is ${booking.status}, not DISPUTED`);
    }
    if (award < 0 || award > claim.amount_cents) {
      throw new Error(
        `The award must be 0 to the claimed ${claim.amount_cents} cents`,
      );
    }
    await resolveClaim(tx, booking, claim, 'ADMIN', award, null, null);
    return `Dispute on booking ${bookingId} decided: ${award} cents to the lender`;
  });
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}
