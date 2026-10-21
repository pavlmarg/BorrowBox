import { CreateOutboxTables1759140000000 } from '@borrowbox/outbox';
import { DatabaseModule } from '@borrowbox/service-kit';
import { NotificationsInitial1761500000000 } from './migrations/1761500000000-notifications-initial';

/**
 * The outbox tables come with `processed_events`, which the consumer needs.
 * Notifications publishes nothing for now, so its outbox stays empty.
 */
export const MIGRATIONS = [
  CreateOutboxTables1759140000000,
  NotificationsInitial1761500000000,
];

/** Notifications' DataSource as `DATA_SOURCE` (from `@borrowbox/service-kit`). */
export const NotificationsDatabaseModule = DatabaseModule.forRoot(MIGRATIONS);
