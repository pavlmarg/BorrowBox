import { Module } from '@nestjs/common';
import { PasswordAuthModule } from '../auth/password-auth.module';
import { EmailModule } from '../email/email.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/** Profile, verification email, password change, GDPR export and account deletion for the signed-in user. */
@Module({
  imports: [PasswordAuthModule, EmailModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
