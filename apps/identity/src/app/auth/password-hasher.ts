import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/** OWASP Password Storage Cheat Sheet minimum for argon2id: m=19 MiB, t=2, p=1. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordHasher implements OnModuleInit {
  /** Verified against when there is no real hash, so failures take the same time. */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('base64url'));
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  /**
   * Constant-work check: with `hash` null (unknown user, OAuth-only or deleted
   * account) it still runs a full verification and returns false.
   */
  async verify(hash: string | null, password: string): Promise<boolean> {
    try {
      const ok = await argon2.verify(hash ?? this.dummyHash, password);
      return ok && hash !== null;
    } catch {
      return false;
    }
  }

  /** True if `hash` was made with weaker/older parameters and should be replaced. */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
