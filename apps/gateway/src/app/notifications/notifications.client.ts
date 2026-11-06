import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import type {
  NotificationsErrorCode,
  NotificationsRpcContract,
} from '@borrowbox/contracts';
import { RPC_TIMEOUT_MS } from '../rpc/rpc.providers';
import { ServiceClient } from '../rpc/service-client';

export const NOTIFICATIONS_PROXY = Symbol('NOTIFICATIONS_PROXY');

const STATUS: Record<NotificationsErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Typed gateway → Notifications client (the data export only). */
@Injectable()
export class NotificationsClient extends ServiceClient<
  NotificationsRpcContract,
  NotificationsErrorCode
> {
  constructor(
    @Inject(NOTIFICATIONS_PROXY) proxy: ClientProxy,
    @Inject(RPC_TIMEOUT_MS) timeoutMs: number,
  ) {
    super({
      name: 'Notifications',
      proxy,
      defaultTimeoutMs: timeoutMs,
      statusByCode: STATUS,
    });
  }
}
