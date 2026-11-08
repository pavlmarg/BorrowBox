import {
  Catch,
  HttpStatus,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { GatewayConfig } from '../config';

/** The error codes the web app's /auth/callback knows; others become the generic one. */
const OAUTH_REDIRECT_ERRORS = new Set([
  'OAUTH_EXCHANGE_FAILED',
  'OAUTH_EMAIL_NOT_VERIFIED',
  'OAUTH_CANCELLED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
]);

/** The web app's /auth/callback, with `?error=` when sign-in failed. */
export function oauthCallbackUrl(
  webAppUrl: string,
  errorCode?: string,
): string {
  const url = new URL('/auth/callback', webAppUrl);
  if (errorCode) {
    url.searchParams.set(
      'error',
      OAUTH_REDIRECT_ERRORS.has(errorCode)
        ? errorCode
        : 'OAUTH_EXCHANGE_FAILED',
    );
  }
  return url.toString();
}

/**
 * Google sign-in's routes are browser navigations, not API calls: when the
 * rate limit refuses one, the browser goes back to the web app with
 * `?error=RATE_LIMITED` instead of landing on a JSON error page.
 */
@Injectable()
@Catch(ThrottlerException)
export class OAuthRateLimitFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService<GatewayConfig, true>) {}

  catch(_exception: ThrottlerException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .redirect(
        HttpStatus.FOUND,
        oauthCallbackUrl(
          this.config.get('WEB_APP_URL', { infer: true }),
          'RATE_LIMITED',
        ),
      );
  }
}
