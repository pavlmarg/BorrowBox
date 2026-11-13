import { Module } from '@nestjs/common';
import { PasswordAuthModule } from '../auth/password-auth.module';
import { EmailModule } from '../email/email.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PublicProfileController } from './public-profile.controller';

/**
 * Profile, verification email, password change, GDPR export and account
 * deletion for the signed-in user; anyone's public profile.
 */
@Module({
  imports: [PasswordAuthModule, EmailModule],
  controllers: [MeController, PublicProfileController],
  providers: [MeService],
})
export class MeModule {}
