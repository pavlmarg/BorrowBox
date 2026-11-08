import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import {
  PAYMENTS_STRIPE_REQUESTS,
  PaymentsRpc,
  stripeCallTimeoutMs,
  type PaymentsErrorCode,
  type PaymentsRpcContract,
} from '@borrowbox/contracts';
import { RPC_TIMEOUT_MS } from '../rpc/rpc.providers';
import { ServiceClient } from '../rpc/service-client';

export const PAYMENTS_PROXY = Symbol('PAYMENTS_PROXY');

const STATUS: Record<PaymentsErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN,
  PAYOUTS_NOT_SET_UP: HttpStatus.CONFLICT,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_STATE: HttpStatus.CONFLICT,
  PAYMENT_WINDOW_CLOSED: HttpStatus.CONFLICT,
  INVALID_SIGNATURE: HttpStatus.BAD_REQUEST,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Typed gateway → Payments client (ADR-0005, ADR-0019). */
@Injectable()
export class PaymentsClient extends ServiceClient<
  PaymentsRpcContract,
  PaymentsErrorCode
> {
  constructor(
    @Inject(PAYMENTS_PROXY) proxy: ClientProxy,
    @Inject(RPC_TIMEOUT_MS) timeoutMs: number,
  ) {
    super({
      name: 'Payments',
      proxy,
      defaultTimeoutMs: timeoutMs,
      statusByCode: STATUS,
      // Derived from Payments' own Stripe timeouts (libs/contracts), so
      // they always outlast them.
      timeoutOverridesMs: {
        [PaymentsRpc.startOnboarding]: stripeCallTimeoutMs(
          PAYMENTS_STRIPE_REQUESTS[PaymentsRpc.startOnboarding] ?? 1,
        ),
        [PaymentsRpc.dashboardLink]: stripeCallTimeoutMs(
          PAYMENTS_STRIPE_REQUESTS[PaymentsRpc.dashboardLink] ?? 1,
        ),
        [PaymentsRpc.startCheckout]: stripeCallTimeoutMs(
          PAYMENTS_STRIPE_REQUESTS[PaymentsRpc.startCheckout] ?? 1,
        ),
      },
    });
  }
}
