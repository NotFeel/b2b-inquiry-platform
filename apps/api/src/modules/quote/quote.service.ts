import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, type QuoteTemplateSummary } from '@b2b/contracts';
import type { QuoteTemplate } from '@b2b/database';
import type {
  QuoteExportCreateInput,
  QuoteExportPreviewInput,
  QuoteTemplateUploadInput,
} from '@b2b/validation';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import {
  QUOTE_TEMPLATE_FIELD_KEYS,
  QuoteTemplateParseError,
  inspectQuoteTemplateWorkbook,
} from './quote-template-parser';
import { buildQuoteTemplatePreview } from './quote-template-preview';

const QUOTE_TEMPLATE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class QuoteService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async listTemplates() {
    const templates = await this.prisma.quoteTemplate.findMany({
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
    const [assets, deletionJobs] = await Promise.all([
      this.prisma.fileAsset.findMany({
        where: { storageKey: { in: templates.map((template) => template.storageKey) } },
        select: { id: true, storageKey: true, originalName: true, sizeBytes: true },
      }),
      this.prisma.fileDeletionJob.findMany({
        where: {
          entityType: 'quote_template',
          entityId: { in: templates.map((template) => template.id) },
          status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, status: true },
      }),
    ]);
    const assetsByKey = new Map(assets.map((asset) => [asset.storageKey, asset]));
    const deletionByTemplate = new Map(
      deletionJobs.map((job) => [job.entityId, job.status] as const),
    );
    return templates.flatMap((template): QuoteTemplateSummary[] => {
      const deletionState = deletionByTemplate.get(template.id);
      // Queued/processing versions disappear immediately. A failed physical
      // delete stays visible so an operator can retry instead of losing the row.
      if (deletionState === 'QUEUED' || deletionState === 'PROCESSING') return [];
      return [
        quoteTemplateSummary(
          template,
          assetsByKey.get(template.storageKey),
          deletionState === 'FAILED' ? 'failed' : null,
        ),
      ];
    });
  }

  /** Returns a private original workbook only after rechecking its asset metadata. */
  async getTemplateFile(id: string) {
    const { template, asset } = await this.loadTemplateFile(id);
    let body: Buffer;
    try {
      body = await this.storage.get(template.storageKey);
    } catch {
      throw new ApiError(ERROR_CODES.fileNotFound, 'Quote template file not found.');
    }
    return {
      body,
      filename: safeTemplateFilename(asset.originalName, template.name, template.version),
      mimeType: QUOTE_TEMPLATE_MIME,
    };
  }

  /** Parses a bounded, read-only preview and never exposes the private storage key. */
  async previewTemplate(id: string) {
    const { template } = await this.loadTemplateFile(id);
    let body: Buffer;
    try {
      body = await this.storage.get(template.storageKey);
    } catch {
      throw new ApiError(ERROR_CODES.fileNotFound, 'Quote template file not found.');
    }
    try {
      return await buildQuoteTemplatePreview(body, {
        id: template.id,
        name: template.name,
        version: template.version,
        sheetName: template.sheetName,
      });
    } catch (error) {
      if (!(error instanceof QuoteTemplateParseError)) throw error;
      throw new ApiError(ERROR_CODES.quoteTemplateInvalid, error.message, {
        details: error.details,
      });
    }
  }

  /**
   * Stops the version from being exported and queues an idempotent physical
   * delete. The worker removes the DB metadata only after storage confirms the
   * object is gone; a storage failure leaves a visible retryable row.
   */
  async requestTemplateDeletion(id: string, actorId: string, requestId: string) {
    const template = await this.prisma.quoteTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Quote template not found.');
    if (!isManagedTemplateKey(template.storageKey)) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The template file location is not managed by this application.',
      );
    }

    const idempotencyKey = `quote-template:${id}`;
    const existingJob = await this.prisma.fileDeletionJob.findUnique({
      where: { idempotencyKey },
    });
    if (existingJob?.status === 'QUEUED' || existingJob?.status === 'PROCESSING') {
      return { status: 'deletion_pending' as const };
    }

    const [exportCount, sharingCount, asset] = await Promise.all([
      this.prisma.quoteExportJob.count({ where: { templateId: id } }),
      this.prisma.quoteTemplate.count({
        where: { storageKey: template.storageKey, id: { not: id } },
      }),
      this.prisma.fileAsset.findUnique({ where: { storageKey: template.storageKey } }),
    ]);
    if (exportCount > 0) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInUse,
        'This template version is referenced by previous exports.',
        { status: 409, details: { reason: 'EXPORT_REFERENCES' } },
      );
    }
    if (sharingCount > 0) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInUse,
        'This template file is shared by another version.',
        { status: 409, details: { reason: 'SHARED_FILE' } },
      );
    }
    if (
      !asset ||
      asset.status !== 'ready' ||
      asset.purpose !== 'quote-template' ||
      asset.isPublic
    ) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The template file metadata is unavailable.',
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.quoteTemplate.updateMany({
        where: { id, status: { not: 'disabled' } },
        data: { status: 'disabled' },
      });
      await transaction.fileDeletionJob.upsert({
        where: { idempotencyKey },
        create: {
          storageKey: template.storageKey,
          entityType: 'quote_template',
          entityId: id,
          requestedBy: actorId,
          status: 'QUEUED',
          idempotencyKey,
        },
        update: {
          storageKey: template.storageKey,
          entityType: 'quote_template',
          entityId: id,
          requestedBy: actorId,
          status: 'QUEUED',
          runAfter: new Date(),
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
          lastErrorCode: null,
          completedAt: null,
        },
      });
    });

    await this.audit.record({
      actorId,
      action: 'quote_template.delete_requested',
      entityType: 'quote_template',
      entityId: id,
      requestId,
      metadata: {
        name: template.name,
        version: template.version,
        templateType: template.templateType,
        previousStatus: template.status,
      },
    });
    return { status: 'deletion_pending' as const };
  }

  private async loadTemplateFile(id: string) {
    const template = await this.prisma.quoteTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Quote template not found.');
    const deletionJob = await this.prisma.fileDeletionJob.findUnique({
      where: { idempotencyKey: `quote-template:${id}` },
    });
    if (deletionJob?.status === 'QUEUED' || deletionJob?.status === 'PROCESSING') {
      throw new ApiError(ERROR_CODES.fileNotFound, 'Quote template file not found.');
    }
    if (!isManagedTemplateKey(template.storageKey)) {
      throw new ApiError(ERROR_CODES.fileNotFound, 'Quote template file not found.');
    }
    const asset = await this.prisma.fileAsset.findUnique({
      where: { storageKey: template.storageKey },
    });
    if (
      !asset ||
      asset.status !== 'ready' ||
      asset.purpose !== 'quote-template' ||
      asset.isPublic
    ) {
      throw new ApiError(ERROR_CODES.fileNotFound, 'Quote template file not found.');
    }
    return { template, asset };
  }

  /**
   * Registers a new template version.
   *
   * Versions are immutable: re-uploading the same name creates the next version
   * so historical exports keep pointing at the template they used (docs/08 §2).
   */
  async createTemplateVersion(input: QuoteTemplateUploadInput, actorId: string, requestId: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: input.fileAssetId } });
    if (
      !asset ||
      asset.status !== 'ready' ||
      asset.uploadedById !== actorId ||
      asset.purpose !== 'quote-template' ||
      asset.isPublic
    ) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The uploaded template file is unavailable.',
      );
    }
    if (!asset.storageKey.toLowerCase().endsWith('.xlsx')) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'Quote templates must be .xlsx workbooks.',
      );
    }

    const unknownFields = Object.values(input.fieldMapping ?? {}).filter(
      (field) => !(QUOTE_TEMPLATE_FIELD_KEYS as readonly string[]).includes(field),
    );
    if (unknownFields.length > 0) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The template references unknown fields.',
        {
          details: { unknownFields: unknownFields.join(',') },
        },
      );
    }

    let inspection;
    try {
      const buffer = await this.storage.get(asset.storageKey);
      inspection = await inspectQuoteTemplateWorkbook(buffer, {
        templateType: input.templateType,
        sheetName: input.sheetName,
        headerRow: input.headerRow,
        itemStartRow: input.itemStartRow,
      });
    } catch (error) {
      if (!(error instanceof QuoteTemplateParseError)) throw error;
      throw new ApiError(ERROR_CODES.quoteTemplateInvalid, error.message, {
        details: error.details,
      });
    }

    const latest = await this.prisma.quoteTemplate.findFirst({
      where: { name: input.name },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;

    const validationReport = {
      checkedAt: new Date().toISOString(),
      requiredFieldsPresent: inspection.requiredFieldsPresent,
      requiredFields: inspection.requiredFields,
      missingRequiredFields: inspection.missingRequiredFields,
      duplicateFields: inspection.duplicateFields,
      missingPlaceholders: inspection.missingPlaceholders,
      placeholderRowsMismatch: inspection.placeholderRowsMismatch,
      layoutValid: inspection.layoutValid,
      headerRow: inspection.headerRow,
      itemStartRow: inspection.itemStartRow,
      sheetName: inspection.sheetName,
      availableSheets: inspection.availableSheets,
      detectedHeaders: inspection.detectedHeaders,
    };

    const template = await this.prisma.quoteTemplate.create({
      data: {
        name: input.name,
        templateType: input.templateType,
        version,
        storageKey: asset.storageKey,
        sheetName: inspection.sheetName,
        headerRow: inspection.headerRow,
        itemStartRow: inspection.itemStartRow,
        fieldMapping: inspection.fieldMapping as never,
        validationReport: validationReport as never,
        status: 'draft',
        uploadedById: actorId,
      },
    });
    await this.audit.record({
      actorId,
      action: 'quote_template.create',
      entityType: 'quote_template',
      entityId: template.id,
      requestId,
      metadata: {
        name: template.name,
        version: template.version,
        templateType: template.templateType,
      },
    });
    return quoteTemplateSummary(template, asset);
  }

  async setTemplateStatus(
    id: string,
    status: 'draft' | 'active' | 'disabled',
    actorId: string,
    requestId: string,
  ) {
    const template = await this.prisma.quoteTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Quote template not found.');

    const deletionJob = await this.prisma.fileDeletionJob.findUnique({
      where: { idempotencyKey: `quote-template:${id}` },
    });
    if (
      deletionJob?.status === 'QUEUED' ||
      deletionJob?.status === 'PROCESSING' ||
      deletionJob?.status === 'FAILED'
    ) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInUse,
        'This template version is pending physical deletion.',
        { status: 409, details: { reason: 'DELETION_PENDING' } },
      );
    }

    const report = (template.validationReport as Record<string, unknown> | null) ?? null;
    if (status === 'active' && !report?.requiredFieldsPresent) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The template failed its pre-check and cannot be activated.',
      );
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      if (status === 'active') {
        await transaction.quoteTemplate.updateMany({
          where: {
            templateType: template.templateType,
            status: 'active',
            id: { not: template.id },
          },
          data: { status: 'disabled' },
        });
      }
      return transaction.quoteTemplate.update({ where: { id }, data: { status } });
    });
    await this.audit.record({
      actorId,
      action: 'quote_template.status',
      entityType: 'quote_template',
      entityId: id,
      requestId,
      metadata: { from: template.status, to: status },
    });
    const asset = await this.prisma.fileAsset.findUnique({
      where: { storageKey: updated.storageKey },
      select: { id: true, originalName: true, sizeBytes: true },
    });
    return quoteTemplateSummary(updated, asset);
  }

  async preview(input: QuoteExportPreviewInput) {
    const productIds = await this.products.resolveExportScope(
      {
        categoryId: input.categoryId ?? null,
        includeDescendants: input.includeDescendants,
        publishStatus: input.publishStatus,
        lifecycleStatus: input.lifecycleStatus,
        tag: input.tag,
        search: input.search,
      },
      this.env.QUOTE_EXPORT_MAX_PRODUCTS,
    );
    return { productCount: productIds.length };
  }

  async createExport(input: QuoteExportCreateInput, actorId: string, requestId: string) {
    const template = await this.prisma.quoteTemplate.findUnique({
      where: { id: input.templateId },
    });
    if (!template) throw ApiError.notFound('Quote template not found.');
    if (template.status !== 'active') {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'Only an active template can be exported.',
      );
    }

    const productIds = await this.products.resolveExportScope(
      {
        categoryId: input.categoryId ?? null,
        includeDescendants: input.includeDescendants,
        publishStatus: input.publishStatus,
        lifecycleStatus: input.lifecycleStatus,
        tag: input.tag,
        search: input.search,
      },
      this.env.QUOTE_EXPORT_MAX_PRODUCTS,
    );
    if (productIds.length === 0) {
      throw new ApiError(ERROR_CODES.quoteExportEmpty, 'No products match the selected filters.');
    }

    const filterSnapshot = {
      categoryId: input.categoryId ?? null,
      includeDescendants: input.includeDescendants,
      publishStatus: input.publishStatus ?? null,
      lifecycleStatus: input.lifecycleStatus ?? null,
      tag: input.tag ?? null,
      search: input.search ?? null,
      locale: input.locale,
      categoryIds: input.categoryId ? undefined : null,
      productIds,
    };

    const job = await this.prisma.quoteExportJob.create({
      data: {
        templateId: template.id,
        templateVersion: template.version,
        requestedById: actorId,
        filterSnapshot: filterSnapshot as never,
        productCount: productIds.length,
        status: 'QUEUED',
        expiresAt: new Date(Date.now() + this.env.JOB_RETENTION_DAYS * 86_400_000),
      },
    });

    await this.audit.record({
      actorId,
      action: 'quote_export.create',
      entityType: 'quote_export_job',
      entityId: job.id,
      requestId,
      metadata: {
        templateId: template.id,
        templateVersion: template.version,
        productCount: productIds.length,
      },
    });
    return { jobId: job.id, productCount: productIds.length, status: job.status };
  }

  async listExports(query: { page: number; pageSize: number; status?: string }) {
    const where = query.status ? { status: query.status as never } : {};
    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.quoteExportJob.count({ where }),
      this.prisma.quoteExportJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          template: { select: { name: true } },
          requestedBy: { select: { displayName: true } },
        },
      }),
    ]);
    return {
      data: jobs.map((job) => ({
        id: job.id,
        templateId: job.templateId,
        templateName: job.template?.name ?? null,
        templateVersion: job.templateVersion,
        requestedBy: job.requestedBy?.displayName ?? null,
        productCount: job.productCount,
        filterSnapshot: (job.filterSnapshot as Record<string, unknown>) ?? {},
        status: job.status,
        errorCode: job.errorCode,
        fileUrl:
          job.fileKey && job.status === 'SUCCEEDED' && job.purgeState === 'NONE'
            ? job.fileKey
            : null,
        fileSizeBytes: job.fileSizeBytes === null ? null : Number(job.fileSizeBytes),
        expiresAt: job.expiresAt?.toISOString() ?? null,
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

  async getExport(id: string) {
    const job = await this.prisma.quoteExportJob.findUnique({ where: { id } });
    if (!job) throw new ApiError(ERROR_CODES.jobNotFound, 'Export job not found.');
    return {
      id: job.id,
      status: job.status,
      errorCode: job.errorCode,
      productCount: job.productCount,
      purgeState: job.purgeState,
      fileKey: job.purgeState === 'NONE' ? job.fileKey : null,
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  /**
   * Two-step deletion: the record is flagged, the download link is hidden, and a
   * retryable job removes the physical object. The business record is only
   * removed after the object store confirms deletion (docs/08 §3).
   */
  async requestDeletion(id: string, actorId: string, requestId: string) {
    const job = await this.prisma.quoteExportJob.findUnique({ where: { id } });
    if (!job) throw new ApiError(ERROR_CODES.jobNotFound, 'Export job not found.');
    if (job.purgeState === 'PENDING') {
      return { status: 'deletion_pending' as const };
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const record = await transaction.quoteExportJob.update({
        where: { id },
        data: { purgeState: 'PENDING', purgeRequestedAt: new Date() },
      });
      if (job.fileKey) {
        await transaction.fileDeletionJob.create({
          data: {
            storageKey: job.fileKey,
            entityType: 'quote_export_job',
            entityId: id,
            status: 'QUEUED',
            idempotencyKey: `quote-export:${id}`,
          },
        });
      }
      return record;
    });

    await this.audit.record({
      actorId,
      action: 'quote_export.delete_requested',
      entityType: 'quote_export_job',
      entityId: id,
      requestId,
      metadata: { purgeState: updated.purgeState },
    });
    return { status: 'deletion_pending' as const };
  }
}

function isManagedTemplateKey(storageKey: string): boolean {
  return storageKey.startsWith('quote-template/') && storageKey.toLowerCase().endsWith('.xlsx');
}

function safeTemplateFilename(originalName: string, name: string, version: number): string {
  const raw = originalName || `${name}-v${version}.xlsx`;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 180);
  return cleaned.toLowerCase().endsWith('.xlsx') ? cleaned : `${cleaned || 'quote-template'}.xlsx`;
}

function quoteTemplateSummary(
  template: QuoteTemplate,
  asset:
    | { id: string; originalName: string; sizeBytes: bigint }
    | null
    | undefined,
  deletionState: QuoteTemplateSummary['deletionState'] = null,
): QuoteTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    templateType: template.templateType as QuoteTemplateSummary['templateType'],
    version: template.version,
    status: template.status,
    sheetName: template.sheetName,
    fieldMapping: (template.fieldMapping as Record<string, unknown>) ?? {},
    validationReport: (template.validationReport as Record<string, unknown> | null) ?? null,
    fileAssetId: asset?.id ?? null,
    fileName: asset?.originalName ?? null,
    fileSizeBytes: asset?.sizeBytes.toString() ?? null,
    deletionState,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
