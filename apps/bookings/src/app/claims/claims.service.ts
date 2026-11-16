import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  CLAIM_DESCRIPTION_MAX_LENGTH,
  CLAIM_DESCRIPTION_MIN_LENGTH,
  CLAIM_MIN_CENTS,
  CLAIM_REPLY_MAX_LENGTH,
  claimTextProblem,
  createEnvelope,
  DisputeDisagreedV1,
  type ClaimResponse,
  type ClaimView,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { moveBooking } from '../bookings/booking-transitions';
import {
  findBooking,
  lockBooking,
  toSnapshot,
  type BookingRow,
} from '../bookings/bookings.repository';
import { ChatPublisher, ChatPushes } from '../messaging/chat-publisher';
import { addBookingLine } from '../messaging/system-messages';
import { findUser } from '../read-models/users.repository';
import { BookingsError } from '../rpc/rpc-errors';
import type { AnswerClaimDto, FileClaimDto } from './claims.dto';
import {
  findClaim,
  insertClaim,
  markDisagreed,
  readyPhotosOf,
  toClaimView,
  type ClaimRow,
} from './claims.repository';
import { resolveClaim } from './resolve-claim';

const NOT_FOUND = () => new BookingsError('NOT_FOUND', 'Booking not found');
const NO_CLAIM = () => new BookingsError('NOT_FOUND', 'Claim not found');
const invalidState = (message: string) =>
  new BookingsError('INVALID_STATE', message);
const invalid = (field: string) =>
  new BookingsError('VALIDATION_FAILED', `Invalid fields: ${field}`);

