import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import type {
  CatalogErrorCode,
  CatalogRpcContract,
} from '@borrowbox/contracts';
import { RPC_TIMEOUT_MS } from '../rpc/rpc.providers';
import { ServiceClient } from '../rpc/service-client';

export const CATALOG_PROXY = Symbol('CATALOG_PROXY');

const STATUS: Record<CatalogErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  // Valid requests the item's current state doesn't allow (G3); the PWA
  // tells them apart by `code`.
  NOT_PUBLISHABLE: HttpStatus.CONFLICT,
  INVALID_STATE: HttpStatus.CONFLICT,
  ITEM_LIMIT_REACHED: HttpStatus.CONFLICT,
  PHOTO_LIMIT_REACHED: HttpStatus.CONFLICT,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Typed gateway → Catalog client. */
@Injectable()
export class CatalogClient extends ServiceClient<
  CatalogRpcContract,
  CatalogErrorCode
> {
  constructor(
    @Inject(CATALOG_PROXY) proxy: ClientProxy,
    @Inject(RPC_TIMEOUT_MS) timeoutMs: number,
  ) {
    super({
      name: 'Catalog',
      proxy,
      defaultTimeoutMs: timeoutMs,
      statusByCode: STATUS,
    });
  }
}
