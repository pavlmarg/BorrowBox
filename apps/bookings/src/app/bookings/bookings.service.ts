import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  BOOKING_ANSWER_HOURS,
  BOOKING_LIST_LIMIT_DEFAULT,
  BOOKING_OPEN_REQUESTS_MAX,
  BookingRequestedV1,
  bookingFees,
  createEnvelope,
  type BookingView,
  type BookingsDataExport,
  type BusyPeriodsResponse,
  type ListBookingsResponse,
  type QuoteResponse,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { ExpiryQueue } from '../expiry/expiry-queue';
import { ChatPublisher, ChatPushes } from '../messaging/chat-publisher';
import { addBookingLine } from '../messaging/system-messages';
import { findItem, type ItemRow } from '../read-models/items.repository';
import {
  canBePaid,
  findUser,
  lockUserBookings,
} from '../read-models/users.repository';
import { BookingsError } from '../rpc/rpc-errors';
import {
  acceptBooking,
  hasSomethingToPay,
  moveBooking,
} from './booking-transitions';
import type {
  ItemPeriodDto,
  ListBookingsDto,
  RequestBookingDto,
} from './bookings.dto';
import {
  busyPeriods,
  countOpenRequests,
  findBooking,
  hasOverlappingOwnBooking,
  insertBooking,
  isPeriodTaken,
  listAllBookings,
  listBookings,
  lockBooking,
  lockItemBookings,
  toSnapshot,
  toView,
  type BookingRow,
} from './bookings.repository';
import { decodeListCursor, encodeListCursor } from './list-cursor';
import { checkPeriod, type Period } from './period';
import { rentFor, type Rent } from './pricing';

const HOUR_MS = 60 * 60 * 1000;

const NOT_FOUND = () => new BookingsError('NOT_FOUND', 'Booking not found');
const ITEM_NOT_FOUND = () => new BookingsError('NOT_FOUND', 'Item not found');
const SLOT_TAKEN = () =>
  new BookingsError('SLOT_TAKEN', 'This time is already booked');
const ID_TAKEN = () =>
  new BookingsError('VALIDATION_FAILED', 'Invalid fields: bookingId');

/** Postgres: a row would break an exclusion constraint (double booking). */
const EXCLUSION_VIOLATION = '23P01';

