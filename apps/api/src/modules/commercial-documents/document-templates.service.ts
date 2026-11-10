import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type CommercialDocumentType } from '@b2b/contracts';
import {
  builtinTemplateCode,
  builtinTemplateConfig,
  builtinTemplateName,
  calculateDocumentTotals,
  createDefaultTemplateConfig,
  isFieldVisible,
  parseTemplateConfig,
  renderCommercialDocumentHtml,
  templateConfigChecksum,
  type CommercialDocumentRenderData,
  type DocumentTemplateConfig,
} from '@b2b/commercial-documents';
import type {
  CreateDocumentTemplateInput,
  DocumentTemplateListQuery,
  DocumentTemplatePreviewInput,
  DocumentTemplateValidateInput,
  UpdateDocumentTemplateInput,
} from '@b2b/validation';
import { Prisma, type DocumentTemplate, type DocumentTemplateVersion } from '@b2b/database';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

type TemplateWithVersions = DocumentTemplate & {
  versions?: Array<DocumentTemplateVersion & { _count?: { renderJobs: number } }>;
  _count?: { documents: number };
};

function templateConfigsEqual(draftConfig: unknown, publishedConfig: unknown): boolean {
  return (
    JSON.stringify(parseTemplateConfig(draftConfig)) ===
    JSON.stringify(parseTemplateConfig(publishedConfig))
  );
}

