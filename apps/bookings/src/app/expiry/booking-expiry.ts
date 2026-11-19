import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { moveBooking } from '../bookings/booking-transitions';
import { ChatPublisher, ChatPushes } from '../messaging/chat-publisher';
import {
  listDueExpiries,
  lockBooking,
  type BookingRow,
} from '../bookings/bookings.repository';
import { listDueHandoffs } from '../handoff/handoff.repository';
import { advanceHandoff } from '../handoff/handoff-timeline';
import { ExpiryQueue } from './expiry-queue';

/** How many due bookings one sweep handles; the next sweep takes the rest. */
const SWEEP_BATCH = 500;

/**
 * A booking's timers:
 * - a request nobody answered within 24 hours (`NO_ANSWER`), or whose start
 *   came first (`STARTED`), expires;
 * - an accepted booking still unpaid at its pay-by time, 24 hours after
 *   the acceptance or its start if sooner (`PAYMENT_TIMEOUT`, ADR-0019),
 *   expires;
 * - the handoff timeline (ADR-0026): "did it happen?" rounds, their
 *   outcome, and the end of the claim window.
 *
 * Every check re-reads the booking under its row lock, so a job that fires
 * late, twice, or after an answer does nothing wrong.
 */
@Injectable()
export class BookingExpiry {
  private readonly logger = new Logger('BookingExpiry');

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly chat: ChatPublisher,
    private readonly queue: ExpiryQueue,
  ) {}

  /** @returns true if the booking changed now */
  async expire(bookingId: string, now = new Date()): Promise<boolean> {
    const pushes = new ChatPushes();
    const result = await this.dataSource.transaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId);
      if (!booking) return null;
      const started = booking.start.getTime() <= now.getTime();
      if (booking.status === 'REQUESTED') {
        const due =
          started ||
          (booking.expires_at !== null &&
            booking.expires_at.getTime() <= now.getTime());
        if (!due) return null;
        return moveBooking(
          tx,
          booking,
          { to: 'EXPIRED', reason: started ? 'STARTED' : 'NO_ANSWER' },
          null,
          pushes,
          now,
        );
      }
      if (
        booking.status === 'ACCEPTED' &&
        booking.pay_by !== null &&
        booking.pay_by.getTime() <= now.getTime()
      ) {
        return moveBooking(
          tx,
          booking,
          { to: 'EXPIRED', reason: 'PAYMENT_TIMEOUT' },
          null,
          pushes,
          now,
        );
      }
      if (
        booking.handoff_due_at !== null &&
        booking.handoff_due_at.getTime() <= now.getTime()
      ) {
        return advanceHandoff(tx, booking, now, null, pushes);
      }
      return null;
    });
    if (!result) return false;
    await this.chat.flush(pushes);
    await this.scheduleNext(result);
    return true;
  }

  /** Handles everything due that a lost job left behind. Never throws. */
  async sweep(now = new Date()): Promise<number> {
    let changed = 0;
    try {
      const tx = this.dataSource.manager;
      const ids = new Set([
        ...(await listDueExpiries(tx, SWEEP_BATCH)),
        ...(await listDueHandoffs(tx, SWEEP_BATCH, now)),
      ]);
      for (const id of ids) {
        if (await this.expire(id, now)) changed++;
      }
      if (changed > 0) this.logger.log(`Swept ${changed} due booking(s)`);
    } catch (err) {
      this.logger.warn(
        `Sweep failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
    return changed;
  }

  /** The handoff timeline's next look, if any. */
  private async scheduleNext(row: BookingRow): Promise<void> {
    if (row.handoff_due_at) {
      await this.queue.checkAt(row.id, row.handoff_due_at);
    }
  }
}
