import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Liveness must not touch dependencies: it only proves the process is up.
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Readiness checks dependencies with a timeout so a slow dependency cannot
  // hold the probe open and cascade into a restart loop (docs/07 §8).
  @Public()
  @Get('ready')
  async ready() {
    const checks: Record<string, { ok: boolean; errorCode?: string }> = {};

    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      checks.database = { ok: true };
    } catch {
      checks.database = { ok: false, errorCode: 'DB_UNAVAILABLE' };
    }

    if (this.redis.isConfigured()) {
      const ok = await this.redis.ping();
      checks.redis = ok ? { ok: true } : { ok: false, errorCode: 'REDIS_UNAVAILABLE' };
    } else {
      checks.redis = { ok: false, errorCode: 'REDIS_NOT_CONFIGURED' };
    }

    const ready = Boolean(checks.database?.ok);
    return {
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
