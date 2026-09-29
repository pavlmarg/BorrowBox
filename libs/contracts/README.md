# @borrowbox/contracts

Event and DTO types shared by every service and the PWA. This library has no
runtime dependencies, so it is safe to import from both Node and the browser.

## Events

- All events go to the `borrowbox.events` topic exchange (`EVENTS_EXCHANGE`).
- Every event uses the standard `EventEnvelope`:
  `{ eventId, type, version, occurredAt, correlationId, causationId, payload }`.
- Routing keys are `<aggregate>.<event>.v<N>`, e.g. `booking.accepted.v1`.
- Declare one definition per event **version**:

  ```ts
  export interface UserRegisteredV1Payload {
    userId: string;
    email: string;
  }
  export const UserRegisteredV1 = defineEvent<UserRegisteredV1Payload>()('user.registered', 1);

  const envelope = createEnvelope(UserRegisteredV1, payload, { correlationId });
  ```

- **Never change an existing version.** For a breaking change, add `V2`
  alongside `V1` and keep publishing/consuming both until consumers migrate.

## Gateway → service RPC

Services are called over NestJS TCP (ADR-0005). Each service declares, in
`src/lib/<service>/rpc.ts`:

- a `<Service>Rpc` object of message patterns (`<service>.<action>`, e.g. `identity.register`),
- a `<Service>RpcContract` interface mapping each pattern to its `request` / `response` types,
- an error-code union carried in `RpcErrorBody.code`.

Every message is an `RpcRequest<T>`: `{ correlationId, accessToken?, data }`. The
service re-verifies `accessToken` and uses `correlationId` for any events it emits.
These are plain types; validation classes live in the gateway and the service.

## Commands

- `npx nx test contracts`
- `npx nx build contracts`
