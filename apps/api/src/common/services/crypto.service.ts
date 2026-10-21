import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_ENV, type AppEnv } from '../../config/config.module';

// Argon2id parameters follow the OWASP baseline; hashes are stored as a single
// encoded string that includes salt and parameters.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;

@Injectable()
export class CryptoService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async hashPassword(password: string): Promise<string> {
    return hash(password, { ...ARGON2_OPTIONS });
  }

  async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Opaque session token; only its SHA-256 hash is persisted. */
  generateSessionToken(): string {
    return randomBytes(32).toString('base64url');
  }

  generatePassword(length = 16): string {
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
    const bytes = randomBytes(length);
    let out = '';
    for (let index = 0; index < length; index += 1) {
      out += alphabet[(bytes[index] ?? 0) % alphabet.length];
    }
    return out;
  }

  sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Constant-time compare for signatures and tokens. */
  safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  hmac(value: string, purpose: string): string {
    return createHmac('sha256', `${this.env.SESSION_SECRET}:${purpose}`).update(value).digest('hex');
  }

  /**
   * Stable, non-reversible identifier used for analytics. Raw IPs and session
   * identifiers are never persisted (docs/09 §4, docs/13 §3).
   */
  anonymize(value: string): string {
    return this.hmac(value, `analytics:${this.env.analyticsSalt}`);
  }

  signPayload(payload: string, ttlSeconds: number): string {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = this.hmac(`${payload}.${expires}`, 'download');
    return `${expires}.${signature}`;
  }

  verifyPayloadSignature(payload: string, token: string): boolean {
    const [expires, signature] = token.split('.');
    if (!expires || !signature) return false;
    if (Number.parseInt(expires, 10) * 1000 < Date.now()) return false;
    return this.safeEqual(this.hmac(`${payload}.${expires}`, 'download'), signature);
  }
}
