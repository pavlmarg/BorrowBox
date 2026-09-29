import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  UserRegisteredV1,
  createEnvelope,
  type AuthSession,
  type Locale,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { DATA_SOURCE } from '../database/database.module';
import { IdentityError } from '../rpc/rpc-errors';
import type { LoginDto, LogoutDto, RefreshDto, RegisterDto } from './auth.dto';
import { PasswordHasher } from './password-hasher';
import {
  decideRefresh,
  hashRefreshToken,
  isWellFormedRefreshToken,
  type StoredRefreshToken,
} from './refresh-token';
import { SessionService } from './session.service';

const INVALID_CREDENTIALS = () =>
  new IdentityError('INVALID_CREDENTIALS', 'Invalid email or password');
const INVALID_REFRESH_TOKEN = () =>
  new IdentityError('INVALID_REFRESH_TOKEN', 'Session expired, sign in again');

interface RefreshRow extends StoredRefreshToken {
  id: string;
  user_id: string;
  family_id: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
  ) {}

  /** Creates the account and its `user.registered` event in one transaction, then signs in. */
  async register(
    dto: RegisterDto,
    correlationId: string,
  ): Promise<AuthSession> {
    const passwordHash = await this.hasher.hash(dto.password);
    const locale: Locale = dto.locale ?? 'el';
    try {
      return await this.dataSource.transaction(async (tx) => {
        const [user]: Array<{ id: string }> = await tx.query(
          `INSERT INTO users (email, password_hash, display_name, locale)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [dto.email, passwordHash, dto.displayName, locale],
        );
        await addToOutbox(
          tx,
          createEnvelope(
            UserRegisteredV1,
            {
              userId: user.id,
              email: dto.email,
              displayName: dto.displayName,
              locale,
            },
            { correlationId },
          ),
        );
        return this.sessions.start(tx, user.id);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_lower_key')) {
        throw new IdentityError('EMAIL_TAKEN', 'Email is already registered');
      }
      throw err;
    }
  }

  /**
   * Same error and (roughly) the same work for unknown emails, wrong passwords,
   * OAuth-only and deleted accounts, so responses don't reveal which it was.
   */
  async login(dto: LoginDto): Promise<AuthSession> {
    const [user]: Array<{ id: string; password_hash: string | null }> =
      await this.dataSource.query(
        `SELECT id, password_hash FROM users
          WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
        [dto.email],
      );
    const hash = user?.password_hash ?? null;
    if (!(await this.hasher.verify(hash, dto.password)) || !user) {
      throw INVALID_CREDENTIALS();
    }

    const newHash =
      hash && this.hasher.needsRehash(hash)
        ? await this.hasher.hash(dto.password)
        : null;
    return this.dataSource.transaction(async (tx) => {
      if (newHash) {
        await tx.query(
          `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
          [user.id, newHash],
        );
      }
      return this.sessions.start(tx, user.id);
    });
  }

  /**
   * Rotates a refresh token. Presenting one that was already rotated or
   * revoked means a copy leaked: the whole family is revoked (committed) and
   * the caller gets the same error as for any invalid token.
   */
  async refresh(dto: RefreshDto): Promise<AuthSession> {
    if (!isWellFormedRefreshToken(dto.refreshToken)) {
      throw INVALID_REFRESH_TOKEN();
    }
    const now = new Date();
    const outcome = await this.dataSource.transaction(async (tx) => {
      const [row]: RefreshRow[] = await tx.query(
        `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at,
                rt.rotated_at, rt.revoked_at, u.deleted_at AS user_deleted_at
           FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
          WHERE rt.token_hash = $1
          FOR UPDATE OF rt`,
        [hashRefreshToken(dto.refreshToken)],
      );
      if (!row) return { kind: 'invalid' } as const;

      switch (decideRefresh(row, now)) {
        case 'reuse':
          await revokeFamily(tx, row.family_id, now);
          return { kind: 'reuse', familyId: row.family_id } as const;
        case 'expired':
          return { kind: 'invalid' } as const;
        case 'rotate':
          await tx.query(
            `UPDATE refresh_tokens SET rotated_at = $2 WHERE id = $1`,
            [row.id, now],
          );
          return {
            kind: 'ok',
            session: await this.sessions.issue(
              tx,
              row.user_id,
              row.family_id,
              row.expires_at,
              now,
            ),
          } as const;
      }
    });

    if (outcome.kind === 'ok') return outcome.session;
    if (outcome.kind === 'reuse') {
      this.logger.warn(
        `Refresh token reuse detected; revoked token family ${outcome.familyId}`,
      );
    }
    throw INVALID_REFRESH_TOKEN();
  }

  /** Ends the session (the token's family). Idempotent: unknown tokens are ignored. */
  async logout(dto: LogoutDto): Promise<void> {
    if (!isWellFormedRefreshToken(dto.refreshToken)) return;
    await this.dataSource.transaction(async (tx) => {
      const [row]: Array<{ family_id: string }> = await tx.query(
        `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
        [hashRefreshToken(dto.refreshToken)],
      );
      if (row) await revokeFamily(tx, row.family_id, new Date());
    });
  }
}

async function revokeFamily(
  tx: { query: DataSource['query'] },
  familyId: string,
  now: Date,
): Promise<void> {
  await tx.query(
    `UPDATE refresh_tokens SET revoked_at = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, now],
  );
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = e?.driverError?.code ?? e?.code;
  const name = e?.driverError?.constraint ?? e?.constraint;
  return code === '23505' && name === constraint;
}
