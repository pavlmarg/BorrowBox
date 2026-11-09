import { Controller, Inject, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { DataSource } from 'typeorm';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  PaymentsRpc,
  WEBHOOK_BODY_MAX_BYTES,
  WEBHOOK_SOURCES,
  type PaymentsDataExport,
  type PayoutAccountView,
  type ReceiveWebhookRequest,
  type StripeLinkView,
  type WebhookSource,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { findAccountByUser } from './accounts/accounts.repository';
import { PayoutsService, toView } from './accounts/payouts.service';
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
    const row = await findAccountByUser(this.dataSource.manager, user.userId);
    return {
      exportedAt: new Date().toISOString(),
      payoutAccount: row
        ? {
            stripeAccountId: row.stripe_account_id,
            ...toView(row),
            createdAt: row.created_at.toISOString(),
          }
        : null,
    };
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
