import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';

runService({
  name: 'Bookings',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'BOOKINGS_HOST',
  portKey: 'BOOKINGS_PORT',
});
