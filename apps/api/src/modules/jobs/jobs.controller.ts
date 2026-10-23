import { Controller, Get, Param, Query } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';
import { Permission, RequirePermissions } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';

const JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const SUPPORTED_JOB_TYPES = new Set(['quote-export']);

@Controller('admin/jobs')
export class JobsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions(Permission.jobRead)
  @Get('summary')
  async summary() {
    const now = new Date();
    const [
      fileQueued,
      fileProcessing,
      fileFailed,
      quoteQueued,
      quoteProcessing,
      quoteFailed,
      outboxQueued,
      outboxProcessing,
      outboxFailed,
      expiredLeases,
    ] = await this.prisma.$transaction([
      this.prisma.fileDeletionJob.count({ where: { status: 'QUEUED' } }),
      this.prisma.fileDeletionJob.count({ where: { status: 'PROCESSING' } }),
      this.prisma.fileDeletionJob.count({ where: { status: 'FAILED' } }),
      this.prisma.quoteExportJob.count({ where: { status: 'QUEUED' } }),
      this.prisma.quoteExportJob.count({ where: { status: 'PROCESSING' } }),
      this.prisma.quoteExportJob.count({ where: { status: 'FAILED' } }),
      this.prisma.outboxEvent.count({ where: { status: 'QUEUED' } }),
      this.prisma.outboxEvent.count({ where: { status: 'PROCESSING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT (
          (SELECT COUNT(*) FROM file_deletion_jobs
           WHERE status = 'PROCESSING' AND "lockedUntil" < ${now})
          + (SELECT COUNT(*) FROM quote_export_jobs
             WHERE status = 'PROCESSING' AND "lockedUntil" < ${now})
          + (SELECT COUNT(*) FROM outbox_events
             WHERE status = 'PROCESSING' AND "lockedUntil" < ${now})
        )::bigint AS count
      `,
    ]);
    return {
      data: {
        fileDeletion: { queued: fileQueued, processing: fileProcessing, failed: fileFailed },
        quoteExport: { queued: quoteQueued, processing: quoteProcessing, failed: quoteFailed },
        outbox: { queued: outboxQueued, processing: outboxProcessing, failed: outboxFailed },
        expiredLeases: Number(expiredLeases[0]?.count ?? 0),
        observedAt: now.toISOString(),
      },
    };
  }

  /**
   * Unified job status endpoint. The persisted record is authoritative - the
   * PostgreSQL task row is authoritative; no transport state is needed to
   * report status (docs/05 §5, docs/33 §7).
   */
  @RequirePermissions(Permission.jobRead)
  @Get(':jobId')
  async status(@Param('jobId') jobId: string, @Query('type') type?: string) {
    if (!JOB_ID_PATTERN.test(jobId)) {
      throw ApiError.validation('Invalid job id.', { jobId: 'validation.required' });
    }

    const jobType = type ?? 'quote-export';
    if (!SUPPORTED_JOB_TYPES.has(jobType)) {
      throw ApiError.validation('Unsupported job type.', { type: 'validation.unsupported' });
    }

    const job = await this.prisma.quoteExportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError(ERROR_CODES.jobNotFound, 'Job not found.');
    return {
      data: {
        id: job.id,
        status: job.status,
        errorCode: job.errorCode,
        progress: null,
        result: {
          productCount: job.productCount,
          fileKey: job.purgeState === 'NONE' ? job.fileKey : null,
        },
        updatedAt: job.updatedAt.toISOString(),
      },
    };
  }
}
