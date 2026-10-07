import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

/** The lender's own items: create, edit, locate, publish, pause, delete. */
@Module({ controllers: [ItemsController], providers: [ItemsService] })
export class ItemsModule {}
