import { Injectable } from '@nestjs/common';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

// Fixed-window limiter for the target single-API-process deployment. If the API
// is scaled horizontally later, replace this with a PostgreSQL-backed limiter
// or an edge limiter; silently sharing one process map across instances would
// weaken abuse protection.
@Injectable()
export class RateLimitService {
  private readonly windows = new Map<string, WindowEntry>();

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
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
