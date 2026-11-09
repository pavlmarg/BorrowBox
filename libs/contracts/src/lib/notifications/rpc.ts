/**
 * Gateway → Notifications contracts (NestJS TCP, ADR-0005, ADR-0016).
 * Notifications only answers the data export; everything else it does is
 * driven by events.
 */
import type { Locale } from '../identity/rpc';

export type NotificationsErrorCode =
  'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'INTERNAL';

export const EMAIL_KINDS = [
  'BOOKING_REQUESTED',
  'BOOKING_ACCEPTED',
  'BOOKING_CONFIRMED',
  'BOOKING_PAID',
  'PAYMENT_FAILED',
  'BOOKING_DECLINED',
  'BOOKING_EXPIRED',
  'BOOKING_CANCELLED',
  'OFFER_RECEIVED',
  'OFFER_BOOKED',
  'MESSAGES_UNREAD',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Notifications' part of `GET /me/export`. */
export interface NotificationsDataExport {
  exportedAt: string;
  /** What Notifications knows to reach the caller, or null. */
  recipient: {
    email: string;
    displayName: string;
    locale: Locale;
    updatedAt: string;
  } | null;
  /** Emails queued or sent to the caller (kept 30 days after sending). */
  emails: Array<{
    kind: EmailKind;
    createdAt: string;
    sentAt: string | null;
  }>;
}

export const NotificationsRpc = {
  exportMe: 'notifications.me.export',
} as const;

export interface NotificationsRpcContract {
  [NotificationsRpc.exportMe]: {
    request: Record<string, never>;
    response: NotificationsDataExport;
  };
}

export type NotificationsRpcPattern = keyof NotificationsRpcContract;
