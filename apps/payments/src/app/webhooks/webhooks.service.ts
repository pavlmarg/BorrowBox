import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type {
  ReceiveWebhookRequest,
  WebhookSource,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import type { PaymentsConfig } from '../config';
import { PaymentsError } from '../payments.error';
import {
  InvalidSignatureError,
  STRIPE_API,
  type StripeApi,
} from '../stripe/stripe-api';
import { insertEvent } from './stripe-events.repository';

/** The Stripe event types Payments acts on, per endpoint. */
export const HANDLED_EVENT_TYPES: Record<WebhookSource, readonly string[]> = {
  // The renters' payments (ADR-0019); each is re-read from Stripe when processed.
  platform: [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.processing',
    'payment_intent.canceled',
  ],
  connect: ['account.updated'],
};

/**
 * Stripe's webhooks, as forwarded by the gateway (P9): verified against the
 * raw body, stored once by Stripe's event id, and processed later by the
 * worker. Answering quickly keeps Stripe from retrying.
 */
@Injectable()
export class WebhooksService {
  private readonly secrets: Record<WebhookSource, string>;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STRIPE_API) private readonly stripe: StripeApi,
    config: ConfigService<PaymentsConfig, true>,
  ) {
    this.secrets = {
      platform: config.get('STRIPE_WEBHOOK_SECRET', { infer: true }),
      connect: config.get('STRIPE_CONNECT_WEBHOOK_SECRET', { infer: true }),
    };
  }

  /** Throws `INVALID_SIGNATURE` unless Stripe signed it; a repeat is a no-op. */
  async receive({
    source,
    payload,
    signature,
  }: ReceiveWebhookRequest): Promise<void> {
    let event;
    try {
      event = this.stripe.verifyWebhook(
        payload,
        signature,
        this.secrets[source],
      );
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        throw new PaymentsError('INVALID_SIGNATURE', 'Invalid signature');
      }
      throw err;
    }
    // Other types are acknowledged and dropped: Stripe stops resending them.
    if (!HANDLED_EVENT_TYPES[source].includes(event.type)) return;
    await insertEvent(this.dataSource.manager, source, event);
  }
}
