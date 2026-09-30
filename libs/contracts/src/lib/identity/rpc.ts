/**
 * Gateway → Identity request/response contracts (NestJS TCP, ADR-0005).
 *
 * Plain types only: requests are validated with class-validator in the
 * gateway (HTTP) and again in Identity (RPC). Never send a password,
 * token or cookie anywhere except the fields declared here.
 */

export const LOCALES = ['el', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const OAUTH_PROVIDERS = ['google'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Carried in `RpcErrorBody.code` (see `../rpc/rpc.ts`). */
export type IdentityErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  /** Unknown, expired, revoked or reused refresh token (a reuse also revokes its whole family). */
  | 'INVALID_REFRESH_TOKEN'
  | 'OAUTH_EXCHANGE_FAILED'
  /** The provider did not confirm the email (`email_verified` false), so we can't sign in or link. */
  | 'OAUTH_EMAIL_NOT_VERIFIED'
  /** Unexpected failure; details are only in Identity's logs. */
  /**
   * A sensitive action (account deletion) needs fresh proof: the current
   * password, or for accounts without one, a sign-in in the last 5 minutes.
   */
  | 'REAUTHENTICATION_REQUIRED'
  | 'INTERNAL';

// --- Shared shapes ---------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  locale: Locale;
  /**
   * True once ownership of the email is proven (for now: a verified OAuth sign-in).
   * Signing in with a verified provider email auto-links to an account with
   * that email. If the account was still unverified, its password is cleared and
   * all its sessions are revoked, which defeats account pre-hijacking.
   */
  emailVerified: boolean;
  /** False for OAuth-only accounts, and after an auto-link cleared an unverified password. */
  hasPassword: boolean;
  providers: OAuthProvider[];
  createdAt: string;
}

/**
 * Returned by every call that signs a user in. The gateway puts `refreshToken`
 * in an httpOnly cookie and never returns it in a response body.
 */
export interface AuthSession {
  accessToken: string;
  /** ISO-8601. */
  accessTokenExpiresAt: string;
  refreshToken: string;
  /** ISO-8601. */
  refreshTokenExpiresAt: string;
  user: UserProfile;
}

// --- Requests ---------------------------------------------------------------

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  locale?: Locale;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

/** The gateway has already checked `state`; Identity checks `nonce` in the id_token. */
export interface GoogleExchangeRequest {
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  /**
   * The `iss` parameter of Google's redirect (RFC 9207), passed through
   * unchanged. Google announces it, so Identity requires it and checks it is
   * Google's issuer (defends against authorization-server mix-up).
   */
  iss?: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  locale?: Locale;
}

/**
 * `DELETE /me`. Accounts with a password must send it (`UserProfile.hasPassword`);
 * accounts without one must have signed in within the last 5 minutes.
 */
export interface DeleteAccountRequest {
  password?: string;
}

/** Identity's part of `GET /me/export`. No secrets: no hashes, tokens or provider tokens. */
export interface IdentityDataExport {
  exportedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    locale: Locale;
    /** ISO-8601, or null if never verified. */
    emailVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  oauthIdentities: Array<{ provider: OAuthProvider; linkedAt: string }>;
  sessions: Array<{ createdAt: string; expiresAt: string }>;
}

// --- Patterns ---------------------------------------------------------------

export const IdentityRpc = {
  register: 'identity.register',
  login: 'identity.login',
  refresh: 'identity.refresh',
  logout: 'identity.logout',
  googleExchange: 'identity.google.exchange',
  getMe: 'identity.me.get',
  updateMe: 'identity.me.update',
  exportMe: 'identity.me.export',
  deleteMe: 'identity.me.delete',
} as const;

/**
 * Pattern → request/response types, for typed clients and handlers.
 * `me.*` calls identify the user from `RpcRequest.accessToken`, not from `data`.
 */
export interface IdentityRpcContract {
  [IdentityRpc.register]: { request: RegisterRequest; response: AuthSession };
  [IdentityRpc.login]: { request: LoginRequest; response: AuthSession };
  [IdentityRpc.refresh]: { request: RefreshRequest; response: AuthSession };
  [IdentityRpc.logout]: { request: LogoutRequest; response: void };
  [IdentityRpc.googleExchange]: {
    request: GoogleExchangeRequest;
    response: AuthSession;
  };
  [IdentityRpc.getMe]: {
    request: Record<string, never>;
    response: UserProfile;
  };
  [IdentityRpc.updateMe]: {
    request: UpdateProfileRequest;
    response: UserProfile;
  };
  [IdentityRpc.exportMe]: {
    request: Record<string, never>;
    response: IdentityDataExport;
  };
  [IdentityRpc.deleteMe]: {
    request: DeleteAccountRequest;
    response: void;
  };
}

export type IdentityRpcPattern = keyof IdentityRpcContract;
