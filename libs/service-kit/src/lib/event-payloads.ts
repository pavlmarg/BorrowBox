import { plainToInstance } from 'class-transformer';
import { IsISO8601, IsUUID, validateSync } from 'class-validator';
import type { EventEnvelope } from '@borrowbox/contracts';

/**
 * Runtime checks for other services' events. The contract types only exist
 * at compile time, so a bug in another service could otherwise write bad
 * data into this one. A failed check throws: the event is retried, then
 * parked in the DLQ. Messages name fields, never values.
 */

class EnvelopeFields {
  @IsUUID()
  eventId!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;
}

export class InvalidEventError extends Error {
  constructor(type: string, fields: string[]) {
    super(`Invalid ${type} event: ${fields.join(', ')}`);
    this.name = 'InvalidEventError';
  }
}

/**
 * Checks the envelope fields consumers rely on, validates the payload with
 * `payloadClass` (class-validator) and returns it typed.
 */
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
