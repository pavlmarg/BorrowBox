import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import type {
  BookingsErrorCode,
  BookingsRpcContract,
  MessagingErrorCode,
  MessagingRpcContract,
} from '@borrowbox/contracts';
import { RPC_TIMEOUT_MS } from '../rpc/rpc.providers';
import { ServiceClient } from '../rpc/service-client';

export const BOOKINGS_PROXY = Symbol('BOOKINGS_PROXY');
/** Messaging lives in Bookings (ADR-0017): same endpoint, its own connection. */
export const MESSAGING_PROXY = Symbol('MESSAGING_PROXY');

const BOOKINGS_STATUS: Record<BookingsErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  INVALID_PERIOD: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  // Requesting needs a verified email: the renter must act, not retry.
  EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  // Valid requests the current state doesn't allow (G1); the PWA tells
  // them apart by `code`.
  INVALID_STATE: HttpStatus.CONFLICT,
  ITEM_UNAVAILABLE: HttpStatus.CONFLICT,
  OWN_ITEM: HttpStatus.CONFLICT,
  SLOT_TAKEN: HttpStatus.CONFLICT,
  PAYOUTS_NOT_SET_UP: HttpStatus.CONFLICT,
  DUPLICATE_REQUEST: HttpStatus.CONFLICT,
  REQUEST_LIMIT_REACHED: HttpStatus.CONFLICT,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

const MESSAGING_STATUS: Record<MessagingErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  INVALID_PERIOD: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_STATE: HttpStatus.CONFLICT,
  OWN_ITEM: HttpStatus.CONFLICT,
  ITEM_UNAVAILABLE: HttpStatus.CONFLICT,
  CONVERSATION_CLOSED: HttpStatus.CONFLICT,
  OFFER_UNAVAILABLE: HttpStatus.CONFLICT,
  PRICE_ABOVE_LIST: HttpStatus.CONFLICT,
  SLOT_TAKEN: HttpStatus.CONFLICT,
  PAYOUTS_NOT_SET_UP: HttpStatus.CONFLICT,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Typed gateway → Bookings client. */
@Injectable()
export class BookingsClient extends ServiceClient<
  BookingsRpcContract,
  BookingsErrorCode
> {
  constructor(
    @Inject(BOOKINGS_PROXY) proxy: ClientProxy,
    @Inject(RPC_TIMEOUT_MS) timeoutMs: number,
  ) {
    super({
      name: 'Bookings',
      proxy,
      defaultTimeoutMs: timeoutMs,
      statusByCode: BOOKINGS_STATUS,
    });
  }
}

/** Typed gateway → Messaging client (served by Bookings for now). */
@Injectable()
export class MessagingClient extends ServiceClient<
  MessagingRpcContract,
  MessagingErrorCode
> {
  constructor(
    @Inject(MESSAGING_PROXY) proxy: ClientProxy,
    @Inject(RPC_TIMEOUT_MS) timeoutMs: number,
  ) {
    super({
      name: 'Messaging',
      proxy,
      defaultTimeoutMs: timeoutMs,
      statusByCode: MESSAGING_STATUS,
    });
  }
}
