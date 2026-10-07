import { plainToInstance } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  validateSync,
} from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  type EventEnvelope,
} from '@borrowbox/contracts';

/**
 * Runtime checks for Identity's events. The contract types only exist at
 * compile time, so a bug in another service could otherwise write bad data
 * into Catalog. A failed check throws: the event is retried, then parked in
 * the DLQ. Messages name fields, never values.
 */

class EnvelopeFields {
  @IsUUID()
  eventId!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;
}

/** `user.registered.v1` and `user.profile_updated.v1`: only these fields are kept. */
export class UserNamePayload {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;
}

/** `user.deletion_requested.v1`. */
export class UserDeletionPayload {
  @IsUUID()
  userId!: string;
}

export class InvalidEventError extends Error {
  constructor(type: string, fields: string[]) {
    super(`Invalid ${type} event: ${fields.join(', ')}`);
    this.name = 'InvalidEventError';
  }
}

/** Checks the envelope fields Catalog relies on and returns the typed payload. */
export function parsePayload<T extends object>(
  envelope: EventEnvelope,
  payloadClass: new () => T,
): T {
  const envelopeErrors = validateSync(
    plainToInstance(EnvelopeFields, envelope),
  );
  const payload = plainToInstance(payloadClass, envelope.payload ?? {});
  const payloadErrors = validateSync(payload);
  const fields = [
    ...envelopeErrors.map((e) => e.property),
    ...payloadErrors.map((e) => `payload.${e.property}`),
  ];
  if (fields.length > 0) throw new InvalidEventError(envelope.type, fields);
  return payload;
}
