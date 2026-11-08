import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  BOOKING_ANSWER_HOURS,
  BOOKING_MIN_LEAD_HOURS,
  BookingRequestedV1,
  bookingFees,
  createEnvelope,
  OFFER_VALID_HOURS,
  OfferSentV1,
  type BookingView,
  type OfferView,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import {
  acceptBooking,
  hasSomethingToPay,
} from '../bookings/booking-transitions';
import {
  findBooking,
  insertBooking,
  isPeriodTaken,
  lockItemBookings,
  toSnapshot,
  toView,
  type BookingRow,
} from '../bookings/bookings.repository';
import { checkPeriod } from '../bookings/period';
import { rentFor } from '../bookings/pricing';
import { ExpiryQueue } from '../expiry/expiry-queue';
import { findItem } from '../read-models/items.repository';
import {
  canBePaid,
  findUser,
  lockUserBookings,
} from '../read-models/users.repository';
import { ChatPublisher, ChatPushes } from './chat-publisher';
import { MessagingError } from './messaging-errors';
import type { BookOfferDto, SendOfferDto } from './messaging.dto';
import {
  findOffer,
  insertMessage,
  insertOffer,
  lockConversation,
  lockOpenOffer,
  setOfferStatus,
  type ConversationRow,
  type OfferRow,
} from './messaging.repository';
import { isParty } from './messaging.service';
import { withdrawOffers } from './offer-withdrawals';
import { offerStatus, toOfferView } from './views';

const HOUR_MS = 60 * 60 * 1000;
/** Postgres: a row would break an exclusion constraint (double booking). */
const EXCLUSION_VIOLATION = '23P01';

const NOT_FOUND = () => new MessagingError('NOT_FOUND', 'Offer not found');
const UNAVAILABLE = () =>
  new MessagingError('OFFER_UNAVAILABLE', 'This offer is no longer available');

/**
 * Price offers in chat (ADR-0018): the lender offers a rent for a period,
 * at most the rate card's; the renter books it, which goes straight to
 * ACCEPTED (or CONFIRMED when nothing is left to pay).
 */
