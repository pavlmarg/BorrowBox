import { CreateOutboxTables1759140000000 } from '@borrowbox/outbox';
import { DatabaseModule } from '@borrowbox/service-kit';
import { BookingsInitial1761200000000 } from './migrations/1761200000000-bookings-initial';
import { BookingsMessaging1761400000000 } from './migrations/1761400000000-bookings-messaging';
import { BookingsPayments1762600000000 } from './migrations/1762600000000-bookings-payments';
import { BookingsUserPhotos1763100000000 } from './migrations/1763100000000-bookings-user-photos';

export const MIGRATIONS = [
  CreateOutboxTables1759140000000,
  BookingsInitial1761200000000,
  BookingsMessaging1761400000000,
  BookingsPayments1762600000000,
  BookingsUserPhotos1763100000000,
];

/** Bookings' DataSource as `DATA_SOURCE` (from `@borrowbox/service-kit`). */
export const BookingsDatabaseModule = DatabaseModule.forRoot(MIGRATIONS);
