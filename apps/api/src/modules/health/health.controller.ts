import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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

    const ready = Boolean(checks.database?.ok);
    return {
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
