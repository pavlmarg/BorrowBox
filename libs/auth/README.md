# @borrowbox/auth

Access tokens (ARCHITECTURE.md §3 Identity, §8 AuthN/AuthZ): short-lived JWTs
signed by Identity with an Ed25519 private key and verified everywhere else
with the public key.

| Claim / header | Value |
|---|---|
| `alg` / `kid` | `EdDSA` / `JWT_KEY_ID` |
| `iss` / `aud` | `borrowbox-identity` / `borrowbox` |
| `sub` / `jti` | user id / random UUID |
| `sid` | sign-in session (Identity's refresh-token family); stays the same across refreshes |
| `exp` | `iat` + 15 min; verified with 30 s clock tolerance |

## Keys

```sh
node tools/gen-jwt-keys.mjs   # prints JWT_KEY_ID, JWT_PUBLIC_KEY, JWT_PRIVATE_KEY
```

- `JWT_PRIVATE_KEY` goes to **Identity only**. `JWT_PUBLIC_KEY` and `JWT_KEY_ID` go to the gateway and every service.
- PEMs are stored with escaped `\n`; read them with `pemFromEnv(process.env.X, 'X')`.
- Never commit keys, and never log tokens.

## Usage

```ts
// Identity
const signer = await createAccessTokenSigner({ privateKeyPem, keyId });
const { token, expiresAt } = await signer.sign({ userId, sessionId });

// Gateway / services (NestJS)
AuthModule.forRoot({
  useFactory: (config: ConfigService) => ({
    publicKeyPem: pemFromEnv(config.get('JWT_PUBLIC_KEY'), 'JWT_PUBLIC_KEY'),
    keyId: config.getOrThrow('JWT_KEY_ID'),
  }),
  inject: [ConfigService],
});

@UseGuards(JwtAuthGuard)
@Get('me')
me(@CurrentUser() user: AuthUser) { … }
```

- `JwtAuthGuard`: HTTP (gateway), reads `Authorization: Bearer …`.
- `RpcJwtAuthGuard`: services (NestJS TCP), re-verifies `RpcRequest.accessToken`
  and rejects with `RpcErrorBody { code: 'UNAUTHENTICATED' }`.

`@CurrentUser()` works with both.

`jose` is ESM-only. Node 22 loads it from CommonJS natively; Jest needs the
`transformIgnorePatterns` entry in `jest.config.cts`.
