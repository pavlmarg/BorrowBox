import { Controller, Inject, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import type { DataSource } from 'typeorm';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  PaymentsRpc,
  WEBHOOK_BODY_MAX_BYTES,
  WEBHOOK_SOURCES,
  type BookingPaymentRequest,
  type CheckoutView,
  type PaymentView,
  type PaymentsDataExport,
  type PayoutAccountView,
  type ReceiveWebhookRequest,
  type StripeLinkView,
  type WebhookSource,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { findAccountByUser } from './accounts/accounts.repository';
import { PayoutsService, toView } from './accounts/payouts.service';
import { CheckoutService } from './checkout/checkout.service';
import { listPaymentsOf } from './checkout/payments.repository';
import { WebhooksService } from './webhooks/webhooks.service';

/**
 * The signed-in lender's payouts. The caller is identified by the
 * re-verified access token only, never by ids in `data`.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
  ) {}

  @MessagePattern(PaymentsRpc.getPayouts)
  get(@CurrentUser() user: AuthUser): Promise<PayoutAccountView> {
    return this.payouts.status(user.userId);
  }

  @MessagePattern(PaymentsRpc.startOnboarding)
  startOnboarding(@CurrentUser() user: AuthUser): Promise<StripeLinkView> {
    return this.payouts.startOnboarding(user.userId);
  }

  @MessagePattern(PaymentsRpc.dashboardLink)
  dashboardLink(@CurrentUser() user: AuthUser): Promise<StripeLinkView> {
    return this.payouts.dashboardLink(user.userId);
  }

  /** GDPR export: Payments' part of `GET /me/export`. */
  @MessagePattern(PaymentsRpc.exportMe)
  async exportMe(@CurrentUser() user: AuthUser): Promise<PaymentsDataExport> {
    const tx = this.dataSource.manager;
    const row = await findAccountByUser(tx, user.userId);
    const payments = await listPaymentsOf(tx, user.userId);
    return {
      exportedAt: new Date().toISOString(),
      payoutAccount: row
        ? {
            stripeAccountId: row.stripe_account_id,
            ...toView(row),
            createdAt: row.created_at.toISOString(),
          }
        : null,
      payments: payments.map((p) => ({
        bookingId: p.booking_id,
        status: p.status,
        chargeCents: p.amount_cents,
        createdAt: p.created_at.toISOString(),
        paidAt: p.paid_at?.toISOString() ?? null,
      })),
    };
  }
}

class BookingPaymentDto implements BookingPaymentRequest {
  @IsUUID()
  bookingId!: string;
}

/**
 * The renter pays an accepted booking (ADR-0019). The renter is the
 * token's user; Payments checks the booking is theirs.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @MessagePattern(PaymentsRpc.startCheckout)
  start(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: BookingPaymentDto,
  ): Promise<CheckoutView> {
    return this.checkout.start(user.userId, dto.bookingId);
  }

  @MessagePattern(PaymentsRpc.getPayment)
  get(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: BookingPaymentDto,
  ): Promise<PaymentView> {
    return this.checkout.get(user.userId, dto.bookingId);
  }
}

class ReceiveWebhookDto implements ReceiveWebhookRequest {
  @IsIn(WEBHOOK_SOURCES)
  source!: WebhookSource;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WEBHOOK_BODY_MAX_BYTES)
  payload!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  signature!: string;
}

/**
 * Stripe's webhooks, forwarded by the gateway (P9). No access token: only
 * Stripe's signature, checked against the raw body, is trusted.
 */
@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @MessagePattern(PaymentsRpc.receiveWebhook)
  receive(@Payload('data') dto: ReceiveWebhookDto): Promise<void> {
    return this.webhooks.receive(dto);
  }
}
