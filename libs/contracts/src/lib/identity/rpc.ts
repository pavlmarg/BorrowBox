import type { PhotoContentType } from '../catalog/validation';
import type { ProfilePhotoUploadStatus, ProfilePhotoUrls } from './photos';

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
  /**
   * A sensitive action (account deletion) needs fresh proof: the current
   * password, or for accounts without one, a sign-in in the last 5 minutes.
   */
  | 'REAUTHENTICATION_REQUIRED'
  /** An email link's token is unknown, already used or replaced by a newer one. */
  | 'TOKEN_INVALID'
  /** An email link's token is past its lifetime; the PWA offers to send a new one. */
  | 'TOKEN_EXPIRED'
  /** Changing the password needs a current one; accounts without one use a reset link instead. */
  | 'PASSWORD_NOT_SET'
  /** A profile photo confirmed before its upload arrived, or with no upload started. */
  | 'INVALID_STATE'
  /** Unknown or erased account (public profiles). */
  | 'NOT_FOUND'
  /** Unexpected failure; details are only in Identity's logs. */
  | 'INTERNAL';

// --- Shared shapes ---------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  locale: Locale;
  /**
   * True once ownership of the email is proven: an email link (verification
   * or password reset), or a verified OAuth sign-in. Publishing items needs it.
   * Signing in with a verified provider email auto-links to an account with
   * that email. If the account was still unverified, its password is cleared and
   * all its sessions are revoked, which defeats account pre-hijacking.
   */
  emailVerified: boolean;
  /** False for OAuth-only accounts, and after an auto-link cleared an unverified password. */
  hasPassword: boolean;
  providers: OAuthProvider[];
  /** The processed profile photo (ADR-0024), or null for the silhouette. Public, like the name. */
  photo: ProfilePhotoUrls | null;
  /** A new photo being processed or rejected; null when none is waiting. */
  photoUpload: ProfilePhotoUploadStatus | null;
  /** The public bio (ADR-0025), or null for none. */
  bio: string | null;
  createdAt: string;
}

/**
 * Anyone's public profile (ADR-0025), also for signed-out visitors: only
 * what is shown next to their items anyway. Never the email or language.
 */
export interface PublicProfile {
  id: string;
  displayName: string;
  photo: ProfilePhotoUrls | null;
  bio: string | null;
  /** ISO-8601: when the account was created. */
  memberSince: string;
}

export interface PublicProfileRequest {
  userId: string;
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
  /**
   * Normalised with `normaliseBio`, then must pass `bioProblem`; an empty
   * string removes the bio.
   */
  bio?: string;
}

/**
 * `DELETE /me`. Accounts with a password must send it (`UserProfile.hasPassword`);
 * accounts without one must have signed in within the last 5 minutes.
 */
export interface DeleteAccountRequest {
  password?: string;
}

/**
 * Email links (ADR-0016). Their tokens reach the PWA in the link's fragment
 * (`#t=…`) and come back here; they never travel anywhere else.
 */
export interface VerifyEmailRequest {
  token: string;
}

/**
 * Always succeeds the same way, whether or not the email has an account, so
 * the answer doesn't reveal who is registered.
 */
export interface RequestPasswordResetRequest {
  email: string;
}

/** Sets the password, signs out every session and marks the email verified. */
export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

/** Signs out the other sessions; the current one stays signed in. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Starts a new profile photo (ADR-0024). Replaces any upload still waiting;
 * the current photo stays until the new one is ready.
 */
export interface ProfilePhotoUploadRequest {
  /** Signed into the upload URL: storage refuses any other type. */
  contentType: PhotoContentType;
  /** As declared; the worker checks the real size. */
  sizeBytes: number;
}

/** PUT the file to `uploadUrl` with exactly `uploadHeaders`, then confirm. */
export interface ProfilePhotoUpload {
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
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
    /** The public profile photo's addresses, or null. */
    photo: ProfilePhotoUrls | null;
    bio: string | null;
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
  verifyEmail: 'identity.email.verify',
  requestPasswordReset: 'identity.password.reset.request',
  resetPassword: 'identity.password.reset.confirm',
  getMe: 'identity.me.get',
  updateMe: 'identity.me.update',
  sendVerificationEmail: 'identity.me.verification.send',
  changePassword: 'identity.me.password.change',
  exportMe: 'identity.me.export',
  deleteMe: 'identity.me.delete',
  requestPhotoUpload: 'identity.me.photo.upload',
  confirmPhoto: 'identity.me.photo.confirm',
  removePhoto: 'identity.me.photo.remove',
  // Public (no token needed).
  getPublicProfile: 'identity.users.public.get',
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
  [IdentityRpc.verifyEmail]: { request: VerifyEmailRequest; response: void };
  [IdentityRpc.requestPasswordReset]: {
    request: RequestPasswordResetRequest;
    response: void;
  };
  [IdentityRpc.resetPassword]: {
    request: ResetPasswordRequest;
    response: void;
  };
  [IdentityRpc.getMe]: {
    request: Record<string, never>;
    response: UserProfile;
  };
  [IdentityRpc.updateMe]: {
    request: UpdateProfileRequest;
    response: UserProfile;
  };
  /** A no-op for an already verified email. */
  [IdentityRpc.sendVerificationEmail]: {
    request: Record<string, never>;
    response: void;
  };
  [IdentityRpc.changePassword]: {
    request: ChangePasswordRequest;
    response: void;
  };
  [IdentityRpc.exportMe]: {
    request: Record<string, never>;
    response: IdentityDataExport;
  };
  [IdentityRpc.deleteMe]: {
    request: DeleteAccountRequest;
    response: void;
  };
  [IdentityRpc.requestPhotoUpload]: {
    request: ProfilePhotoUploadRequest;
    response: ProfilePhotoUpload;
  };
  /** The upload has arrived: queue processing. Repeating it is safe. */
  [IdentityRpc.confirmPhoto]: {
    request: Record<string, never>;
    response: UserProfile;
  };
  /** Removes the photo and any upload waiting. A no-op without one. */
  [IdentityRpc.removePhoto]: {
    request: Record<string, never>;
    response: UserProfile;
  };
  /** NOT_FOUND for unknown and erased accounts. */
  [IdentityRpc.getPublicProfile]: {
    request: PublicProfileRequest;
    response: PublicProfile;
  };
}

export type IdentityRpcPattern = keyof IdentityRpcContract;