// Templates are versioned configuration. The editable draft can change at any
// time, but published versions are immutable and documents keep pointing at the
// exact version they were issued with (docs/41 §7.3, §13.3).
@Injectable()
export class DocumentTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: DocumentTemplateListQuery) {
    const where: Prisma.DocumentTemplateWhereInput = {
      ...(query.type === 'all' ? {} : { documentType: query.type }),
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(query.locale ? { locale: query.locale } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.documentTemplate.count({ where }),
      this.prisma.documentTemplate.findMany({
        where,
        orderBy: [{ documentType: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          versions: {
            orderBy: { version: 'desc' },
            include: { _count: { select: { renderJobs: true } } },
          },
          _count: { select: { documents: true } },
        },
      }),
    ]);
    return {
      data: rows.map((row) => this.dto(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async activeOptions(type?: CommercialDocumentType) {
    const rows = await this.prisma.documentTemplate.findMany({
      where: {
        status: 'ACTIVE',
        currentVersionId: { not: null },
        ...(type ? { documentType: type } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      include: {
        versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 },
      },
    });
    return rows
      .filter((row) => row.versions.length > 0)
      .map((row) => ({
        id: row.id,
        name: row.name,
        documentType: row.documentType,
        locale: row.locale,
        paperSize: row.paperSize,
        orientation: row.orientation,
        isDefault: row.isDefault,
        versionId: row.versions[0]!.id,
        version: row.versions[0]!.version,
        config: parseTemplateConfig(row.versions[0]!.config),
        hasUnpublishedChanges: !templateConfigsEqual(row.draftConfig, row.versions[0]!.config),
      }));
  }

  async detail(id: string) {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: { _count: { select: { renderJobs: true } } },
        },
        _count: { select: { documents: true } },
        createdBy: { select: { displayName: true } },
        updatedBy: { select: { displayName: true } },
      },
    });
    if (!template) throw ApiError.notFound('Document template not found.');
    return {
      ...this.dto(template),
      versions: template.versions.map((version) => ({
        id: version.id,
        version: version.version,
        status: version.status,
        checksum: version.checksum,
        publishedAt: version.publishedAt.toISOString(),
        createdBy: version.createdById,
      })),
      createdBy: template.createdBy?.displayName ?? null,
      updatedBy: template.updatedBy?.displayName ?? null,
    };
  }

  async create(input: CreateDocumentTemplateInput, actorId: string, requestId: string) {
    if (input.isDefault) {
      throw ApiError.validation(
        'Publish the template first, then set it as the default for its document type and language.',
      );
    }
    const config = this.buildConfig(input, actorId);
    const code = `${input.documentType.toLowerCase()}-${randomUUID().slice(0, 12)}`;
    const template = await this.prisma.$transaction(async (transaction) =>
      transaction.documentTemplate.create({
        data: {
          code,
          name: input.name,
          description: input.description ?? null,
          documentType: input.documentType,
          locale: input.locale,
          paperSize: config.page.size,
          orientation: config.page.orientation,
          status: 'DRAFT',
          isDefault: input.isDefault,
          draftConfig: config as never,
          createdById: actorId,
          updatedById: actorId,
        },
      }),
    );
    await this.audit.record({
      actorId,
      action: 'document_template.created',
      entityType: 'DocumentTemplate',
      entityId: template.id,
      requestId,
      metadata: { code, documentType: template.documentType, locale: template.locale },
    });
    return this.detail(template.id);
  }

  async update(id: string, input: UpdateDocumentTemplateInput, actorId: string, requestId: string) {
    const existing = await this.prisma.documentTemplate.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Document template not found.');
    if (input.expectedUpdatedAt && existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentConcurrentUpdate,
        'The template was changed by another session. Reload and try again.',
        { status: 409 },
      );
    }
    const currentConfig = parseTemplateConfig(existing.draftConfig);
    const targetStatus = input.status ?? existing.status;
    if (input.isDefault === true && targetStatus !== 'ACTIVE') {
      throw ApiError.validation(
        'Only an active template can be set as the default for its document type and language.',
      );
    }
    const config = input.config
      ? parseTemplateConfig({
          ...input.config,
          page: {
            ...input.config.page,
            size: input.paperSize ?? input.config.page.size,
            orientation: input.orientation ?? input.config.page.orientation,
          },
        })
      : parseTemplateConfig({
          ...currentConfig,
          page: {
            ...currentConfig.page,
            size: input.paperSize ?? currentConfig.page.size,
            orientation: input.orientation ?? currentConfig.page.orientation,
          },
        });
    const updated = await this.prisma.$transaction(async (transaction) => {
      if (input.isDefault === true) {
        await transaction.documentTemplate.updateMany({
          where: {
            documentType: existing.documentType,
            locale: input.locale ?? existing.locale,
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      return transaction.documentTemplate.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(targetStatus !== 'ACTIVE'
            ? { isDefault: false }
            : input.isDefault !== undefined
              ? { isDefault: input.isDefault }
              : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          paperSize: config.page.size,
          orientation: config.page.orientation,
          draftConfig: config as never,
          updatedById: actorId,
        },
      });
    });
    await this.audit.record({
      actorId,
      action: 'document_template.updated',
      entityType: 'DocumentTemplate',
      entityId: id,
      requestId,
      metadata: { changedFields: Object.keys(input).filter((key) => key !== 'expectedUpdatedAt') },
    });
    return this.detail(updated.id);
  }

  /**
   * Permanently removes a draft or disabled template that has no document or
   * render-job references. Active/default templates must first be disabled in
   * the editor. Issued history remains protected by RESTRICT foreign keys.
   */
  async remove(id: string, actorId: string, requestId: string) {
    let deleted: {
      id: string;
      code: string;
      name: string;
      documentType: CommercialDocumentType;
      locale: string;
      status: string;
      versionCount: number;
    };
    try {
      deleted = await this.prisma.$transaction(async (transaction) => {
        const template = await transaction.documentTemplate.findUnique({
          where: { id },
          select: {
            id: true,
            code: true,
            name: true,
            documentType: true,
            locale: true,
            status: true,
            isDefault: true,
            _count: { select: { versions: true, documents: true } },
          },
        });
        if (!template) {
          throw new ApiError(ERROR_CODES.documentTemplateNotFound, 'Document template not found.');
        }
        if (
          (template.status !== 'DRAFT' && template.status !== 'DISABLED') ||
          template.isDefault
        ) {
          throw new ApiError(
            ERROR_CODES.documentTemplateNotDeletable,
            'Only a non-default draft or disabled template can be deleted.',
          );
        }
        if (template._count.documents > 0) {
          throw new ApiError(
            ERROR_CODES.documentTemplateInUse,
            'This template is referenced by a PI/CI document and cannot be deleted.',
          );
        }
        const versions = await transaction.documentTemplateVersion.findMany({
          where: { templateId: id },
          select: { id: true },
        });
        if (versions.length > 0) {
          const renderJobCount = await transaction.documentRenderJob.count({
            where: { templateVersionId: { in: versions.map((version) => version.id) } },
          });
          if (renderJobCount > 0) {
            throw new ApiError(
              ERROR_CODES.documentTemplateInUse,
              'This template has PDF render history and cannot be deleted.',
            );
          }
          await transaction.documentTemplateVersion.deleteMany({ where: { templateId: id } });
        }
        await transaction.documentTemplate.delete({ where: { id } });
        return { ...template, versionCount: template._count.versions };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003' || error.code === 'P2014') {
          throw new ApiError(
            ERROR_CODES.documentTemplateInUse,
            'This template is referenced by another record and cannot be deleted.',
          );
        }
        if (error.code === 'P2025') {
          throw new ApiError(ERROR_CODES.documentTemplateNotFound, 'Document template not found.');
        }
      }
      throw error;
    }

    await this.audit.record({
      actorId,
      action: 'document_template.deleted',
      entityType: 'DocumentTemplate',
      entityId: deleted.id,
      requestId,
      metadata: {
        templateId: deleted.id,
        code: deleted.code,
        name: deleted.name,
        documentType: deleted.documentType,
        locale: deleted.locale,
        statusBeforeDelete: deleted.status,
        versionCount: deleted.versionCount,
      },
    });
    return { deleted: true as const };
  }

  async validateTemplate(id: string, input: DocumentTemplateValidateInput = {}) {
    const template = await this.prisma.documentTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Document template not found.');
    const config = input.config
      ? parseTemplateConfig(input.config)
      : parseTemplateConfig(template.draftConfig);
    return {
      data: this.validationReport(
        config,
        input.documentType ?? template.documentType,
        input.locale ?? template.locale,
      ),
    };
  }

  async preview(id: string, input: DocumentTemplatePreviewInput) {
    const template = await this.prisma.documentTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Document template not found.');
    const config = input.config
      ? parseTemplateConfig(input.config)
      : parseTemplateConfig(template.draftConfig);
    const documentType = input.documentType ?? template.documentType;
    const locale = input.locale ?? template.locale;
    const sample = this.sampleDocument(documentType, locale);
    return {
      data: {
        html: renderCommercialDocumentHtml(config, sample),
        missing: [],
        sample: true,
        documentType,
        locale,
      },
    };
  }

  async publish(id: string, actorId: string, requestId: string) {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!template) throw ApiError.notFound('Document template not found.');
    const config = parseTemplateConfig(template.draftConfig);
    const nextVersion = (template.versions[0]?.version ?? 0) + 1;
    const checksum = templateConfigChecksum(config);
    const published = await this.prisma.$transaction(async (transaction) => {
      if (template.isDefault) {
        await transaction.documentTemplate.updateMany({
          where: {
            documentType: template.documentType,
            locale: template.locale,
            isDefault: true,
            id: { not: template.id },
          },
          data: { isDefault: false },
        });
      }
      const version = await transaction.documentTemplateVersion.create({
        data: {
          templateId: template.id,
          version: nextVersion,
          status: 'PUBLISHED',
          config: config as never,
          checksum,
          createdById: actorId,
        },
      });
      await transaction.documentTemplate.update({
        where: { id: template.id },
        data: {
          status: 'ACTIVE',
          currentVersionId: version.id,
          paperSize: config.page.size,
          orientation: config.page.orientation,
          updatedById: actorId,
        },
      });
      return version;
    });
    await this.audit.record({
      actorId,
      action: 'document_template.published',
      entityType: 'DocumentTemplateVersion',
      entityId: published.id,
      requestId,
      metadata: {
        templateId: template.id,
        version: published.version,
        checksum,
        documentType: template.documentType,
      },
    });
    return this.detail(template.id);
  }

  async versions(id: string) {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!template) throw ApiError.notFound('Document template not found.');
    return {
      data: template.versions.map((version) => ({
        id: version.id,
        version: version.version,
        status: version.status,
        checksum: version.checksum,
        publishedAt: version.publishedAt.toISOString(),
      })),
    };
  }

