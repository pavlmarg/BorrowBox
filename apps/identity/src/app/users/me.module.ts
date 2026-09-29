import { Module } from '@nestjs/common';
import { PasswordAuthModule } from '../auth/password-auth.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/** Profile, GDPR export and account deletion for the signed-in user. */
@Module({
  imports: [PasswordAuthModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
