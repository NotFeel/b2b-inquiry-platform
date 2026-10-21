import { Controller, Get, Param, Query } from '@nestjs/common';
import { QUEUE_NAMES, ERROR_CODES, type QueueName } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';
import { Permission, RequirePermissions } from '../../common/decorators';
import { JobsService } from '../../common/services/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';

const JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

@Controller('admin/jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Unified job status endpoint. The persisted record is authoritative - the
   * queue is only consulted for progress - so a Redis outage never hides the
   * real state of an export or conversion (docs/05 §5).
   */
  @RequirePermissions(Permission.jobRead)
  @Get(':jobId')
  async status(@Param('jobId') jobId: string, @Query('type') type?: string) {
    if (!JOB_ID_PATTERN.test(jobId)) {
      throw ApiError.validation('Invalid job id.', { jobId: 'validation.required' });
    }

    if (type === 'quote-export') {
      const job = await this.prisma.quoteExportJob.findUnique({ where: { id: jobId } });
      if (!job) throw new ApiError(ERROR_CODES.jobNotFound, 'Job not found.');
      let progress: number | null = null;
      try {
        const state = await this.jobs.getJobState(QUEUE_NAMES.quoteExport, `quote-export-${job.id}`);
        progress = typeof state?.progress === 'number' ? state.progress : null;
      } catch {
        progress = null;
      }
      return {
        data: {
          id: job.id,
          status: job.status,
          errorCode: job.errorCode,
          progress,
          result: {
            productCount: job.productCount,
            fileKey: job.purgeState === 'NONE' ? job.fileKey : null,
          },
          updatedAt: job.updatedAt.toISOString(),
        },
      };
    }

    if (type === 'pdf-conversion') {
      const job = await this.prisma.pdfConversionJob.findUnique({ where: { id: jobId } });
      if (!job) throw new ApiError(ERROR_CODES.jobNotFound, 'Job not found.');
      return {
        data: {
          id: job.id,
          status: job.status,
          errorCode: job.errorCode,
          progress: null,
          result: { outputKey: job.outputKey, pageCount: job.pageCount },
          updatedAt: job.updatedAt.toISOString(),
        },
      };
    }

    // Fall back to the queue for ids that are not persisted business jobs.
    const queue = (type as QueueName | undefined) ?? QUEUE_NAMES.quoteExport;
    const state = await this.jobs.getJobState(queue, jobId);
    if (!state) throw new ApiError(ERROR_CODES.jobNotFound, 'Job not found.');
    return {
      data: {
        id: jobId,
        status: state.state === 'completed' ? 'succeeded' : state.state,
        errorCode: state.error ? ERROR_CODES.jobFailed : null,
        progress: typeof state.progress === 'number' ? state.progress : null,
        result: null,
        updatedAt: new Date().toISOString(),
      },
    };
  }
}
