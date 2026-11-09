import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeController,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '@borrowbox/auth';
import { PaymentsRpc, type WebhookSource } from '@borrowbox/contracts';
import { ApiErrorResponse } from '../api.dto';
import { apiError } from '../http/api-error';
import { UuidParam } from '../http/params';
import { StripeLinkRateLimit } from '../http/rate-limits';
import { AccessToken, CorrelationId } from '../http/request-context';
import {
  CheckoutResponse,
  PaymentViewResponse,
  PayoutAccountResponse,
  StripeLinkResponse,
} from './payments.api';
import { PaymentsClient } from './payments.client';

/**
 * The renter pays an accepted booking (ADR-0019): Payments checks the
 * booking is theirs and still waiting for payment.
 */
@ApiTags('payments')
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  type: ApiErrorResponse,
  description: 'UNAUTHENTICATED',
})
@ApiResponse({
  status: 404,
  type: ApiErrorResponse,
  description: 'NOT_FOUND (unknown booking, or not mine to pay)',
})
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class CheckoutController {
  constructor(private readonly payments: PaymentsClient) {}

  @Post(':bookingId/payment')
  @HttpCode(HttpStatus.OK)
  @StripeLinkRateLimit()
  @ApiOperation({
    summary: 'Start (or come back to) paying my accepted booking',
    description:
      "Returns the amounts, the pay-by time and a client secret for Stripe's payment form. The outcome arrives by webhook: poll GET or wait for the booking to become PAID.",
  })
  @ApiOkResponse({ type: CheckoutResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description:
      'INVALID_STATE (paid, processing or closed), PAYMENT_WINDOW_CLOSED (under 10 minutes to the pay-by time)',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (10 per minute)',
  })
  @ApiResponse({
    status: 503,
    type: ApiErrorResponse,
    description: 'PROVIDER_UNAVAILABLE (Stripe), SERVICE_UNAVAILABLE',
  })
  start(
    @UuidParam('bookingId') bookingId: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<CheckoutResponse> {
    return this.payments.call(
      PaymentsRpc.startCheckout,
      { bookingId },
      { accessToken, correlationId },
    );
  }

  @Get(':bookingId/payment')
  @ApiOperation({ summary: "My booking's payment: status and amounts" })
  @ApiOkResponse({ type: PaymentViewResponse })
  get(
    @UuidParam('bookingId') bookingId: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<PaymentViewResponse> {
    return this.payments.call(
      PaymentsRpc.getPayment,
      { bookingId },
      { accessToken, correlationId },
    );
  }
}

/**
 * The signed-in lender's payouts (ADR-0019). The gateway checks the JWT;
 * Payments checks it again and identifies the lender from it.
 */
@ApiTags('payouts')
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  type: ApiErrorResponse,
  description: 'UNAUTHENTICATED',
})
@UseGuards(JwtAuthGuard)
@Controller('me/payouts')
export class PayoutsController {
  constructor(private readonly payments: PaymentsClient) {}

  @Get()
  @ApiOperation({ summary: 'Where my payout setup stands' })
  @ApiOkResponse({ type: PayoutAccountResponse })
  get(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<PayoutAccountResponse> {
    return this.payments.call(
      PaymentsRpc.getPayouts,
      {},
      { accessToken, correlationId },
    );
  }

  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @StripeLinkRateLimit()
  @ApiOperation({
    summary: "A link to Stripe's onboarding, to set up payouts",
    description:
      'Creates the Stripe account the first time. Stripe sends the browser back to /settings/payouts?stripe=return, or ?stripe=refresh when the link has expired (ask for a new one).',
  })
  @ApiOkResponse({ type: StripeLinkResponse })
  @ApiResponse({
    status: 403,
    type: ApiErrorResponse,
    description: 'EMAIL_NOT_VERIFIED',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (10 per minute)',
  })
  @ApiResponse({
    status: 503,
    type: ApiErrorResponse,
    description: 'PROVIDER_UNAVAILABLE (Stripe), SERVICE_UNAVAILABLE',
  })
  startOnboarding(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<StripeLinkResponse> {
    return this.payments.call(
      PaymentsRpc.startOnboarding,
      {},
      { accessToken, correlationId },
    );
  }

  @Post('dashboard')
  @HttpCode(HttpStatus.OK)
  @StripeLinkRateLimit()
  @ApiOperation({
    summary: 'A link to my Stripe Express dashboard (payouts, bank account)',
  })
  @ApiOkResponse({ type: StripeLinkResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'PAYOUTS_NOT_SET_UP (finish onboarding first)',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (10 per minute)',
  })
  @ApiResponse({
    status: 503,
    type: ApiErrorResponse,
    description: 'PROVIDER_UNAVAILABLE (Stripe), SERVICE_UNAVAILABLE',
  })
  dashboard(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<StripeLinkResponse> {
    return this.payments.call(
      PaymentsRpc.dashboardLink,
      {},
      { accessToken, correlationId },
    );
  }
}

/**
 * Stripe's webhooks (P9, A5): the raw body and its signature go to Payments,
 * which verifies them; the gateway holds no Stripe secret. Not rate limited
 * (Stripe sends bursts) and not in the OpenAPI spec (not for the PWA).
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('webhooks')
export class StripeWebhooksController {
  constructor(private readonly payments: PaymentsClient) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  platform(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
    @CorrelationId() correlationId: string,
  ): Promise<{ received: true }> {
    return this.forward('platform', req, signature, correlationId);
  }

  @Post('stripe-connect')
  @HttpCode(HttpStatus.OK)
  connect(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
    @CorrelationId() correlationId: string,
  ): Promise<{ received: true }> {
    return this.forward('connect', req, signature, correlationId);
  }

  private async forward(
    source: WebhookSource,
    req: RawBodyRequest<Request>,
    signature: string | undefined,
    correlationId: string,
  ): Promise<{ received: true }> {
    // Stripe signs these exact bytes; the parsed JSON is never used.
    if (!req.rawBody?.length || !signature) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Expected a signed JSON body',
      );
    }
    await this.payments.call(
      PaymentsRpc.receiveWebhook,
      { source, payload: req.rawBody.toString('utf8'), signature },
      { correlationId },
    );
    return { received: true };
  }
}
