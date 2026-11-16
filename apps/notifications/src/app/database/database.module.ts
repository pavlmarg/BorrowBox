import { CreateOutboxTables1759140000000 } from '@borrowbox/outbox';
import { DatabaseModule } from '@borrowbox/service-kit';
import { NotificationsInitial1761500000000 } from './migrations/1761500000000-notifications-initial';
import { NotificationsPaymentEmails1762800000000 } from './migrations/1762800000000-notifications-payment-emails';
import { NotificationsRefundEmails1763000000000 } from './migrations/1763000000000-notifications-refund-emails';
import { NotificationsHandoffEmails1763300000000 } from './migrations/1763300000000-notifications-handoff-emails';
import { NotificationsClaimEmails1763500000000 } from './migrations/1763500000000-notifications-claim-emails';

/**
 * The outbox tables come with `processed_events`, which the consumer needs.
 * Notifications publishes nothing for now, so its outbox stays empty.
 */
export const MIGRATIONS = [
  CreateOutboxTables1759140000000,
  NotificationsInitial1761500000000,
  NotificationsPaymentEmails1762800000000,
  NotificationsRefundEmails1763000000000,
  NotificationsHandoffEmails1763300000000,
  NotificationsClaimEmails1763500000000,
];

/** Notifications' DataSource as `DATA_SOURCE` (from `@borrowbox/service-kit`). */
export const NotificationsDatabaseModule = DatabaseModule.forRoot(MIGRATIONS);
