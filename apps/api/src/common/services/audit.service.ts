import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JsonLogger } from '../logger.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Audit rows must never block a business operation, but a failure to write one
// is logged loudly because it is a compliance signal (docs/13 §1).
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          requestId: entry.requestId ?? null,
          metadata: (entry.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      this.logger.error(
        'audit.write_failed',
        error instanceof Error ? error.stack : String(error),
        'AuditService',
        { action: entry.action, entityType: entry.entityType },
      );
    }
  }
}
