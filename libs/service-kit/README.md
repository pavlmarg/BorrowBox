# @borrowbox/service-kit

The plumbing every NestJS service shares, so a service only holds its own
config fields, migrations, error codes and business modules.

## Pieces

- **Config:** extend `BaseServiceConfig` (database, RabbitMQ, migrations flag,
  token verification key) with the service's own fields, then
  `serviceConfigModule('<app>', configValidator(MyConfig, 'My'))`.
- **Database:** `DatabaseModule.forRoot(MIGRATIONS)` provides the service's
  `DataSource` as `DATA_SOURCE` and closes it on shutdown.
  `createServiceDataSource(url, MIGRATIONS)` and `runMigrations` are for schema tests.
- **Events:** `EventsModule` runs the outbox relay, provides `EVENT_BUS` for
  consumers and prunes `processed_events` hourly. Needs `DatabaseModule`.
- **RPC:** `ServiceError` (subclass it per service to narrow its codes),
  `RpcErrorFilter`, `rpcValidationPipe` and `CorrelationIdPipe`.
- **Startup:** `runService({ name, appModule, migrateModule, hostKey, portKey })`
  in `main.ts`; `node main.js migrate` applies migrations and exits.

## A service's module

```ts
@Module({
  imports: [
    configModule,
    DatabaseModule.forRoot(MIGRATIONS),
    EventsModule,
    // AuthModule, business modules…
  ],
  providers: [
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: RpcErrorFilter },
  ],
})
export class AppModule {}
```

## Tests

`@borrowbox/service-kit/testing` has `startServiceHarness` (boots the service
over real TCP and sends requests as the gateway would), `freePort` and
`generateTestKeys`. Use it only from a service's `src/testing` harness and specs.
