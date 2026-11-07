import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type CommercialDocumentType } from '@b2b/contracts';
import {
  builtinTemplateCode,
  builtinTemplateConfig,
  builtinTemplateName,
  calculateDocumentTotals,
  createDefaultTemplateConfig,
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
  UpdateDocumentTemplateInput,
} from '@b2b/validation';
import { Prisma, type DocumentTemplate, type DocumentTemplateVersion } from '@b2b/database';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

type TemplateWithVersions = DocumentTemplate & {
  versions?: DocumentTemplateVersion[];
};

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
        orderBy: [{ documentType: 'asc' }, { updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { versions: { orderBy: { version: 'desc' }, take: 20 } },
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
      include: { versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 } },
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
      }));
  }

  async detail(id: string) {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: 'desc' } },
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
    const config = this.buildConfig(input, actorId);
    const code = `${input.documentType.toLowerCase()}-${randomUUID().slice(0, 12)}`;
    const template = await this.prisma.$transaction(async (transaction) => {
      if (input.isDefault) {
        await transaction.documentTemplate.updateMany({
          where: { documentType: input.documentType, isDefault: true },
          data: { isDefault: false },
        });
      }
      return transaction.documentTemplate.create({
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
      });
    });
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
          where: { documentType: existing.documentType, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return transaction.documentTemplate.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
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

  async validateTemplate(id: string) {
    const template = await this.prisma.documentTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Document template not found.');
    return { data: this.validationReport(template) };
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
      throw ApiError.validation('The selected document template version does not exist.');
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
      include: { versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 } },
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
          where: { documentType, isDefault: true },
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
      action: existingVersion ? 'document_template.builtin_reused' : 'document_template.builtin_created',
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

  private validationReport(template: DocumentTemplate) {
    let config: DocumentTemplateConfig;
    try {
      config = parseTemplateConfig(template.draftConfig);
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Invalid template configuration.'],
        warnings: [],
      };
    }
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
    if (!config.itemColumns.some((column) => column.key === 'items.description' && column.visible)) {
      warnings.push('items.description.missing');
    }
    if (!config.itemColumns.some((column) => column.key === 'items.amount' && column.visible)) {
      warnings.push('items.amount.missing');
    }
    return {
      valid: true,
      errors: [],
      warnings,
      documentType: template.documentType,
      locale: template.locale,
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
      draftConfig: template.draftConfig,
      currentVersion: current
        ? {
            id: current.id,
            version: current.version,
            checksum: current.checksum,
            publishedAt: current.publishedAt.toISOString(),
          }
        : null,
      versionCount: versions.length,
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
