import { CreateOutboxTables1759140000000 } from '@borrowbox/outbox';
import { DatabaseModule } from '@borrowbox/service-kit';
import { PaymentsInitial1762500000000 } from './migrations/1762500000000-payments-initial';
import { PaymentsCheckout1762700000000 } from './migrations/1762700000000-payments-checkout';
import { PaymentsRefunds1762900000000 } from './migrations/1762900000000-payments-refunds';

/** The outbox tables come with `processed_events`, which the consumer needs. */
export const MIGRATIONS = [
  CreateOutboxTables1759140000000,
  PaymentsInitial1762500000000,
  PaymentsCheckout1762700000000,
  PaymentsRefunds1762900000000,
];

/** Payments' DataSource as `DATA_SOURCE` (from `@borrowbox/service-kit`). */
export const PaymentsDatabaseModule = DatabaseModule.forRoot(MIGRATIONS);
