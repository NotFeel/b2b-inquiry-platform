import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { JsonLogger } from '../logger.service';

// Redis backs rate limiting and the job queue. When REDIS_URL is empty the API
// still runs; rate limiting falls back to an in-process store and job enqueueing
// reports a clear error instead of silently dropping work.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis | null = null;
  private available: boolean | null = null;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly logger: JsonLogger,
  ) {}

  isConfigured(): boolean {
    return this.env.REDIS_URL.length > 0;
  }

  getClient(): Redis | null {
    if (!this.isConfigured()) return null;
    if (!this.client) {
      this.client = new Redis(this.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
      });
      this.client.on('error', (error: Error) => {
        this.logger.warn('redis.error', { message: error.message }, 'RedisService');
      });
      this.client.on('ready', () => {
        this.available = true;
      });
    }
    return this.client;
  }

  async ping(): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;
    try {
      // `lazyConnect` keeps boot resilient: connect on first use instead of
      // blocking application startup on Redis availability.
      if (client.status === 'wait' || client.status === 'end') {
        await client.connect();
      }
      await client.ping();
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = null;
    }
  }
}
