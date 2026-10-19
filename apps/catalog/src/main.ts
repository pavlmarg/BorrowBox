import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';

runService({
  name: 'Catalog',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'CATALOG_HOST',
  portKey: 'CATALOG_PORT',
});
