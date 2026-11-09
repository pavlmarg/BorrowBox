import type { DataSource } from 'typeorm';
import { createEnvelope, PaymentAccountReadyV1 } from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';

/**
 * `nx run payments:republish-accounts`: re-announces every live lender who
 * can be paid (`payment.account_ready`), so a service that started
 * listening later (Bookings, for accepting paid bookings) learns them.
 * RabbitMQ only delivers to queues that exist, so run it once that service
 * is up. Safe to repeat: consumers keep the newest status.
 *
 * The running Payments' relay publishes the rows.
 */
export async function republishAccounts(
  dataSource: DataSource,
): Promise<string> {
  return dataSource.transaction(async (tx) => {
    const rows: Array<{ user_id: string }> = await tx.query(
      `SELECT user_id FROM connected_accounts
        WHERE ready AND deleted_at IS NULL
        ORDER BY created_at, id`,
    );
    for (const row of rows) {
      await addToOutbox(
        tx,
        createEnvelope(PaymentAccountReadyV1, { userId: row.user_id }),
      );
    }
    return `${rows.length} payable account(s) written to the outbox`;
  });
}
