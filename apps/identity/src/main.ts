import 'reflect-metadata';
import { runService } from '@borrowbox/service-kit';
import { AppModule, MigrateModule } from './app/app.module';
import {
  republishRegistered,
  republishUsers,
} from './app/users/republish-users';

runService({
  name: 'Identity',
  appModule: AppModule,
  migrateModule: MigrateModule,
  hostKey: 'IDENTITY_HOST',
  portKey: 'IDENTITY_PORT',
  tasks: {
    'republish-users': republishUsers,
    'republish-registered': republishRegistered,
  },
});
