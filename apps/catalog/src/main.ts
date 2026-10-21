import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';
import { republishItems } from './app/items/republish-items';

runService({
  name: 'Catalog',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'CATALOG_HOST',
  portKey: 'CATALOG_PORT',
  tasks: { 'republish-items': republishItems },
});
