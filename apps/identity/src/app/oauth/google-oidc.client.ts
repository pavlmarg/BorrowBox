import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as oidc from 'openid-client';
import { GOOGLE_HTTP_TIMEOUT_MS } from '@borrowbox/contracts';
import type { IdentityConfig } from '../config';
import { IdentityError } from '../rpc/rpc-errors';

/** The id_token claims Identity relies on, already validated. */
export interface GoogleIdentity {
  /** Google's stable account id; the only thing we match accounts on. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
}

export interface GoogleCodeExchange {
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  /** Google's `iss` redirect parameter (RFC 9207). */
  iss?: string;
}

const exchangeFailed = (message = 'Google sign-in failed, try again') =>
  new IdentityError('OAUTH_EXCHANGE_FAILED', message);

/**
 * Authorization-code exchange with Google (OIDC + PKCE) via openid-client,
 * which verifies the id_token signature (Google's JWKS), iss, aud, exp and
 * nonce. Discovery is lazy so Identity starts without network access.
 */
@Injectable()
export class GoogleOidcClient {
  private readonly logger = new Logger(GoogleOidcClient.name);
  private configuration?: Promise<oidc.Configuration>;

  constructor(private readonly config: ConfigService<IdentityConfig, true>) {}

  /**
   * Truthiness, not `!== undefined`: for a value validation mapped to
   * undefined (`GOOGLE_CLIENT_ID=`), ConfigService falls back to the raw ''.
   */
  get enabled(): boolean {
    return Boolean(this.config.get('GOOGLE_CLIENT_ID', { infer: true }));
  }

  async exchange(input: GoogleCodeExchange): Promise<GoogleIdentity> {
    if (!this.enabled) {
      throw exchangeFailed('Google sign-in is not configured');
    }
    let claims: oidc.IDToken | undefined;
    try {
      const configuration = await this.discover();
      // Rebuild Google's redirect. The gateway already checked `state`
      // against its signed cookie; `iss` must be present because Google's
      // discovery sets authorization_response_iss_parameter_supported.
      const callback = new URL(input.redirectUri);
      callback.searchParams.set('code', input.code);
      if (input.iss !== undefined) callback.searchParams.set('iss', input.iss);
      const tokens = await oidc.authorizationCodeGrant(
        configuration,
        callback,
        {
          pkceCodeVerifier: input.codeVerifier,
          expectedNonce: input.nonce,
          expectedState: oidc.skipStateCheck,
          idTokenExpected: true,
        },
      );
      claims = tokens.claims();
    } catch (err) {
      // Log the failure kind only: messages/causes can include tokens or claims.
      const e = err as { name?: string; code?: string };
      this.logger.warn(
        `Google code exchange failed: ${e?.name ?? 'Error'}${e?.code ? ` (${e.code})` : ''}`,
      );
      throw exchangeFailed();
    }

    if (
      !claims ||
      typeof claims.sub !== 'string' ||
      typeof claims['email'] !== 'string'
    ) {
      throw exchangeFailed();
    }
    return {
      subject: claims.sub,
      email: claims['email'],
      emailVerified: claims['email_verified'] === true,
      name: typeof claims['name'] === 'string' ? claims['name'] : undefined,
    };
  }

  private discover(): Promise<oidc.Configuration> {
    this.configuration ??= this.createConfiguration().catch((err) => {
      this.configuration = undefined; // retry discovery on the next call
      throw err;
    });
    return this.configuration;
  }

  private createConfiguration(): Promise<oidc.Configuration> {
    const issuer = new URL(this.config.get('GOOGLE_ISSUER', { infer: true }));
    // Plain HTTP only for a local fake provider in tests; never for real issuers.
    const local =
      issuer.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(issuer.hostname);
    return oidc.discovery(
      issuer,
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }) as string,
      undefined,
      oidc.ClientSecretPost(
        this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      ),
      {
        // Seconds, per request to Google. Shared with the gateway, which
        // derives its wait for the whole exchange from it.
        timeout: GOOGLE_HTTP_TIMEOUT_MS / 1000,
        ...(local ? { execute: [oidc.allowInsecureRequests] } : {}),
      },
    );
  }
}
