import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';

runService({
  name: 'Notifications',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'NOTIFICATIONS_HOST',
  portKey: 'NOTIFICATIONS_PORT',
});
