import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  QuoteExportCreateInput,
  QuoteExportPreviewInput,
  QuoteTemplateUploadInput,
} from '@b2b/validation';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';

// Field keys a template may reference. Prices are part of the internal quote
// export (never the storefront) and always come from the whitelisted list.
export const QUOTE_TEMPLATE_FIELD_KEYS = [
  'product.sku',
  'product.name',
  'product.size',
  'product.weight_g',
  'product.packaging',
  'product.carton_size_cm',
  'product.carton_weight_kg',
  'product.carton_qty',
  'product.category',
  'product.lifecycle_status',
  'product.price_cny',
] as const;

@Injectable()
export class QuoteService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
  ) {}

  async listTemplates() {
    const templates = await this.prisma.quoteTemplate.findMany({
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
    return templates.map((template) => ({
      id: template.id,
      name: template.name,
      templateType: template.templateType,
      version: template.version,
      status: template.status,
      sheetName: template.sheetName,
      fieldMapping: (template.fieldMapping as Record<string, unknown>) ?? {},
      validationReport: (template.validationReport as Record<string, unknown> | null) ?? null,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    }));
  }

  /**
   * Registers a new template version.
   *
   * Versions are immutable: re-uploading the same name creates the next version
   * so historical exports keep pointing at the template they used (docs/08 §2).
   */
  async createTemplateVersion(input: QuoteTemplateUploadInput, actorId: string, requestId: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: input.fileAssetId } });
    if (!asset || asset.status !== 'ready') {
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

    const unknownFields = Object.values(input.fieldMapping).filter(
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

    const latest = await this.prisma.quoteTemplate.findFirst({
      where: { name: input.name },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;

    const validationReport = {
      checkedAt: new Date().toISOString(),
      requiredFieldsPresent: Object.keys(input.fieldMapping).length > 0,
      headerRow: input.headerRow,
      itemStartRow: input.itemStartRow,
      sheetName: input.sheetName ?? null,
    };

    const template = await this.prisma.quoteTemplate.create({
      data: {
        name: input.name,
        templateType: input.templateType,
        version,
        storageKey: asset.storageKey,
        sheetName: input.sheetName ?? null,
        headerRow: input.headerRow,
        itemStartRow: input.itemStartRow,
        fieldMapping: input.fieldMapping as never,
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
    return template;
  }

  async setTemplateStatus(
    id: string,
    status: 'draft' | 'active' | 'disabled',
    actorId: string,
    requestId: string,
  ) {
    const template = await this.prisma.quoteTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Quote template not found.');

    const report = (template.validationReport as Record<string, unknown> | null) ?? null;
    if (status === 'active' && !report?.requiredFieldsPresent) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The template failed its pre-check and cannot be activated.',
      );
    }
    const updated = await this.prisma.quoteTemplate.update({ where: { id }, data: { status } });
    await this.audit.record({
      actorId,
      action: 'quote_template.status',
      entityType: 'quote_template',
      entityId: id,
      requestId,
      metadata: { from: template.status, to: status },
    });
    return updated;
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