  /**
   * Resolves the version a document will use. A version must be published and
   * match the document type; a draft template can never be issued (docs/41 §13.3).
   */
  async resolveVersion(templateVersionId: string, documentType: CommercialDocumentType) {
    const version = await this.prisma.documentTemplateVersion.findUnique({
      where: { id: templateVersionId },
      include: { template: true },
    });
    if (!version) {
      throw new ApiError(
        ERROR_CODES.documentTemplateNotFound,
        'The selected document template version does not exist.',
      );
    }
    if (version.status !== 'PUBLISHED') {
      throw new ApiError(
        ERROR_CODES.documentTemplateNotPublished,
        'Only a published template version can be used for a document.',
      );
    }
    if (version.template.documentType !== documentType) {
      throw new ApiError(
        ERROR_CODES.documentTemplateTypeMismatch,
        'The selected template belongs to a different document type.',
        { status: 409 },
      );
    }
    return {
      version,
      template: version.template,
      config: parseTemplateConfig(version.config),
    };
  }

  async activeDefaultVersion(documentType: CommercialDocumentType, locale: string) {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { documentType, locale, status: 'ACTIVE', currentVersionId: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      include: {
        versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 },
      },
    });
    const version = template?.versions[0];
    if (!template || !version) return null;
    return { template, version, config: parseTemplateConfig(version.config) };
  }

  /**
   * Lazily creates the built-in template so a fresh installation can create a
   * draft immediately. The operation is idempotent and audited.
   */
  async ensureDefaultVersion(
    documentType: CommercialDocumentType,
    locale: string,
    actorId: string,
    requestId?: string,
  ) {
    const active = await this.activeDefaultVersion(documentType, locale);
    if (active) return active;
    const templateLocale = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
    const config = builtinTemplateConfig(documentType, templateLocale);
    const code = builtinTemplateCode(documentType, templateLocale);
    let template = await this.prisma.documentTemplate.findUnique({ where: { code } });
    if (!template) {
      try {
        const anyDefault = await this.prisma.documentTemplate.findFirst({
          where: { documentType, locale: templateLocale, isDefault: true },
          select: { id: true },
        });
        template = await this.prisma.documentTemplate.create({
          data: {
            code,
            name: builtinTemplateName(documentType),
            description: 'Built-in template created automatically on first use.',
            documentType,
            locale: templateLocale,
            paperSize: config.page.size,
            orientation: config.page.orientation,
            status: 'DRAFT',
            isDefault: anyDefault === null,
            draftConfig: config as never,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      } catch {
        template = await this.prisma.documentTemplate.findUnique({ where: { code } });
        if (!template) throw new ApiError(ERROR_CODES.conflict, 'Could not create the template.');
      }
    }
    const existingVersion = await this.prisma.documentTemplateVersion.findFirst({
      where: { templateId: template.id, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
    const version =
      existingVersion ??
      (await this.prisma.documentTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          status: 'PUBLISHED',
          config: parseTemplateConfig(template.draftConfig) as never,
          checksum: templateConfigChecksum(parseTemplateConfig(template.draftConfig)),
          createdById: actorId,
        },
      }));
    const updated = await this.prisma.documentTemplate.update({
      where: { id: template.id },
      data: { status: 'ACTIVE', currentVersionId: version.id },
    });
    await this.audit.record({
      actorId,
      action: existingVersion
        ? 'document_template.builtin_reused'
        : 'document_template.builtin_created',
      entityType: 'DocumentTemplate',
      entityId: updated.id,
      requestId: requestId ?? null,
      metadata: { documentType, locale: templateLocale, version: version.version },
    });
    return {
      template: updated,
      version,
      config: parseTemplateConfig(version.config),
    };
  }

  private buildConfig(input: CreateDocumentTemplateInput, actorId: string): DocumentTemplateConfig {
    if (input.config) {
      return parseTemplateConfig({
        ...input.config,
        page: {
          ...input.config.page,
          size: input.paperSize,
          orientation: input.orientation,
        },
      });
    }
    void actorId;
    const config = createDefaultTemplateConfig(
      input.documentType,
      input.locale === 'zh-CN' ? 'zh-CN' : 'en-US',
    );
    config.page.size = input.paperSize;
    config.page.orientation = input.orientation;
    return config;
  }

  private validationReport(
    config: DocumentTemplateConfig,
    documentType: CommercialDocumentType,
    locale: string,
  ) {
    const visibleFields = config.sections
      .filter((section) => section.visible)
      .flatMap((section) => section.fields.filter((field) => field.visible));
    const warnings: string[] = [];
    if (!visibleFields.some((field) => field.key.startsWith('buyer.'))) {
      warnings.push('buyer.missing');
    }
    if (!visibleFields.some((field) => field.key.startsWith('totals.'))) {
      warnings.push('totals.missing');
    }
    if (
      !config.itemColumns.some((column) => column.key === 'items.description' && column.visible)
    ) {
      warnings.push('items.description.missing');
    }
    if (!config.itemColumns.some((column) => column.key === 'items.amount' && column.visible)) {
      warnings.push('items.amount.missing');
    }
    if (!isFieldVisible(config, 'signature', 'signature.seller')) {
      warnings.push('signature.seller.missing');
    }
    if (!isFieldVisible(config, 'signature', 'signature.buyer')) {
      warnings.push('signature.buyer.missing');
    }
    return {
      valid: true,
      errors: [],
      warnings,
      documentType,
      locale,
      fieldCount: visibleFields.length,
      columnCount: config.itemColumns.filter((column) => column.visible).length,
    };
  }

  private sampleDocument(
    documentType: CommercialDocumentType,
    locale: string,
  ): CommercialDocumentRenderData {
    const totals = calculateDocumentTotals({
      currency: 'USD',
      items: [
        { quantity: '1000', unitPrice: '0.28' },
        { quantity: '50', unitPrice: '12.5' },
      ],
      freightAmount: '180',
      otherCharges: '35',
    });
    return {
      documentType,
      documentNo: `${documentType}-20260101-SAMPLE`,
      revisionNo: 1,
      status: 'DRAFT',
      locale: locale === 'zh-CN' ? 'zh-CN' : 'en-US',
      currency: 'USD',
      issueDate: '2026-01-01',
      orderNo: 'O-20260101-SAMPLE',
      orderDate: '2026-01-01',
      seller: {
        companyName: 'Your company name',
        contactName: 'Export sales',
        phone: '+86 000 0000 0000',
        email: 'sales@example.com',
        address: {
          line1: '88 Industrial Road',
          city: 'Shanghai',
          state: 'Shanghai',
          postalCode: '200000',
          countryCode: 'CN',
        },
      },
      buyer: {
        companyName: 'Sample buyer Inc.',
        contactName: 'Buyer contact',
        phone: '+1 415 555 0100',
        email: 'buyer@example.com',
        billingAddress: {
          line1: '1 Main Street',
          city: 'Atlanta',
          state: 'GA',
          postalCode: '30301',
          countryCode: 'US',
        },
      },
      consignee: {
        companyName: 'Sample consignee',
        contactName: 'Warehouse',
        shippingAddress: {
          line1: '2 Warehouse Way',
          city: 'Atlanta',
          state: 'GA',
          postalCode: '30301',
          countryCode: 'US',
        },
      },
      trade: {
        incotermCode: 'DDP',
        namedPlace: 'Atlanta, GA',
        paymentTerms: 'T/T 30% deposit, balance before shipment',
        exchangeRateText: '1 CNY = 0.140000 USD',
      },
      shipping: {
        method: 'Sea freight',
        portOfLoading: 'Shanghai',
        portOfDischarge: 'Savannah',
        cartonCount: 20,
        grossWeightKg: '320.5',
        cbm: '4.2',
      },
      payment: {
        accountHolder: 'Your company name',
        bankName: 'Sample bank',
        accountNumber: '0000000000',
        swiftCode: 'SAMPLEXX',
      },
      declaration: {
        countryOfOrigin: 'CN',
        text: 'The goods described are of Chinese origin.',
      },
      items: totals.items.map((item, index) => ({
        lineNo: item.lineNo,
        sku: `SAMPLE-${index + 1}`,
        description: index === 0 ? 'Steel bolt M12' : 'Packaging carton',
        hsCode: index === 0 ? '73181590' : '48191000',
        originCountryCode: 'CN',
        quantity: item.quantity,
        unit: 'pcs',
        unitPrice: item.unitPrice,
        cartons: index === 0 ? 10 : 10,
        grossWeightKg: index === 0 ? '200.5' : '120',
        cbm: index === 0 ? '2.2' : '2.0',
        lineAmount: item.lineAmount,
      })),
      totals: {
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        freightAmount: totals.freightAmount,
        insuranceAmount: totals.insuranceAmount,
        otherCharges: totals.otherCharges,
        totalAmount: totals.totalAmount,
      },
      notes: 'Sample preview only.',
    };
  }

  private dto(template: TemplateWithVersions) {
    const versions = template.versions ?? [];
    const current =
      versions.find((version) => version.id === template.currentVersionId) ??
      versions.find((version) => version.status === 'PUBLISHED') ??
      null;
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      documentType: template.documentType,
      locale: template.locale,
      paperSize: template.paperSize,
      orientation: template.orientation,
      status: template.status,
      isDefault: template.isDefault,
      draftConfig: parseTemplateConfig(template.draftConfig),
      hasUnpublishedChanges: current
        ? !templateConfigsEqual(template.draftConfig, current.config)
        : true,
      currentVersion: current
        ? {
            id: current.id,
            version: current.version,
            checksum: current.checksum,
            publishedAt: current.publishedAt.toISOString(),
          }
        : null,
      versionCount: versions.length,
      canDelete:
        !template.isDefault &&
        (template.status === 'DRAFT' || template.status === 'DISABLED') &&
        (template._count?.documents ?? 0) === 0 &&
        versions.every((version) => (version._count?.renderJobs ?? 0) === 0),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
