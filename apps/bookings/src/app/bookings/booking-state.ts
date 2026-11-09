import type { BookingStatus } from '@borrowbox/contracts';

/**
 * The booking state machine: ARCHITECTURE.md §4 with ADR-0015's changes.
 * Every status change goes through `assertTransition`; nothing else may set
 * a booking's status. Who may trigger a transition is checked by the
 * caller (BookingsService); this table only says which ones exist.
 */
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  REQUESTED: ['ACCEPTED', 'CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED'],
  // PAID on payment.captured; EXPIRED when unpaid by its pay-by time.
  ACCEPTED: ['PAID', 'EXPIRED', 'CANCELLED'],
  // Phase 5: PICKED_UP on the pickup QR scan.
  CONFIRMED: ['CANCELLED', 'PICKED_UP'],
  PAID: ['CANCELLED', 'PICKED_UP'],
  PICKED_UP: ['RETURNED'],
  RETURNED: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['COMPLETED'],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
  COMPLETED: [],
};

/** Statuses a booking can still go somewhere from before anyone meets. */
export const OPEN_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'CONFIRMED',
] as const satisfies readonly BookingStatus[];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Illegal booking transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Throws unless §4 allows `from` → `to`. A bug, not a user error. */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