/**
 * Bookings (ADR-0015). Every command runs in one transaction with the
 * booking's row locked; status changes go through `moveBooking`, so the
 * state machine is checked and the event commits with the change.
 *
 * Someone else's booking answers NOT_FOUND, so its existence is never
 * confirmed. Repeating a command that already took effect succeeds without
 * a second event, so retries after a lost response are safe.
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly expiry: ExpiryQueue,
    private readonly chat: ChatPublisher,
  ) {}

  /** What the period would cost; public, so the item page can show it. */
  async quote(dto: ItemPeriodDto): Promise<QuoteResponse> {
    const item = await findItem(this.dataSource.manager, dto.itemId);
    if (!item || item.status !== 'ACTIVE') throw ITEM_NOT_FOUND();
    const period = checkPeriod(dto.start, dto.end, new Date(), limitsOf(item));
    const rent = rentFor(item.pricing, period.hours);
    const fees = bookingFees(rent.rentCents, item.deposit_cents);
    return {
      itemId: item.item_id,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      rentCents: rent.rentCents,
      depositCents: item.deposit_cents,
      feeCents: fees.renterFeeCents,
      totalCents: fees.chargeCents,
      lenderFeeCents: fees.lenderFeeCents,
      payoutCents: fees.payoutCents,
      units: rent.units,
    };
  }

  /** When a bookable item is taken; never who took it or in which state. */
  async busyPeriods(itemId: string): Promise<BusyPeriodsResponse> {
    const tx = this.dataSource.manager;
    const item = await findItem(tx, itemId);
    if (!item || item.status !== 'ACTIVE') throw ITEM_NOT_FOUND();
    const periods = await busyPeriods(tx, itemId);
    return {
      periods: periods.map((p) => ({
        start: p.start.toISOString(),
        end: p.end.toISOString(),
      })),
    };
  }

  /**
   * A renter asks for a period. The price, deposit and rate card are fixed
   * now. The same booking id again returns the existing booking.
   */
  async request(
    user: AuthUser,
    dto: RequestBookingDto,
    correlationId: string,
  ): Promise<BookingView> {
    const pushes = new ChatPushes();
    const booking = await this.dataSource.transaction(async (tx) => {
      // Before anything is read: serialises the renter's requests with each
      // other (the open-request limit) and with the account's erasure.
      await lockUserBookings(tx, user.userId);
      const renter = await findUser(tx, user.userId);
      if (renter?.deleted_at) throw unauthenticated();

      const existing = await findBooking(tx, dto.bookingId);
      if (existing) {
        // Only a true repeat (same renter, item and period) is answered
        // with the earlier booking; anything else reuses the id by mistake.
        if (
          existing.renter_id === user.userId &&
          existing.item_id === dto.itemId &&
          existing.start.getTime() === new Date(dto.start).getTime() &&
          existing.end.getTime() === new Date(dto.end).getTime()
        ) {
          return existing;
        }
        throw ID_TAKEN();
      }

      // Shared lock: an item deletion waits for this request, then cancels it.
      const item = await findItem(tx, dto.itemId, { share: true });
      if (!item || item.status === 'DRAFT') throw ITEM_NOT_FOUND();
      if (item.lender_id === user.userId) {
        throw new BookingsError('OWN_ITEM', "You can't book your own item");
      }
      const lender = await findUser(tx, item.lender_id);
      if (item.status !== 'ACTIVE' || lender?.deleted_at) {
        throw new BookingsError(
          'ITEM_UNAVAILABLE',
          "This item can't be booked right now",
        );
      }
      if (!renter?.email_verified_at) {
        throw new BookingsError(
          'EMAIL_NOT_VERIFIED',
          'Confirm your email address before booking',
        );
      }

      const now = new Date();
      const period = checkPeriod(dto.start, dto.end, now, limitsOf(item));
      await this.assertCanRequest(tx, user, item, period);
      const rent: Rent = rentFor(item.pricing, period.hours);
      // Fixed now, like the rent: what the renter is shown is what they pay.
      const fees = bookingFees(rent.rentCents, item.deposit_cents);

      await insertBooking(tx, {
        id: dto.bookingId,
        itemId: item.item_id,
        lenderId: item.lender_id,
        renterId: user.userId,
        itemTitle: item.title,
        pricing: item.pricing,
        units: rent.units,
        rentCents: rent.rentCents,
        depositCents: item.deposit_cents,
        feeCents: fees.renterFeeCents,
        lenderFeeCents: fees.lenderFeeCents,
        start: period.start,
        end: period.end,
        expiresAt: new Date(
          Math.min(
            now.getTime() + BOOKING_ANSWER_HOURS * HOUR_MS,
            period.start.getTime(),
          ),
        ),
      });
      const row = (await findBooking(tx, dto.bookingId)) as BookingRow;
      await addToOutbox(
        tx,
        createEnvelope(BookingRequestedV1, toSnapshot(row), {
          correlationId,
        }),
      );
      await addBookingLine(tx, row, 'BOOKING_REQUESTED', pushes);
      return row;
    });
    await this.chat.flush(pushes);
    if (booking.status === 'REQUESTED' && booking.expires_at) {
      await this.expiry.checkAt(booking.id, booking.expires_at);
    }
    return toView(booking, user.userId);
  }

  /**
   * The lender accepts: `CONFIRMED` if there's nothing to pay, else
   * `ACCEPTED`, to be paid by its pay-by time; that needs the lender's
   * payouts set up (ADR-0019). Declines the item's other requests that
   * overlap it, in the same transaction.
   */
  async accept(
    user: AuthUser,
    bookingId: string,
    correlationId: string,
  ): Promise<BookingView> {
    const pushes = new ChatPushes();
    let booking: BookingRow;
    try {
      booking = await this.dataSource.transaction(async (tx) => {
        await this.assertActive(tx, user);
        const found = await this.mustFindAsParty(tx, bookingId, user);
        // Item lock first, then rows, in the same order as every accept.
        await lockItemBookings(tx, found.item_id);
        const row = await this.mustLockAsParty(tx, bookingId, user);
        if (row.lender_id !== user.userId) {
          throw invalidState('Only the lender can accept a request');
        }
        if (row.status === 'ACCEPTED' || row.status === 'CONFIRMED') {
          return row;
        }
        if (row.status !== 'REQUESTED') {
          throw invalidState('Only a request can be accepted');
        }
        assertNotDue(row);
        if (hasSomethingToPay(row) && !(await canBePaid(tx, row.lender_id))) {
          throw new BookingsError(
            'PAYOUTS_NOT_SET_UP',
            'Set up payouts before accepting a paid booking',
          );
        }
        return acceptBooking(tx, row, { correlationId }, pushes);
      });
    } catch (err) {
      if ((err as { code?: string }).code === EXCLUSION_VIOLATION) {
        throw SLOT_TAKEN();
      }
      throw err;
    }
    await this.chat.flush(pushes);
    if (booking.status === 'ACCEPTED' && booking.pay_by) {
      // Unpaid by then, it expires (PAYMENT_TIMEOUT).
      await this.expiry.checkAt(booking.id, booking.pay_by);
    }
    return toView(booking, user.userId);
  }

  /** The lender says no to a request. */
  async decline(
    user: AuthUser,
    bookingId: string,
    correlationId: string,
  ): Promise<BookingView> {
    const pushes = new ChatPushes();
    const view = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const row = await this.mustLockAsParty(tx, bookingId, user);
      if (row.lender_id !== user.userId) {
        throw invalidState('Only the lender can decline a request');
      }
      if (row.status === 'DECLINED') return toView(row, user.userId);
      if (row.status !== 'REQUESTED') {
        throw invalidState('Only a request can be declined');
      }
      const declined = await moveBooking(
        tx,
        row,
        { to: 'DECLINED', reason: 'LENDER' },
        { correlationId },
        pushes,
      );
      return toView(declined, user.userId);
    });
    await this.chat.flush(pushes);
    return view;
  }

  /**
   * The renter withdraws a request; either side cancels an accepted or
   * confirmed booking before it starts. Cancelling a paid booking comes
   * with the refund policy (Phase 4, PR C).
   */
  async cancel(
    user: AuthUser,
    bookingId: string,
    correlationId: string,
  ): Promise<BookingView> {
    const pushes = new ChatPushes();
    const view = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const row = await this.mustLockAsParty(tx, bookingId, user);
      const asRenter = row.renter_id === user.userId;
      if (row.status === 'CANCELLED') return toView(row, user.userId);
      if (row.status === 'REQUESTED') {
        if (!asRenter) {
          throw invalidState('Decline the request instead of cancelling it');
        }
      } else if (row.status === 'ACCEPTED' || row.status === 'CONFIRMED') {
        if (row.start.getTime() <= Date.now()) {
          throw invalidState(
            'A booking can only be cancelled before it starts',
          );
        }
      } else {
        throw invalidState("This booking can't be cancelled");
      }
      const cancelled = await moveBooking(
        tx,
        row,
        { to: 'CANCELLED', reason: asRenter ? 'RENTER' : 'LENDER' },
        { correlationId },
        pushes,
      );
      return toView(cancelled, user.userId);
    });
    await this.chat.flush(pushes);
    return view;
  }

  async get(user: AuthUser, bookingId: string): Promise<BookingView> {
    const row = await this.mustFindAsParty(
      this.dataSource.manager,
      bookingId,
      user,
    );
    return toView(row, user.userId);
  }

  async listMine(
    user: AuthUser,
    dto: ListBookingsDto,
  ): Promise<ListBookingsResponse> {
    const after = dto.cursor ? decodeListCursor(dto.cursor) : null;
    if (dto.cursor && !after) {
      throw new BookingsError('VALIDATION_FAILED', 'Invalid fields: cursor');
    }
    const limit = dto.limit ?? BOOKING_LIST_LIMIT_DEFAULT;
    const rows = await listBookings(this.dataSource.manager, {
      userId: user.userId,
      role: dto.role,
      statuses: dto.statuses?.length ? dto.statuses : null,
      after,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      bookings: page.map((row) => toView(row, user.userId)),
      nextCursor:
        rows.length > limit && last
          ? encodeListCursor({ createdAt: last.created_at, id: last.id })
          : null,
    };
  }

  /**
   * Everything Bookings holds about the caller (GDPR Art. 15/20): their
   * stored name, verification, and their bookings on both sides.
   */
  async exportMe(user: AuthUser): Promise<BookingsDataExport> {
    const tx = this.dataSource.manager;
    const me = await findUser(tx, user.userId);
    const [asRenter, asLender] = await Promise.all([
      listAllBookings(tx, user.userId, 'RENTER'),
      listAllBookings(tx, user.userId, 'LENDER'),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      profile:
        me?.display_name && me.name_updated_at
          ? {
              displayName: me.display_name,
              updatedAt: me.name_updated_at.toISOString(),
            }
          : null,
      emailVerifiedAt: me?.email_verified_at?.toISOString() ?? null,
      asRenter: asRenter.map((row) => toView(row, user.userId)),
      asLender: asLender.map((row) => toView(row, user.userId)),
    };
  }

  // --- helpers ----------------------------------------------------------------

  /** The open-request limit, no duplicate requests, and a free slot. */
  private async assertCanRequest(
    tx: EntityManager,
    user: AuthUser,
    item: ItemRow,
    period: Period,
  ): Promise<void> {
    if (
      (await countOpenRequests(tx, user.userId)) >= BOOKING_OPEN_REQUESTS_MAX
    ) {
      throw new BookingsError(
        'REQUEST_LIMIT_REACHED',
        `You can have up to ${BOOKING_OPEN_REQUESTS_MAX} open requests`,
      );
    }
    if (
      await hasOverlappingOwnBooking(
        tx,
        user.userId,
        item.item_id,
        period.start,
        period.end,
      )
    ) {
      throw new BookingsError(
        'DUPLICATE_REQUEST',
        'You already asked for this item at that time',
      );
    }
    // A friendly early answer; the exclusion constraint is the real guard.
    if (await isPeriodTaken(tx, item.item_id, period.start, period.end)) {
      throw SLOT_TAKEN();
    }
  }

  /**
   * Access tokens outlive an account deletion by up to 15 minutes; once
   * Bookings has processed the deletion, the account may not write anymore.
   */
  private async assertActive(tx: EntityManager, user: AuthUser): Promise<void> {
    if ((await findUser(tx, user.userId))?.deleted_at) {
      throw unauthenticated();
    }
  }

  private async mustFindAsParty(
    tx: EntityManager,
    bookingId: string,
    user: AuthUser,
  ): Promise<BookingRow> {
    const row = await findBooking(tx, bookingId);
    if (!row || !isParty(row, user)) throw NOT_FOUND();
    return row;
  }

  private async mustLockAsParty(
    tx: EntityManager,
    bookingId: string,
    user: AuthUser,
  ): Promise<BookingRow> {
    const row = await lockBooking(tx, bookingId);
    if (!row || !isParty(row, user)) throw NOT_FOUND();
    return row;
  }
}

function isParty(row: BookingRow, user: AuthUser): boolean {
  return row.renter_id === user.userId || row.lender_id === user.userId;
}

function limitsOf(item: ItemRow) {
  return {
    minRentalHours: item.min_rental_hours,
    maxRentalHours: item.max_rental_hours,
  };
}

/** A request past its deadline is about to expire; it can't be accepted. */
function assertNotDue(row: BookingRow): void {
  const now = Date.now();
  if (
    row.start.getTime() <= now ||
    (row.expires_at !== null && row.expires_at.getTime() <= now)
  ) {
    throw invalidState('This request has expired');
  }
}

function invalidState(message: string): BookingsError {
  return new BookingsError('INVALID_STATE', message);
}

function unauthenticated(): BookingsError {
  return new BookingsError('UNAUTHENTICATED', 'Authentication required');
}