@Injectable()
export class OffersService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly chat: ChatPublisher,
    private readonly expiry: ExpiryQueue,
  ) {}

  /**
   * Sends an offer in the conversation, replacing its open one. The same
   * offer id again returns the existing offer.
   */
  async send(
    user: AuthUser,
    dto: SendOfferDto,
    correlationId: string,
  ): Promise<OfferView> {
    const pushes = new ChatPushes();
    const offer = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const c = await this.mustLockConversation(tx, dto.conversationId, user);
      if (c.lender_id !== user.userId) {
        throw invalidState('Only the lender can send an offer');
      }
      const existing = await findOffer(tx, dto.offerId);
      if (existing) {
        if (existing.conversation_id === c.id) return existing;
        throw new MessagingError(
          'VALIDATION_FAILED',
          'Invalid fields: offerId',
        );
      }
      if (c.closed) {
        throw new MessagingError(
          'CONVERSATION_CLOSED',
          'This conversation is closed',
        );
      }
      const item = await findItem(tx, c.item_id);
      if (!item || item.status !== 'ACTIVE') {
        throw new MessagingError(
          'ITEM_UNAVAILABLE',
          'Offers need a published item',
        );
      }

      const now = new Date();
      const period = checkPeriod(dto.start, dto.end, now, {
        minRentalHours: item.min_rental_hours,
        maxRentalHours: item.max_rental_hours,
      });
      const list = rentFor(item.pricing, period.hours).rentCents;
      if (dto.rentCents > list) {
        throw new MessagingError(
          'PRICE_ABOVE_LIST',
          "An offer can't be more than the listed price",
        );
      }
      // Booking it accepts it at once: something to pay needs payouts (ADR-0019).
      if (
        hasSomethingToPay({
          rent_cents: dto.rentCents,
          deposit_cents: item.deposit_cents,
        }) &&
        !(await canBePaid(tx, c.lender_id))
      ) {
        throw payoutsNotSetUp('Set up payouts before offering a paid booking');
      }

      const old = await lockOpenOffer(tx, c.id);
      if (old)
        await withdrawOffers(tx, [old], 'REPLACED', { correlationId }, pushes);

      const expiresAt = new Date(
        Math.min(
          now.getTime() + OFFER_VALID_HOURS * HOUR_MS,
          period.start.getTime() - BOOKING_MIN_LEAD_HOURS * HOUR_MS,
        ),
      );
      await insertOffer(tx, {
        id: dto.offerId,
        conversationId: c.id,
        itemId: item.item_id,
        lenderId: c.lender_id,
        renterId: c.renter_id,
        start: period.start,
        end: period.end,
        rentCents: dto.rentCents,
        depositCents: item.deposit_cents,
        listRentCents: list,
        expiresAt,
      });
      const messageId = randomUUID();
      await insertMessage(tx, {
        id: messageId,
        conversationId: c.id,
        kind: 'OFFER',
        senderId: user.userId,
        offerId: dto.offerId,
      });
      await addToOutbox(
        tx,
        createEnvelope(
          OfferSentV1,
          {
            offerId: dto.offerId,
            conversationId: c.id,
            itemId: item.item_id,
            itemTitle: c.item_title,
            lenderId: c.lender_id,
            renterId: c.renter_id,
            start: period.start.toISOString(),
            end: period.end.toISOString(),
            rentCents: dto.rentCents,
            depositCents: item.deposit_cents,
            expiresAt: expiresAt.toISOString(),
          },
          { correlationId },
        ),
      );
      pushes.message(messageId);
      return (await findOffer(tx, dto.offerId)) as OfferRow;
    });
    await this.chat.flush(pushes);
    return toOfferView(offer);
  }

  /** The lender takes back an open offer. Withdrawing it again is fine. */
  async withdraw(
    user: AuthUser,
    offerId: string,
    correlationId: string,
  ): Promise<OfferView> {
    const pushes = new ChatPushes();
    const offer = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const offer = await findOffer(tx, offerId, { lock: true });
      if (!offer || !isOfferParty(offer, user.userId)) throw NOT_FOUND();
      if (offer.lender_id !== user.userId) {
        throw invalidState('Only the lender can withdraw an offer');
      }
      if (offer.status === 'WITHDRAWN') return offer;
      if (offerStatus(offer) !== 'OPEN') throw UNAVAILABLE();
      await withdrawOffers(tx, [offer], 'LENDER', { correlationId }, pushes);
      return (await findOffer(tx, offerId)) as OfferRow;
    });
    await this.chat.flush(pushes);
    return toOfferView(offer);
  }

  /**
   * The renter books the offer: one booking at the offer's price, accepted
   * at once, since the lender already agreed (ADR-0018). The same booking id
   * again returns the booking.
   */
  async book(
    user: AuthUser,
    dto: BookOfferDto,
    correlationId: string,
  ): Promise<BookingView> {
    const pushes = new ChatPushes();
    let booking: BookingRow;
    try {
      booking = await this.dataSource.transaction(async (tx) => {
        // The renter's lock first (like requests), then the item's (like accepts).
        await lockUserBookings(tx, user.userId);
        const renter = await findUser(tx, user.userId);
        if (renter?.deleted_at) {
          throw new MessagingError(
            'UNAUTHENTICATED',
            'Authentication required',
          );
        }
        const found = await findOffer(tx, dto.offerId);
        if (!found || !isOfferParty(found, user.userId)) throw NOT_FOUND();
        if (found.renter_id !== user.userId) {
          throw invalidState('Only the renter can book an offer');
        }
        const existing = await findBooking(tx, dto.bookingId);
        if (existing) {
          if (
            existing.offer_id === found.id &&
            existing.renter_id === user.userId
          ) {
            return existing;
          }
          throw new MessagingError(
            'VALIDATION_FAILED',
            'Invalid fields: bookingId',
          );
        }

        await lockItemBookings(tx, found.item_id);
        const offer = (await findOffer(tx, dto.offerId, {
          lock: true,
        })) as OfferRow;
        const now = new Date();
        if (offerStatus(offer, now) !== 'OPEN') throw UNAVAILABLE();
        if (!renter?.email_verified_at) {
          throw new MessagingError(
            'EMAIL_NOT_VERIFIED',
            'Confirm your email address before booking',
          );
        }
        const item = await findItem(tx, offer.item_id, { share: true });
        const lender = await findUser(tx, offer.lender_id);
        if (!item || item.status === 'DELETED' || lender?.deleted_at) {
          throw new MessagingError(
            'ITEM_UNAVAILABLE',
            "This item can't be booked anymore",
          );
        }
        const period = checkPeriod(
          offer.start.toISOString(),
          offer.end.toISOString(),
          now,
          {
            minRentalHours: item.min_rental_hours,
            maxRentalHours: item.max_rental_hours,
          },
        );
        if (await isPeriodTaken(tx, item.item_id, period.start, period.end)) {
          throw slotTaken();
        }

        // The fee is on the offer's price (ADR-0019), fixed now (ADR-0020).
        const fees = bookingFees(offer.rent_cents, offer.deposit_cents);
        await insertBooking(tx, {
          id: dto.bookingId,
          itemId: item.item_id,
          lenderId: offer.lender_id,
          renterId: user.userId,
          itemTitle: item.title,
          pricing: item.pricing,
          units: rentFor(item.pricing, period.hours).units,
          rentCents: offer.rent_cents,
          depositCents: offer.deposit_cents,
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
          offerId: offer.id,
        });
        const requested = (await findBooking(tx, dto.bookingId)) as BookingRow;
        await addToOutbox(
          tx,
          createEnvelope(BookingRequestedV1, toSnapshot(requested), {
            correlationId,
          }),
        );
        // Restricted since the offer was sent: the booking can't go ahead.
        if (
          hasSomethingToPay(requested) &&
          !(await canBePaid(tx, requested.lender_id))
        ) {
          throw payoutsNotSetUp("The lender can't take payments yet");
        }
        const accepted = await acceptBooking(
          tx,
          requested,
          { correlationId },
          pushes,
        );
        await setOfferStatus(tx, offer.id, 'USED', accepted.id);
        pushes.offer(offer.id);
        return accepted;
      });
    } catch (err) {
      if ((err as { code?: string }).code === EXCLUSION_VIOLATION) {
        throw slotTaken();
      }
      throw err;
    }
    await this.chat.flush(pushes);
    if (booking.status === 'ACCEPTED' && booking.pay_by) {
      await this.expiry.checkAt(booking.id, booking.pay_by);
    }
    return toView(booking, user.userId);
  }

  private async assertActive(tx: EntityManager, user: AuthUser): Promise<void> {
    if ((await findUser(tx, user.userId))?.deleted_at) {
      throw new MessagingError('UNAUTHENTICATED', 'Authentication required');
    }
  }

  private async mustLockConversation(
    tx: EntityManager,
    id: string,
    user: AuthUser,
  ): Promise<ConversationRow> {
    const c = await lockConversation(tx, id);
    if (!c || !isParty(c, user.userId)) {
      throw new MessagingError('NOT_FOUND', 'Conversation not found');
    }
    return c;
  }
}

function isOfferParty(o: OfferRow, userId: string): boolean {
  return o.renter_id === userId || o.lender_id === userId;
}

function invalidState(message: string): MessagingError {
  return new MessagingError('INVALID_STATE', message);
}

function slotTaken(): MessagingError {
  return new MessagingError('SLOT_TAKEN', 'This time is already booked');
}

function payoutsNotSetUp(message: string): MessagingError {
  return new MessagingError('PAYOUTS_NOT_SET_UP', message);
}
