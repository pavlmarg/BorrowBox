import type { CatalogErrorCode } from '@borrowbox/contracts';
import { ServiceError } from '@borrowbox/service-kit';

/** An expected, client-facing failure. `message` must never contain personal data. */
export class CatalogError extends ServiceError<CatalogErrorCode> {}
