import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

/** Damage claims and disputes (ADR-0028). */
@Module({
  controllers: [ClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
