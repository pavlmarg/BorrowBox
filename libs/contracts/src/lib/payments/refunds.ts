import { stripeCostCents } from './fees';

/**
 * Where a paid booking's money goes when it is cancelled or completed
 * (ADR-0021, amending ADR-0019's refund policy). Integer cents only. The
 * PWA uses the same rules to show "you'd get back €X" before someone
 * cancels; Payments uses them to refund and transfer.
 */

/** The amounts of a paid booking, fixed when it was requested (ADR-0020). */
export interface PaidAmounts {
  rentCents: number;
  depositCents: number;
  /** The renter's service fee. */
  feeCents: number;
  /** Taken from the lender's rent for the deposit's cost. */
  lenderFeeCents: number;
}

/** A renter who cancels more than this long before the start gets all but the fee back. */
export const RENTER_FULL_REFUND_HOURS = 24;

/** Why a paid booking was cancelled, as far as the money goes. */
export type CancellationCause =
  /** The renter cancelled, or their account was erased (ADR-0019: the same timing rules). */
  | { by: 'RENTER'; cancelledAt: Date; start: Date }
  /** The lender cancelled, the item was deleted, or the lender's account was erased. */
  | { by: 'NOT_RENTER' }
  /** The payment arrived after the booking had already closed. */
  | { by: 'LATE_PAYMENT' };

export interface CancellationPlan {
  /** Back to the renter's card. */
  refundCents: number;
  /** Transferred to the lender. */
  lenderPayoutCents: number;
  /** What BorrowBox keeps (before Stripe's fee, which Stripe never returns). */
  keptCents: number;
}

export interface SettlementPlan {
  /** Transferred to the lender: the rent minus their deposit fee. */
  transferCents: number;
  /** Back to the renter: the whole deposit. */
  depositRefundCents: number;
  keptCents: number;
}

/** What the renter paid: rent + deposit + fee. */
export function chargeOf(paid: PaidAmounts): number {
  return paid.rentCents + paid.depositCents + paid.feeCents;
}

/**
 * The money of a cancelled paid booking (ADR-0021):
 * - not the renter's doing, or a late payment: everything back;
 * - the renter, more than 24 hours before the start: everything but the
 *   service fee, and never less than Stripe's cost is kept;
 * - the renter, later: the deposit and half the rent back; the lender gets
 *   the other half minus their deposit fee; BorrowBox keeps the fee.
 */
export function cancellationPlan(
  paid: PaidAmounts,
  cause: CancellationCause,
): CancellationPlan {
  const charge = chargeOf(paid);
  if (cause.by !== 'RENTER') {
    return { refundCents: charge, lenderPayoutCents: 0, keptCents: 0 };
  }
  const hoursBefore =
    (cause.start.getTime() - cause.cancelledAt.getTime()) / 3_600_000;
  if (hoursBefore > RENTER_FULL_REFUND_HOURS) {
    const kept = Math.min(
      charge,
      Math.max(paid.feeCents, stripeCostCents(charge)),
    );
    return {
      refundCents: charge - kept,
      lenderPayoutCents: 0,
      keptCents: kept,
    };
  }
  const rentBack = Math.floor(paid.rentCents / 2);
  const lenderHalf = paid.rentCents - rentBack;
  const lenderPayoutCents = Math.max(0, lenderHalf - paid.lenderFeeCents);
  const refundCents = paid.depositCents + rentBack;
  return {
    refundCents,
    lenderPayoutCents,
    keptCents: charge - refundCents - lenderPayoutCents,
  };
}

/** The money of a completed booking: the lender is paid, the deposit goes back. */
export function settlementPlan(paid: PaidAmounts): SettlementPlan {
  const transferCents = paid.rentCents - paid.lenderFeeCents;
  return {
    transferCents,
    depositRefundCents: paid.depositCents,
    keptCents: paid.feeCents + paid.lenderFeeCents,
  };
}
