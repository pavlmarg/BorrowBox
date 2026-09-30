// Test-only (excluded from the app build): a minimal OpenID Provider standing
// in for Google, so OAuth tests run offline. It serves discovery + JWKS, and a
// token endpoint that checks client credentials, the one-time code, the
// redirect URI and PKCE (S256), then returns an RS256-signed id_token.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';

export interface FakeGoogleUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

interface PendingCode {
  user: FakeGoogleUser;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  /** Lets a test tamper with the id_token (e.g. a wrong audience). */
  claimsOverride?: Record<string, unknown>;
}

export interface AuthorizeResult {
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  /** Sent on the redirect back, like Google does (RFC 9207). */
  iss: string;
}

export class FakeOidcProvider {
  readonly clientId = 'fake-client-id.apps.example';
  readonly clientSecret = 'fake-client-secret';
  readonly redirectUri = 'http://localhost:4200/api/auth/google/callback';

  private readonly codes = new Map<string, PendingCode>();
  private constructor(
    private readonly server: Server,
    readonly issuer: string,
    private readonly signingKey: CryptoKey,
  ) {}

  static async start(): Promise<FakeOidcProvider> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: 'k1',
      alg: 'RS256',
      use: 'sig',
    };
    // The request handler needs the instance, which exists only after listen().
    const ref = {} as { provider: FakeOidcProvider };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', ref.provider.issuer);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (
        req.method === 'GET' &&
        url.pathname === '/.well-known/openid-configuration'
      ) {
        return json(200, {
          issuer: ref.provider.issuer,
          authorization_endpoint: `${ref.provider.issuer}/authorize`,
          token_endpoint: `${ref.provider.issuer}/token`,
          jwks_uri: `${ref.provider.issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          code_challenge_methods_supported: ['S256'],
          // Like Google: the redirect back carries `iss` (RFC 9207).
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (req.method === 'GET' && url.pathname === '/jwks') {
        return json(200, { keys: [jwk] });
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          void ref.provider.token(new URLSearchParams(body)).then(
            (tokens) => json(200, tokens),
            () => json(400, { error: 'invalid_grant' }),
          );
        });
        return;
      }
      json(404, { error: 'not_found' });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    ref.provider = new FakeOidcProvider(
      server,
      `http://127.0.0.1:${port}`,
      privateKey,
    );
    return ref.provider;
  }

  /** Env for Identity (startIdentity({ env })). */
  get env(): Record<string, string> {
    return {
      GOOGLE_ISSUER: this.issuer,
      GOOGLE_CLIENT_ID: this.clientId,
      GOOGLE_CLIENT_SECRET: this.clientSecret,
    };
  }

  /**
   * What the browser round-trip to Google would produce: the user consents and
   * Google redirects back with a one-time code. Returns what the gateway
   * would then send to Identity.
   */
  authorize(
    user: FakeGoogleUser,
    claimsOverride?: Record<string, unknown>,
  ): AuthorizeResult {
    const codeVerifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const code = randomBytes(16).toString('base64url');
    this.codes.set(code, {
      user,
      nonce,
      codeChallenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      redirectUri: this.redirectUri,
      claimsOverride,
    });
    return {
      code,
      codeVerifier,
      nonce,
      redirectUri: this.redirectUri,
      iss: this.issuer,
    };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async token(params: URLSearchParams) {
    const code = params.get('code') ?? '';
    const pending = this.codes.get(code);
    this.codes.delete(code); // one-time use
    const verifier = params.get('code_verifier') ?? '';
    if (
      !pending ||
      params.get('grant_type') !== 'authorization_code' ||
      params.get('client_id') !== this.clientId ||
      params.get('client_secret') !== this.clientSecret ||
      params.get('redirect_uri') !== pending.redirectUri ||
      createHash('sha256').update(verifier).digest('base64url') !==
        pending.codeChallenge
    ) {
      throw new Error('invalid_grant');
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({
      email: pending.user.email,
      email_verified: pending.user.email_verified,
      ...(pending.user.name ? { name: pending.user.name } : {}),
      nonce: pending.nonce,
      ...pending.claimsOverride,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(this.issuer)
      .setAudience(this.clientId)
      .setSubject(pending.user.sub)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(this.signingKey);
    return {
      access_token: randomBytes(16).toString('base64url'),
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken,
    };
  }
}
