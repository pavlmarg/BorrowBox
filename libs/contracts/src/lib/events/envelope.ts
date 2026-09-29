/** The single topic exchange all domain events are published to (ADR-0001). */
export const EVENTS_EXCHANGE = 'borrowbox.events';

/**
 * Standard wrapper for every event on the bus.
 *
 * `type` is `<aggregate>.<event>` (e.g. `booking.accepted`) and `version` is the
 * payload schema version; together they form the routing key `booking.accepted.v1`.
 */
export interface EventEnvelope<
  TPayload = unknown,
  TType extends string = string,
> {
  /** Unique per event (UUID). Consumers dedupe on this. */
  eventId: string;
  type: TType;
  version: number;
  /** ISO-8601 UTC timestamp of when the state change happened. */
  occurredAt: string;
  /** Shared by every event in one business flow (e.g. a whole booking saga). */
  correlationId: string;
  /** `eventId` of the event that caused this one, or null for user-initiated commands. */
  causationId: string | null;
  payload: TPayload;
}

/**
 * Compile-time link between an event's name, version and payload type.
 * Declare one per event version, e.g.
 *   export const UserRegisteredV1 = defineEvent<UserRegisteredV1Payload>()('user.registered', 1);
 */
export interface EventDefinition<
  TPayload,
  TType extends string = string,
  TVersion extends number = number,
> {
  readonly type: TType;
  readonly version: TVersion;
  readonly routingKey: string;
  /** Phantom field that carries the payload type; always undefined at runtime. */
  readonly _payload?: TPayload;
}

export type PayloadOf<TDef> =
  TDef extends EventDefinition<infer TPayload> ? TPayload : never;

export type EnvelopeOf<TDef> =
  TDef extends EventDefinition<infer TPayload, infer TType>
    ? EventEnvelope<TPayload, TType>
    : never;

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const ROUTING_KEY_PATTERN =
  /^([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\.v([1-9][0-9]*)$/;

/** Builds the versioned routing key `<aggregate>.<event>.v<N>`. */
export function toRoutingKey(type: string, version: number): string {
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new Error(
      `Invalid event type "${type}": expected "<aggregate>.<event>" in lower snake_case`,
    );
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `Invalid event version ${version}: expected a positive integer`,
    );
  }
  return `${type}.v${version}`;
}

/** Inverse of {@link toRoutingKey}. */
export function parseRoutingKey(routingKey: string): {
  type: string;
  version: number;
} {
  const match = ROUTING_KEY_PATTERN.exec(routingKey);
  if (!match) {
    throw new Error(
      `Invalid routing key "${routingKey}": expected "<aggregate>.<event>.v<N>"`,
    );
  }
  return { type: match[1], version: Number(match[2]) };
}

export function defineEvent<TPayload>() {
  return <TType extends string, TVersion extends number>(
    type: TType,
    version: TVersion,
  ): EventDefinition<TPayload, TType, TVersion> =>
    Object.freeze({ type, version, routingKey: toRoutingKey(type, version) });
}

export interface CreateEnvelopeOptions {
  /** The event being handled when this one is emitted; sets causation and correlation. */
  causedBy?: Pick<EventEnvelope, 'eventId' | 'correlationId'>;
  /** Correlation id for a new flow (e.g. from the incoming HTTP request). Ignored if `causedBy` is set. */
  correlationId?: string;
  /** Defaults to now. */
  occurredAt?: Date;
}

export function createEnvelope<TPayload, TType extends string>(
  definition: EventDefinition<TPayload, TType>,
  payload: TPayload,
  options: CreateEnvelopeOptions = {},
): EventEnvelope<TPayload, TType> {
  const eventId = globalThis.crypto.randomUUID();
  return {
    eventId,
    type: definition.type,
    version: definition.version,
    occurredAt: (options.occurredAt ?? new Date()).toISOString(),
    correlationId:
      options.causedBy?.correlationId ?? options.correlationId ?? eventId,
    causationId: options.causedBy?.eventId ?? null,
    payload,
  };
}

export function routingKeyOf(
  envelope: Pick<EventEnvelope, 'type' | 'version'>,
): string {
  return toRoutingKey(envelope.type, envelope.version);
}
