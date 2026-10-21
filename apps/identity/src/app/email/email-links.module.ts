import { Module } from '@nestjs/common';
import { PasswordAuthModule } from '../auth/password-auth.module';
import { EmailLinksController } from './email-links.controller';
import { EmailLinksService } from './email-links.service';
import { EmailModule } from './email.module';

/** Verifying an email and resetting a password through email links (ADR-0016). */
@Module({
  imports: [PasswordAuthModule, EmailModule],
  controllers: [EmailLinksController],
  providers: [EmailLinksService],
})
export class EmailLinksModule {}
