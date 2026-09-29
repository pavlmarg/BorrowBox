import { Module } from '@nestjs/common';
import { PasswordAuthModule } from '../auth/password-auth.module';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOidcClient } from './google-oidc.client';
import { GoogleController } from './google.controller';

/** Google sign-in (OIDC authorization code + PKCE) with auto-linking by verified email. */
@Module({
  imports: [PasswordAuthModule],
  controllers: [GoogleController],
  providers: [GoogleOidcClient, GoogleAuthService],
})
export class GoogleAuthModule {}
