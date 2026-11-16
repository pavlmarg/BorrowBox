import type { EntityManager } from 'typeorm';
import {
  createEnvelope,
  DisputeResolvedV1,
  type DisputeResolution,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { moveBooking, type Cause } from '../bookings/booking-transitions';
import { toSnapshot, type BookingRow } from '../bookings/bookings.repository';
import type { ChatPushes } from '../messaging/chat-publisher';
import { addBookingLine } from '../messaging/system-messages';
import { findClaim, markResolved, type ClaimRow } from './claims.repository';

const STATUS: Record<DisputeResolution, 'AGREED' | 'WITHDRAWN' | 'DECIDED'> = {
  RENTER_AGREED: 'AGREED',
  LENDER_WITHDREW: 'WITHDRAWN',
  ADMIN: 'DECIDED',
};

/**
 * Ends a dispute (ADR-0028), the one way for every outcome (the renter
 * agrees, the lender withdraws, an admin or the dev command decides): the
 * claim records the award, the booking moves DISPUTED → COMPLETED with the
 * award on `booking.completed` (which Payments settles), and
 * `dispute.resolved` tells the rest, all in the caller's transaction. The
 * caller holds the booking's row lock and checked who may do this.
 *
 * @param awardCents what goes to the lender from the deposit, 0 to the claim
 */
export async function resolveClaim(
  tx: EntityManager,
  booking: BookingRow,
  claim: ClaimRow,
  resolution: DisputeResolution,
  awardCents: number,
  cause: Cause | null,
  pushes: ChatPushes | null,
  reply: string | null = null,
): Promise<{ booking: BookingRow; claim: ClaimRow }> {
  if (
    !Number.isInteger(awardCents) ||
    awardCents < 0 ||
    awardCents > claim.amount_cents
  ) {
    throw new RangeError('Award outside 0 to the claimed amount');
  }
  await markResolved(tx, booking.id, STATUS[resolution], awardCents, reply);
  await addToOutbox(
    tx,
    createEnvelope(
      DisputeResolvedV1,
      {
        ...toSnapshot(booking),
        claimCents: claim.amount_cents,
        awardCents,
        resolvedBy: resolution,
      },
      cause ?? {},
    ),
  );
  await addBookingLine(tx, booking, 'CLAIM_RESOLVED', pushes);
  const completed = await moveBooking(
    tx,
    booking,
    { to: 'COMPLETED', damageAwardCents: awardCents },
    cause,
    pushes,
  );
  return {
    booking: completed,
    claim: (await findClaim(tx, booking.id)) as ClaimRow,
  };
}
