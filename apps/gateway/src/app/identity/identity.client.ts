import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import {
  IdentityRpc,
  type IdentityErrorCode,
  type IdentityRpcContract,
} from '@borrowbox/contracts';
import { RPC_TIMEOUT_MS } from '../rpc/rpc.providers';
import { ServiceClient } from '../rpc/service-client';

export const IDENTITY_PROXY = Symbol('IDENTITY_PROXY');

const STATUS: Record<IdentityErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_REFRESH_TOKEN: HttpStatus.UNAUTHORIZED,
  REAUTHENTICATION_REQUIRED: HttpStatus.FORBIDDEN,
  EMAIL_TAKEN: HttpStatus.CONFLICT,
  OAUTH_EXCHANGE_FAILED: HttpStatus.BAD_GATEWAY,
  // The user's Google email isn't verified: a refusal, not an upstream failure.
  OAUTH_EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Identity gives each request to Google 10 s (google-oidc.client.ts) and a
 * sign-in makes up to three: discovery (first time), token exchange, and
 * Google's signing keys. Wait longer than all of them, or a slow Google could
 * make the gateway report a failure for a sign-in Identity completes.
 */
export const GOOGLE_EXCHANGE_TIMEOUT_MS = 35_000;

/** Typed gateway → Identity client. */
@Injectable()
export class IdentityClient extends ServiceClient<
  IdentityRpcContract,
  IdentityErrorCode
> {
  constructor(
    @Inject(IDENTITY_PROXY) proxy: ClientProxy,
    @Inject(RPC_TIMEOUT_MS) timeoutMs: number,
  ) {
    super({
      name: 'Identity',
      proxy,
      defaultTimeoutMs: timeoutMs,
      statusByCode: STATUS,
      timeoutOverridesMs: {
        [IdentityRpc.googleExchange]: GOOGLE_EXCHANGE_TIMEOUT_MS,
      },
    });
  }
}
