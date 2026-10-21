import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

// Fixed-window limiter. Redis is used when configured so limits hold across API
// instances; the in-memory fallback only protects a single process.
@Injectable()
export class RateLimitService {
  private readonly windows = new Map<string, WindowEntry>();

  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const client = this.redis.getClient();
    if (client) {
      try {
        const namespaced = `ratelimit:${key}`;
        const count = await client.incr(namespaced);
        if (count === 1) {
          await client.expire(namespaced, windowSeconds);
        }
        const ttl = await client.ttl(namespaced);
        return {
          allowed: count <= limit,
          remaining: Math.max(0, limit - count),
          retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
        };
      } catch {
        // Fall through to the in-process counter.
      }
    }
    return this.consumeInMemory(key, limit, windowSeconds);
  }

  private consumeInMemory(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    const entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      this.prune(now);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: windowSeconds };
    }
    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  private prune(now: number): void {
    if (this.windows.size < 5000) return;
    for (const [key, entry] of this.windows.entries()) {
      if (entry.resetAt <= now) this.windows.delete(key);
    }
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}