/**
 * Damage claims (ADR-0028). The lender files one while the booking is
 * RETURNED and its claim window open; the renter agrees (resolved with the
 * claimed amount) or disagrees (an admin decides); the lender may withdraw
 * (resolved with nothing). Every command locks the booking's row; repeating
 * one that already took effect returns the claim as it is.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly chat: ChatPublisher,
  ) {}

  async file(
    user: AuthUser,
    dto: FileClaimDto,
    correlationId: string,
    now = new Date(),
  ): Promise<ClaimView> {
    const pushes = new ChatPushes();
    const claim = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const booking = await this.lockAsParty(tx, dto.bookingId, user);
      if (booking.lender_id !== user.userId) {
        throw invalidState('Only the lender can file a damage claim');
      }
      const existing = await findClaim(tx, booking.id);
      if (existing) {
        throw new BookingsError(
          'CLAIM_EXISTS',
          'This booking already has a damage claim',
        );
      }
      if (
        booking.status !== 'RETURNED' ||
        !booking.claim_until ||
        booking.claim_until.getTime() <= now.getTime()
      ) {
        throw invalidState('The claim window is closed');
      }
      if (
        dto.amountCents < CLAIM_MIN_CENTS ||
        dto.amountCents > booking.deposit_cents
      ) {
        throw invalid('amountCents');
      }
      const description = dto.description.trim();
      if (
        claimTextProblem(
          description,
          CLAIM_DESCRIPTION_MIN_LENGTH,
          CLAIM_DESCRIPTION_MAX_LENGTH,
        )
      ) {
        throw invalid('description');
      }
      const photoIds = [...new Set(dto.photoIds ?? [])];
      if (
        (await readyPhotosOf(tx, booking.id, photoIds)).length !==
        photoIds.length
      ) {
        throw invalid('photoIds');
      }
      await insertClaim(tx, {
        bookingId: booking.id,
        amountCents: dto.amountCents,
        description,
        photoIds,
      });
      await moveBooking(
        tx,
        booking,
        { to: 'DISPUTED', claimCents: dto.amountCents },
        { correlationId },
        pushes,
        now,
      );
      return (await findClaim(tx, booking.id)) as ClaimRow;
    });
    await this.chat.flush(pushes);
    return toClaimView(claim);
  }

  /** The lender takes it back: the booking completes with no award. */
  async withdraw(
    user: AuthUser,
    bookingId: string,
    correlationId: string,
  ): Promise<ClaimView> {
    const pushes = new ChatPushes();
    const claim = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const booking = await this.lockAsParty(tx, bookingId, user);
      const claim = await findClaim(tx, booking.id);
      if (!claim) throw NO_CLAIM();
      if (booking.lender_id !== user.userId) {
        throw invalidState('Only the lender can withdraw the claim');
      }
      if (claim.status === 'WITHDRAWN') return claim;
      if (claim.status !== 'OPEN' && claim.status !== 'DISAGREED') {
        throw invalidState('This claim is already resolved');
      }
      return (
        await resolveClaim(
          tx,
          booking,
          claim,
          'LENDER_WITHDREW',
          0,
          { correlationId },
          pushes,
        )
      ).claim;
    });
    await this.chat.flush(pushes);
    return toClaimView(claim);
  }

  /** The renter agrees (final; settled at once) or disagrees (an admin decides). */
  async answer(
    user: AuthUser,
    dto: AnswerClaimDto,
    correlationId: string,
  ): Promise<ClaimView> {
    const reply = dto.reply?.trim() || null;
    if (reply !== null && claimTextProblem(reply, 1, CLAIM_REPLY_MAX_LENGTH)) {
      throw invalid('reply');
    }
    const pushes = new ChatPushes();
    const claim = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const booking = await this.lockAsParty(tx, dto.bookingId, user);
      const claim = await findClaim(tx, booking.id);
      if (!claim) throw NO_CLAIM();
      if (booking.renter_id !== user.userId) {
        throw invalidState('Only the renter can answer the claim');
      }
      const repeat =
        (dto.answer === 'AGREE' && claim.status === 'AGREED') ||
        (dto.answer === 'DISAGREE' && claim.status === 'DISAGREED');
      if (repeat) return claim;
      if (claim.status !== 'OPEN') {
        throw invalidState('This claim was already answered');
      }
      if (dto.answer === 'AGREE') {
        return (
          await resolveClaim(
            tx,
            booking,
            claim,
            'RENTER_AGREED',
            claim.amount_cents,
            { correlationId },
            pushes,
            reply,
          )
        ).claim;
      }
      await markDisagreed(tx, booking.id, reply);
      await addToOutbox(
        tx,
        createEnvelope(
          DisputeDisagreedV1,
          { ...toSnapshot(booking), claimCents: claim.amount_cents },
          { correlationId },
        ),
      );
      await addBookingLine(tx, booking, 'CLAIM_DISAGREED', pushes);
      return (await findClaim(tx, booking.id)) as ClaimRow;
    });
    await this.chat.flush(pushes);
    return toClaimView(claim);
  }

  async get(user: AuthUser, bookingId: string): Promise<ClaimResponse> {
    const tx = this.dataSource.manager;
    const booking = await findBooking(tx, bookingId);
    if (!booking || !isParty(booking, user)) throw NOT_FOUND();
    const claim = await findClaim(tx, bookingId);
    return { claim: claim ? toClaimView(claim) : null };
  }

  private async lockAsParty(
    tx: EntityManager,
    bookingId: string,
    user: AuthUser,
  ): Promise<BookingRow> {
    const booking = await lockBooking(tx, bookingId);
    if (!booking || !isParty(booking, user)) throw NOT_FOUND();
    return booking;
  }

  /** An erased account may not act anymore (tokens outlive it by ≤15 min). */
  private async assertActive(tx: EntityManager, user: AuthUser): Promise<void> {
    if ((await findUser(tx, user.userId))?.deleted_at) {
      throw new BookingsError('UNAUTHENTICATED', 'Authentication required');
    }
  }
}

function isParty(row: BookingRow, user: AuthUser): boolean {
  return row.renter_id === user.userId || row.lender_id === user.userId;
}
