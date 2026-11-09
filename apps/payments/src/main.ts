import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';

runService({
  name: 'Payments',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'PAYMENTS_HOST',
  portKey: 'PAYMENTS_PORT',
});
