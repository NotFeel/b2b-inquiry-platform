import { Controller, Get, Query } from '@nestjs/common';
import { auditLogQuerySchema } from '@b2b/validation';
import { Permission, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions(Permission.auditRead)
  @Get()
  async list(
    @Query(zodPipe(auditLogQuerySchema))
    query: {
      page: number;
      pageSize: number;
      actorId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      requestId?: string;
      q?: string;
      from?: string;
      to?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    const searchTerm = query.q;
    const where = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(searchTerm
        ? {
            OR: [
              { action: { contains: searchTerm, mode: 'insensitive' as const } },
              { entityType: { contains: searchTerm, mode: 'insensitive' as const } },
              { entityId: { contains: searchTerm, mode: 'insensitive' as const } },
              { requestId: { contains: searchTerm, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { displayName: true } } },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorName: row.actor?.displayName ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        requestId: row.requestId,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }
}
