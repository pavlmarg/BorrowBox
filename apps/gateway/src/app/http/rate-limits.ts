import { Throttle } from '@nestjs/throttler';
import {
  MESSAGES_PER_MINUTE,
  NEW_CONVERSATIONS_PER_DAY,
} from '@borrowbox/contracts';
import { UserRateLimit } from './user-rate-limit';

const MINUTE = 60_000;

/** Default for every route, per client IP. */
export const DEFAULT_LIMIT = { limit: 120, ttl: MINUTE };

/** Credential-guessing targets: login, register, Google sign-in. */
export const AuthRateLimit = () =>
  Throttle({ default: { limit: 10, ttl: MINUTE } });

export const RefreshRateLimit = () =>
  Throttle({ default: { limit: 30, ttl: MINUTE } });

/**
 * Search as you type: one request per pause in typing, so bursts of a few
 * per second are normal (G6).
 */
export const SuggestRateLimit = () =>
  Throttle({ default: { limit: 300, ttl: MINUTE } });

/** Stripe links (payouts): each call creates objects at Stripe. */
export const StripeLinkRateLimit = () =>
  Throttle({ default: { limit: 10, ttl: MINUTE } });

const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Booking requests, and bookings made from offers: 30 per user per hour (Q5). */
export const BookingRequestRateLimit = () =>
  UserRateLimit('booking-requests', 30, HOUR);

/** Chat messages and offers: per user per minute (ADR-0017). */
export const MessageRateLimit = () =>
  UserRateLimit('messages', MESSAGES_PER_MINUTE, MINUTE);

/** Starting conversations: per user per day (ADR-0017). */
export const NewConversationRateLimit = () =>
  UserRateLimit('conversations', NEW_CONVERSATIONS_PER_DAY, DAY);
