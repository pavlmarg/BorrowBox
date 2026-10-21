import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { moveBooking } from '../bookings/booking-transitions';
import { ChatPublisher, ChatPushes } from '../messaging/chat-publisher';
import { listDueExpiries, lockBooking } from '../bookings/bookings.repository';

/** How many due bookings one sweep handles; the next sweep takes the rest. */
const SWEEP_BATCH = 500;

/**
 * Expires bookings whose time is up (ADR-0015):
 * - a request nobody answered within 24 hours (`NO_ANSWER`), or whose start
 *   came first (`STARTED`);
 * - an accepted booking still unpaid at its start (`STARTED`). Payments
 *   (Phase 4) adds its own payment timeout.
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
  ) {}

  /** @returns true if the booking expired now */
  async expire(bookingId: string, now = new Date()): Promise<boolean> {
    const pushes = new ChatPushes();
    const expired = await this.dataSource.transaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId);
      if (!booking) return false;
      const started = booking.start.getTime() <= now.getTime();
      if (booking.status === 'REQUESTED') {
        const due =
          started ||
          (booking.expires_at !== null &&
            booking.expires_at.getTime() <= now.getTime());
        if (!due) return false;
        await moveBooking(
          tx,
          booking,
          { to: 'EXPIRED', reason: started ? 'STARTED' : 'NO_ANSWER' },
          null,
          pushes,
        );
        return true;
      }
      if (booking.status === 'ACCEPTED' && started) {
        await moveBooking(
          tx,
          booking,
          { to: 'EXPIRED', reason: 'STARTED' },
          null,
          pushes,
        );
        return true;
      }
      return false;
    });
    if (expired) await this.chat.flush(pushes);
    return expired;
  }

  /** Expires everything due that a lost job left behind. Never throws. */
  async sweep(): Promise<number> {
    let expired = 0;
    try {
      const ids = await listDueExpiries(this.dataSource.manager, SWEEP_BATCH);
      for (const id of ids) {
        if (await this.expire(id)) expired++;
      }
      if (expired > 0) this.logger.log(`Swept ${expired} expired booking(s)`);
    } catch (err) {
      this.logger.warn(
        `Sweep failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
    return expired;
  }
}
