import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import { pemFromEnv, type AuthUser } from '@borrowbox/auth';
import {
  HANDOFF_CODE_ATTEMPTS,
  HANDOFF_TOKEN_REFRESH_SECONDS,
  pickupOpensAt,
  type ActiveRentalsResponse,
  type BookingView,
  type HandoffPhase,
  type HandoffTokenResponse,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import {
  currentPhase,
  findBooking,
  isQuestionOpen,
  lockBooking,
  toView,
  type BookingRow,
} from '../bookings/bookings.repository';
import type { BookingsConfig } from '../config';
import { ExpiryQueue } from '../expiry/expiry-queue';
import { ChatPublisher, ChatPushes } from '../messaging/chat-publisher';
import { findUser } from '../read-models/users.repository';
import { BookingsError } from '../rpc/rpc-errors';
import type {
  HandoffAnswerDto,
  HandoffScanDto,
  HandoffTokenDto,
} from './handoff.dto';
import { hasActiveRentals, saveAnswer } from './handoff.repository';
import { HandoffStore, HandoffStoreUnavailable } from './handoff-store';
import { applyAnswers, recordPickup, recordReturn } from './handoff-timeline';
import { HandoffTokens, type HandoffClaims } from './handoff-token';

const NOT_FOUND = () => new BookingsError('NOT_FOUND', 'Booking not found');
const TOKEN_INVALID = () =>
  new BookingsError('TOKEN_INVALID', 'This code is not valid for this booking');
const TOKEN_EXPIRED = () =>
  new BookingsError('TOKEN_EXPIRED', 'This code has expired; scan the new one');
const RATE_LIMITED = () =>
  new BookingsError('RATE_LIMITED', 'Too many wrong codes; try again later');
const UNAVAILABLE = () =>
  new BookingsError(
    'HANDOFF_UNAVAILABLE',
    'Handoffs are unavailable right now; try again shortly',
  );
const invalidState = (message: string) =>
  new BookingsError('INVALID_STATE', message);

/**
 * The QR handoff (ARCHITECTURE.md §5, ADR-0026). The person handing the
 * item over shows a signed, 45-second, single-use token (the lender at
 * pickup, the renter at return); the other scans it or types its code.
 * When nobody scans, both answer "did it happen?" (`answer`).
 *
 * Someone else's booking answers NOT_FOUND. Repeating a scan or an answer
 * that already took effect succeeds without a second event.
 */
@Injectable()
export class HandoffService {
  private readonly tokens: HandoffTokens;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    config: ConfigService<BookingsConfig, true>,
    private readonly store: HandoffStore,
    private readonly expiry: ExpiryQueue,
    private readonly chat: ChatPublisher,
  ) {
    this.tokens = new HandoffTokens(
      pemFromEnv(
        config.get('HANDOFF_PRIVATE_KEY', { infer: true }),
        'HANDOFF_PRIVATE_KEY',
      ),
    );
  }

  /** A fresh token for the person showing the code; the PWA polls it. */
  async token(
    user: AuthUser,
    dto: HandoffTokenDto,
    now = new Date(),
  ): Promise<HandoffTokenResponse> {
    const tx = this.dataSource.manager;
    await this.assertActive(tx, user);
    const row = await findBooking(tx, dto.bookingId);
    if (!row || !isParty(row, user)) throw NOT_FOUND();
    if (user.userId !== showerOf(row, dto.phase)) {
      throw invalidState(
        dto.phase === 'PICKUP'
          ? 'The lender shows the pickup code'
          : 'The renter shows the return code',
      );
    }
    assertOpen(row, dto.phase, now);
    const issued = this.tokens.issue(row.id, dto.phase, now);
    await this.guard(() =>
      this.store.saveCode(row.id, dto.phase, issued.code, issued.token),
    );
    return {
      token: issued.token,
      code: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
      refreshAfterSeconds: HANDOFF_TOKEN_REFRESH_SECONDS,
    };
  }

  /** The other person scanned the QR code or typed its code. */
  async scan(
    user: AuthUser,
    dto: HandoffScanDto,
    correlationId: string,
    now = new Date(),
  ): Promise<BookingView> {
    const claims = await this.claimsOf(dto, now);
    if (claims.bookingId !== dto.bookingId) throw TOKEN_INVALID();
    const pushes = new ChatPushes();
    const row = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const locked = await lockBooking(tx, dto.bookingId);
      if (!locked || !isParty(locked, user)) throw NOT_FOUND();
      if (isDone(locked, claims.phase)) return locked;
      const shower = showerOf(locked, claims.phase);
      if (user.userId === shower) {
        throw new BookingsError(
          'NOT_COUNTERPARTY',
          'The other person has to scan this code',
        );
      }
      assertOpen(locked, claims.phase, now);
      if (!(await this.guard(() => this.store.spendNonce(claims.nonce)))) {
        throw TOKEN_EXPIRED();
      }
      const method = dto.token ? 'QR' : 'CODE';
      const cause = { correlationId };
      if (claims.phase === 'PICKUP') {
        return recordPickup(
          tx,
          locked,
          method,
          shower,
          user.userId,
          now,
          cause,
          pushes,
        );
      }
      // A return scanned while the pickup waits for an admin proves the
      // pickup happened too (ADR-0026).
      const out =
        locked.status === 'PICKED_UP'
          ? locked
          : await recordPickup(
              tx,
              locked,
              'RETURN_SCAN',
              null,
              null,
              now,
              cause,
              pushes,
            );
      return recordReturn(
        tx,
        out,
        method,
        shower,
        user.userId,
        now,
        cause,
        pushes,
      );
    });
    await this.chat.flush(pushes);
    await this.schedule(row);
    return toView(row, user.userId);
  }

  /** "Did the handoff happen?" Final once given (ADR-0026). */
  async answer(
    user: AuthUser,
    dto: HandoffAnswerDto,
    correlationId: string,
    now = new Date(),
  ): Promise<BookingView> {
    const pushes = new ChatPushes();
    const row = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const locked = await lockBooking(tx, dto.bookingId);
      if (!locked || !isParty(locked, user)) throw NOT_FOUND();
      if (isDone(locked, dto.phase)) return locked;
      if (currentPhase(locked) !== dto.phase || !isQuestionOpen(locked)) {
        throw invalidState('There is nothing to confirm for this booking');
      }
      const saved = await saveAnswer(tx, {
        bookingId: locked.id,
        phase: dto.phase,
        userId: user.userId,
        answer: dto.answer,
      });
      if (saved !== dto.answer) {
        throw invalidState('You already answered');
      }
      const fresh = (await findBooking(tx, locked.id)) as BookingRow;
      const decided = await applyAnswers(
        tx,
        fresh,
        dto.phase,
        false,
        now,
        { correlationId },
        pushes,
      );
      return decided ?? fresh;
    });
    await this.chat.flush(pushes);
    await this.schedule(row);
    return toView(row, user.userId);
  }

  /** Whether the caller has an item out: the erasure guard (ADR-0026). */
  async activeRentals(user: AuthUser): Promise<ActiveRentalsResponse> {
    return {
      active: await hasActiveRentals(this.dataSource.manager, user.userId),
    };
  }

  // --- helpers ----------------------------------------------------------------

  /** The token's claims, from a scanned token or a typed code. */
  private async claimsOf(
    dto: HandoffScanDto,
    now: Date,
  ): Promise<HandoffClaims> {
    let token = dto.token;
    if (!token) {
      if (!dto.code || !dto.phase || dto.token !== undefined) {
        throw new BookingsError(
          'VALIDATION_FAILED',
          'Invalid fields: token or phase and code',
        );
      }
      const { phase, code } = dto;
      const wrong = await this.guard(() =>
        this.store.wrongCodes(dto.bookingId, phase),
      );
      if (wrong >= HANDOFF_CODE_ATTEMPTS) throw RATE_LIMITED();
      const found = await this.guard(() =>
        this.store.tokenForCode(dto.bookingId, phase, code),
      );
      if (!found) {
        const count = await this.guard(() =>
          this.store.countWrongCode(dto.bookingId, phase),
        );
        throw count >= HANDOFF_CODE_ATTEMPTS ? RATE_LIMITED() : TOKEN_INVALID();
      }
      token = found;
    } else if (dto.code !== undefined) {
      throw new BookingsError(
        'VALIDATION_FAILED',
        'Invalid fields: token or phase and code',
      );
    }
    const claims = this.tokens.read(token, now);
    if (claims === 'INVALID') throw TOKEN_INVALID();
    if (claims === 'EXPIRED') throw TOKEN_EXPIRED();
    if (dto.phase && dto.phase !== claims.phase) throw TOKEN_INVALID();
    return claims;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HandoffStoreUnavailable) throw UNAVAILABLE();
      throw err;
    }
  }

  /** The timeline's next look at the booking, if any. */
  private async schedule(row: BookingRow): Promise<void> {
    if (row.handoff_due_at) {
      await this.expiry.checkAt(row.id, row.handoff_due_at);
    }
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

/** Who shows the code: the lender at pickup, the renter at return. */
function showerOf(row: BookingRow, phase: HandoffPhase): string {
  return phase === 'PICKUP' ? row.lender_id : row.renter_id;
}

/**
 * Whether the handoff can be scanned now: the pickup from 2 hours before
 * the start while the booking goes ahead; the return while the item is
 * out, or while the pickup waits for an admin (a return proves it).
 */
function assertOpen(row: BookingRow, phase: HandoffPhase, now: Date): void {
  const goingAhead = row.status === 'PAID' || row.status === 'CONFIRMED';
  if (phase === 'PICKUP') {
    if (!goingAhead)
      throw invalidState('This booking is not waiting for a pickup');
    if (now.getTime() < pickupOpensAt(row.start).getTime()) {
      throw invalidState('The pickup opens 2 hours before the start');
    }
    return;
  }
  if (
    row.status === 'PICKED_UP' ||
    (goingAhead && row.review_reason === 'PICKUP_UNCONFIRMED')
  ) {
    return;
  }
  throw invalidState('This booking is not waiting for a return');
}

/** True if the handoff already happened (a repeat after a lost response). */
function isDone(row: BookingRow, phase: HandoffPhase): boolean {
  const after =
    phase === 'PICKUP'
      ? ['PICKED_UP', 'RETURNED', 'COMPLETED', 'DISPUTED']
      : ['RETURNED', 'COMPLETED', 'DISPUTED'];
  return after.includes(row.status);
}
