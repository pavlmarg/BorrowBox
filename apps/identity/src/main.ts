import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';

runService({
  name: 'Identity',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'IDENTITY_HOST',
  portKey: 'IDENTITY_PORT',
});
