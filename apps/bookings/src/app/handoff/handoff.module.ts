import { Module } from '@nestjs/common';
import { HandoffController } from './handoff.controller';
import { HandoffService } from './handoff.service';
import { HandoffStore } from './handoff-store';

/** QR pickup and return, "did it happen?" answers (ARCHITECTURE.md §5, ADR-0026). */
@Module({
  controllers: [HandoffController],
  providers: [HandoffService, HandoffStore],
})
export class HandoffModule {}
