/**
 * Gateway → Payments request/response contracts (NestJS TCP, ADR-0005).
 * The lender is identified from `RpcRequest.accessToken`, never from ids in
 * `data`. Webhooks are the exception: they come from Stripe, carry no token,
 * and are trusted only after Payments checks their signature.
 */
import type {
  PayoutAccountView,
  PayoutStatus,
  StripeLinkView,
} from './payments';

/** Carried in `RpcErrorBody.code` (see `../rpc/rpc.ts`). */
export type PaymentsErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  /** Setting up payouts needs a verified email. */
  | 'EMAIL_NOT_VERIFIED'
  /**
   * The lender hasn't finished Stripe's onboarding: no dashboard yet. From
   * PR B also: accepting a paid booking needs payouts set up (ADR-0019).
   */
  | 'PAYOUTS_NOT_SET_UP'
  /** A webhook whose signature doesn't match: not from Stripe, or altered. */
  | 'INVALID_SIGNATURE'
  /** Stripe didn't answer in time or failed; nothing was changed, try again. */
  | 'PROVIDER_UNAVAILABLE'
  /** Unexpected failure; details are only in Payments' logs. */
  | 'INTERNAL';

// --- Requests ---------------------------------------------------------------

/** Stripe signs platform events and Connect events with different secrets. */
export const WEBHOOK_SOURCES = ['platform', 'connect'] as const;
export type WebhookSource = (typeof WEBHOOK_SOURCES)[number];

/**
 * Biggest webhook body: the gateway's body limit (100 kB) applies to
 * webhooks too. Stripe's account and payment events are far smaller.
 */
export const WEBHOOK_BODY_MAX_BYTES = 100 * 1024;

export interface ReceiveWebhookRequest {
  source: WebhookSource;
  /** The request body exactly as Stripe sent it (UTF-8): the signature covers these bytes. */
  payload: string;
  /** The `Stripe-Signature` header. */
  signature: string;
}

// --- Responses --------------------------------------------------------------

/** Payments' part of `GET /me/export`. */
export interface PaymentsDataExport {
  exportedAt: string;
  /** The caller's Stripe connected account, or null if they never started payouts. */
  payoutAccount: {
    stripeAccountId: string | null;
    status: PayoutStatus;
    payoutsEnabled: boolean;
    createdAt: string;
    updatedAt: string | null;
  } | null;
}

export const PaymentsRpc = {
  getPayouts: 'payments.payouts.get',
  startOnboarding: 'payments.payouts.onboard',
  dashboardLink: 'payments.payouts.dashboard',
  receiveWebhook: 'payments.webhooks.receive',
  exportMe: 'payments.me.export',
} as const;

export interface PaymentsRpcContract {
  [PaymentsRpc.getPayouts]: {
    request: Record<string, never>;
    response: PayoutAccountView;
  };
  [PaymentsRpc.startOnboarding]: {
    request: Record<string, never>;
    response: StripeLinkView;
  };
  [PaymentsRpc.dashboardLink]: {
    request: Record<string, never>;
    response: StripeLinkView;
  };
  [PaymentsRpc.receiveWebhook]: {
    request: ReceiveWebhookRequest;
    response: void;
  };
  [PaymentsRpc.exportMe]: {
    request: Record<string, never>;
    response: PaymentsDataExport;
  };
}

export type PaymentsRpcPattern = keyof PaymentsRpcContract;

/**
 * Stripe requests per call, for the gateway's timeouts
 * (`stripeCallTimeoutMs`): onboarding may create the account and then a
 * link; the dashboard needs one login link.
 */
export const PAYMENTS_STRIPE_REQUESTS: Partial<
  Record<PaymentsRpcPattern, number>
> = {
  [PaymentsRpc.startOnboarding]: 2,
  [PaymentsRpc.dashboardLink]: 1,
};
