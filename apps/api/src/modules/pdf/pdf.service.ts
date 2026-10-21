import { Injectable } from '@nestjs/common';
import { ERROR_CODES, QUEUE_NAMES } from '@b2b/contracts';
import type { PdfConversionCreateInput } from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { JobsService } from '../../common/services/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Queues an Excel to PDF conversion. Validation and conversion run in the
   * isolated worker; the API only records intent and returns a job id
   * (docs/08 §4).
   */
  async create(input: PdfConversionCreateInput, actorId: string, requestId: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: input.fileAssetId } });
    if (!asset || asset.status !== 'ready') {
      throw new ApiError(ERROR_CODES.uploadTypeNotAllowed, 'The uploaded workbook is unavailable.');
    }
    if (!asset.storageKey.toLowerCase().endsWith('.xlsx')) {
      throw new ApiError(
        ERROR_CODES.uploadTypeNotAllowed,
        'Only macro-free .xlsx workbooks can be converted.',
      );
    }

    const job = await this.prisma.pdfConversionJob.create({
      data: {
        sourceAssetId: asset.id,
        sourceFileName: asset.originalName,
        sheetName: input.sheetName ?? null,
        status: 'QUEUED',
        requestedById: actorId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    try {
      await this.jobs.enqueue(
        QUEUE_NAMES.pdfConvert,
        { jobId: job.id, sourceStorageKey: asset.storageKey, sheetName: input.sheetName ?? null },
        { jobId: `pdf-${job.id}` },
      );
    } catch (error) {
      await this.prisma.pdfConversionJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorCode: ERROR_CODES.jobFailed },
      });
      throw error;
    }

    await this.audit.record({
      actorId,
      action: 'pdf.convert_requested',
      entityType: 'pdf_conversion_job',
      entityId: job.id,
      requestId,
      metadata: { sourceAssetId: asset.id },
    });
    return { jobId: job.id, status: job.status };
  }

  async get(id: string) {
    const job = await this.prisma.pdfConversionJob.findUnique({ where: { id } });
    if (!job) throw new ApiError(ERROR_CODES.jobNotFound, 'Conversion job not found.');
    return {
      id: job.id,
      sourceFileName: job.sourceFileName,
      status: job.status,
      errorCode: job.errorCode,
      outputKey: job.outputKey,
      pageCount: job.pageCount,
      outputSizeBytes: job.outputSizeBytes === null ? null : Number(job.outputSizeBytes),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  async list(query: { page: number; pageSize: number }) {
    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.pdfConversionJob.count(),
      this.prisma.pdfConversionJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: jobs.map((job) => ({
        id: job.id,
        sourceFileName: job.sourceFileName,
        status: job.status,
        errorCode: job.errorCode,
        outputUrl: job.outputKey,
        pageCount: job.pageCount,
        outputSizeBytes: job.outputSizeBytes === null ? null : Number(job.outputSizeBytes),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
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
