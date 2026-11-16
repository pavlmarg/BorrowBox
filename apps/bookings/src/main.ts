import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';
import { resolveDispute } from './app/claims/resolve-dispute.task';

runService({
  name: 'Bookings',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'BOOKINGS_HOST',
  portKey: 'BOOKINGS_PORT',
  tasks: {
    // Development only: decides a dispute as the admin area will (ADR-0028).
    'resolve-dispute': resolveDispute,
  },
});
