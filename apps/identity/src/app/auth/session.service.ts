import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AccessTokenSigner } from '@borrowbox/auth';
import type { AuthSession } from '@borrowbox/contracts';
import { loadProfile } from '../users/user-profile';
import {
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
} from './refresh-token';

export const ACCESS_TOKEN_SIGNER = Symbol('ACCESS_TOKEN_SIGNER');

/** Issues access + refresh tokens. Always called inside the caller's transaction. */
@Injectable()
export class SessionService {
  constructor(
    @Inject(ACCESS_TOKEN_SIGNER) private readonly signer: AccessTokenSigner,
  ) {}

  /** A new sign-in: new token family, expiring 30 days from now. */
  start(tx: EntityManager, userId: string, now = new Date()) {
    return this.issue(
      tx,
      userId,
      randomUUID(),
      new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      now,
    );
  }

  /** The next token of an existing family; keeps the family's original expiry. */
  async issue(
    tx: EntityManager,
    userId: string,
    familyId: string,
    familyExpiresAt: Date,
    now = new Date(),
  ): Promise<AuthSession> {
    const refreshToken = generateRefreshToken();
    await tx.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, familyId, hashRefreshToken(refreshToken), now, familyExpiresAt],
    );
    const access = await this.signer.sign(userId, now);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: familyExpiresAt.toISOString(),
      user: await loadProfile(tx, userId),
    };
  }
}
