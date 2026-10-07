import { Injectable, type PipeTransform } from '@nestjs/common';
import { CatalogError } from './rpc-errors';

/** `RpcRequest.correlationId` ends up in event envelopes and logs, so keep it small and inert. */
@Injectable()
export class CorrelationIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      return value;
    }
    throw new CatalogError(
      'VALIDATION_FAILED',
      'Invalid fields: correlationId',
    );
  }
}
