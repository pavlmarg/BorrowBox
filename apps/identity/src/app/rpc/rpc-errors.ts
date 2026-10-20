import type { IdentityErrorCode } from '@borrowbox/contracts';
import { ServiceError } from '@borrowbox/service-kit';

/** An expected, client-facing failure. `message` must never contain personal data. */
export class IdentityError extends ServiceError<IdentityErrorCode> {}
