import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type CommercialDocumentType,
  type DocumentRenderJobPayload,
} from '@b2b/contracts';
import {
  calculateDocumentTotals,
  defaultFieldLabel,
  findMissingDocumentFields,
  parseTemplateConfig,
  renderCommercialDocumentHtml,
  type CommercialDocumentRenderData,
  type DocumentAddressSnapshot,
  type DocumentPaymentSnapshot,
  type DocumentPartySnapshot,
  type DocumentShippingSnapshot,
  type DocumentTemplateConfig,
  type DocumentTradeSnapshot,
} from '@b2b/commercial-documents';
import type {
  CommercialDocumentItemInput,
  CommercialDocumentListQuery,
  CreateCommercialDocumentInput,
  UpdateCommercialDocumentInput,
} from '@b2b/validation';
import Decimal from 'decimal.js';
import { Prisma, type BankAccountProfile } from '@b2b/database';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { JsonLogger } from '../../common/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyProfilesService } from './company-profiles.service';
import { DocumentTemplatesService } from './document-templates.service';

const EDITABLE_STATUSES = new Set(['DRAFT', 'REVIEW']);
const DOWNLOADABLE_STATUSES = new Set(['ISSUED', 'SUPERSEDED', 'CANCELLED']);
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const documentDetailInclude = {
  items: { orderBy: { lineNo: 'asc' } },
  template: true,
  templateVersion: true,
  order: { select: { id: true, orderNo: true, orderDate: true, status: true } },
  renderJobs: { orderBy: { createdAt: 'desc' }, take: 5 },
} satisfies Prisma.CommercialDocumentInclude;

type DocumentDetail = Prisma.CommercialDocumentGetPayload<{
  include: typeof documentDetailInclude;
}>;

const orderForDocumentInclude = {
  items: { orderBy: { lineNo: 'asc' } },
  fees: { orderBy: { lineNo: 'asc' } },
} satisfies Prisma.OrderInclude;

type OrderForDocument = Prisma.OrderGetPayload<{ include: typeof orderForDocumentInclude }>;

interface BuiltDocumentData {
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
  consignee: Record<string, unknown> | null;
  notifyParty: Record<string, unknown> | null;
  trade: Record<string, unknown>;
  shipping: Record<string, unknown>;
  payment: Record<string, unknown> | null;
  declaration: Record<string, unknown>;
  signature: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  totals: DocumentTotals;
}

export interface DocumentTotals {
  currency: string;
  subtotal: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherCharges: string;
  totalAmount: string;
}

// CI/PI documents are built from an order snapshot, then completed with
// document-only fields. Money is always recomputed here with Decimal, never
// taken from the browser (docs/41 §10).
@Injectable()
export class CommercialDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly logger: JsonLogger,
    private readonly templates: DocumentTemplatesService,
    private readonly profiles: CompanyProfilesService,
  ) {}

  async list(query: CommercialDocumentListQuery) {
    const where: Prisma.CommercialDocumentWhereInput = {
      ...(query.type === 'all' ? {} : { documentType: query.type }),
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: this.dateBoundary(query.from, false) } : {}),
              ...(query.to ? { lte: this.dateBoundary(query.to, true) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { documentNo: { contains: query.q, mode: 'insensitive' } },
              { order: { orderNo: { contains: query.q, mode: 'insensitive' } } },
              { order: { buyerCompanyName: { contains: query.q, mode: 'insensitive' } } },
              { order: { buyerContactName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.commercialDocument.count({ where }),
      this.prisma.commercialDocument.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { documentNo: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          order: { select: { orderNo: true, buyerCompanyName: true } },
          template: { select: { name: true } },
          templateVersion: { select: { version: true } },
          renderJobs: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);
    return {
      data: rows.map((row) => {
        const buyer = (row.buyerSnapshot as Record<string, unknown> | null) ?? {};
        const latestJob = row.renderJobs[0] ?? null;
        return {
          id: row.id,
          type: row.documentType,
          documentNo: row.documentNo,
          revisionNo: row.revisionNo,
          status: row.status,
          currency: row.currency,
          totalAmount: row.totalAmount.toString(),
          issueDate: row.issueDate?.toISOString().slice(0, 10) ?? null,
          issuedAt: row.issuedAt?.toISOString() ?? null,
          orderId: row.orderId,
          orderNo: row.order?.orderNo ?? null,
          buyerName:
            (buyer.companyName as string | undefined) ?? row.order?.buyerCompanyName ?? null,
          sellerName:
            ((row.sellerSnapshot as Record<string, unknown> | null)?.companyName as
              string | undefined) ?? null,
          templateName: row.template?.name ?? null,
          templateVersion: row.templateVersion?.version ?? null,
          hasPdf: Boolean(row.pdfFileKey),
          renderStatus: latestJob?.status ?? null,
          renderErrorCode: latestJob?.errorCode ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: string) {
    const document = await this.loadDetail(id);
    return this.dto(document);
  }

  /** Prefill endpoint for the create wizard, including the exact missing list. */
  async prefill(orderId: string, documentType: CommercialDocumentType, actorId: string) {
    const order = await this.loadOrder(orderId);
    const template = await this.resolveTemplateForOrder(
      order,
      documentType,
      'en-US',
      null,
      actorId,
    );
    const companyProfile = await this.profiles.defaultProfile();
    const bankAccount = await this.resolveBankAccount(
      companyProfile?.id ?? null,
      null,
      order.currencyCode,
    );
    const bankAccountStatus = await this.bankAccountStatus(
      companyProfile?.id ?? null,
      order.currencyCode,
      bankAccount,
    );
    const bankAccounts = companyProfile
      ? await this.prisma.bankAccountProfile.findMany({
          where: {
            companyProfileId: companyProfile.id,
            currencyCode: order.currencyCode,
            enabled: true,
          },
          orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { label: 'asc' }],
        })
      : [];
    const data = await this.buildFromOrder(
      order,
      documentType,
      template.config,
      companyProfile,
      bankAccount,
    );
    const items = data.items.map((item, index) => this.itemRenderData(item, index));
    const renderData = this.prefillRenderData(order, documentType, items, data.totals, {
      seller: data.seller,
      buyer: data.buyer,
      consignee: data.consignee,
      notifyParty: data.notifyParty,
      trade: data.trade,
      shipping: data.shipping,
      payment: data.payment,
      declaration: data.declaration,
      signature: data.signature,
    });
    const missing = findMissingDocumentFields(renderData, template.config);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      documentType,
      currency: order.currencyCode,
      companyProfileId: companyProfile?.id ?? null,
      bankAccountId: bankAccount?.id ?? null,
      bankAccount: bankAccount ? this.bankAccountSummary(bankAccount) : null,
      bankAccountStatus,
      bankAccounts: bankAccounts.map((account) => this.bankAccountSummary(account)),
      buyer: data.buyer,
      consignee: data.consignee,
      notifyParty: data.notifyParty,
      seller: data.seller,
      trade: data.trade,
      shipping: data.shipping,
      payment: data.payment,
      declaration: data.declaration,
      items: data.items,
      totals: data.totals,
      template: {
        id: template.template.id,
        versionId: template.version.id,
        version: template.version.version,
        name: template.template.name,
        locale: template.template.locale,
      },
      templateOptions: await this.templates.activeOptions(documentType),
      missingFields: missing.missing,
      missingFieldLabels: missing.missing.map((key) => ({
        key,
        label: defaultFieldLabel(key, 'en-US'),
      })),
      missingItemLines: missing.missingItemLines,
    };
  }

  async createFromOrder(
    orderId: string,
    input: CreateCommercialDocumentInput,
    actorId: string,
    requestId: string,
  ) {
    const order = await this.loadOrder(orderId);
    if (order.status === 'CANCELLED') {
      throw new ApiError(
        ERROR_CODES.commercialDocumentStateConflict,
        'A cancelled order cannot be used to create a commercial document.',
      );
    }
    const currency = (input.currency ?? order.currencyCode).toUpperCase();
    if (currency !== order.currencyCode) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentCurrencyMismatch,
        'The document currency must match the order currency. Create a revised order before changing currency.',
      );
    }
    const template = await this.resolveTemplateForOrder(
      order,
      input.documentType,
      input.locale,
      input.templateVersionId ?? null,
      actorId,
      requestId,
    );
    const companyProfile =
      input.companyProfileId !== undefined && input.companyProfileId !== null
        ? await this.enabledCompanyProfile(input.companyProfileId)
        : await this.profiles.defaultProfile();
    if (input.bankAccountId && !companyProfile?.id) {
      throw new ApiError(
        ERROR_CODES.companyProfileNotFound,
        'A seller company profile is required to select a bank account.',
      );
    }
    const bankAccount = await this.resolveBankAccount(
      companyProfile?.id ?? null,
      input.bankAccountId ?? null,
      currency,
    );
    if (!bankAccount) {
      await this.assertBankAccountAvailable(companyProfile?.id ?? null, currency);
    }
    const data = await this.buildFromOrder(
      order,
      input.documentType,
      template.config,
      companyProfile,
      bankAccount,
    );
    const issueDate = input.issueDate ? this.parseDateOnly(input.issueDate) : this.todayDateOnly();
    const documentNo = await this.generateDocumentNo(input.documentType);
    const document = await this.prisma.$transaction(async (transaction) => {
      return transaction.commercialDocument.create({
        data: {
          documentType: input.documentType,
          documentNo,
          revisionNo: 1,
          status: 'DRAFT',
          locale: input.locale,
          currency,
          issueDate,
          version: 1,
          orderId: order.id,
          templateId: template.template.id,
          templateVersionId: template.version.id,
          templateVersionNo: template.version.version,
          createdById: actorId,
          sellerSnapshot: data.seller as Prisma.InputJsonValue,
          buyerSnapshot: data.buyer as Prisma.InputJsonValue,
          consigneeSnapshot: (data.consignee ?? undefined) as Prisma.InputJsonValue | undefined,
          notifyPartySnapshot: (data.notifyParty ?? undefined) as Prisma.InputJsonValue | undefined,
          tradeSnapshot: data.trade as Prisma.InputJsonValue,
          shippingSnapshot: data.shipping as Prisma.InputJsonValue,
          paymentSnapshot: (data.payment ?? undefined) as Prisma.InputJsonValue | undefined,
          declarationSnapshot: data.declaration as Prisma.InputJsonValue,
          signatureSnapshot: data.signature as Prisma.InputJsonValue,
          totalsSnapshot: data.totals as unknown as Prisma.InputJsonValue,
          calculationSnapshot: {
            source: 'order',
            orderNo: order.orderNo,
            orderCurrency: order.currencyCode,
            documentCurrency: currency,
            companyProfileId: companyProfile?.id ?? null,
            bankAccountId: bankAccount?.id ?? null,
            pricingPolicy: { scale: 2, rounding: 'HALF_UP', computedBy: 'server' },
          } as Prisma.InputJsonValue,
          subtotal: data.totals.subtotal,
          discountAmount: data.totals.discountAmount,
          freightAmount: data.totals.freightAmount,
          insuranceAmount: data.totals.insuranceAmount,
          otherCharges: data.totals.otherCharges,
          totalAmount: data.totals.totalAmount,
          items: {
            create: data.items.map((item, index) => this.itemCreateData(item, index, currency)),
          },
        },
      });
    });
    await this.audit.record({
      actorId,
      action: 'commercial_document.created',
      entityType: 'CommercialDocument',
      entityId: document.id,
      requestId,
      metadata: {
        documentType: document.documentType,
        documentNo: document.documentNo,
        orderNo: order.orderNo,
        templateVersion: template.version.version,
        totalAmount: data.totals.totalAmount,
      },
    });
    return this.detail(document.id);
  }

  async update(
    id: string,
    input: UpdateCommercialDocumentInput,
    actorId: string,
    requestId: string,
  ) {
    const document = await this.prisma.commercialDocument.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    if (!document)
      throw new ApiError(ERROR_CODES.commercialDocumentNotFound, 'Document not found.');
    if (!EDITABLE_STATUSES.has(document.status)) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentNotEditable,
        'An issued document is frozen. Create a new revision to change it.',
      );
    }
    if (document.version !== input.version) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentConcurrentUpdate,
        'The document was changed by another session. Reload and try again.',
        { status: 409, details: { currentVersion: document.version } },
      );
    }

    let templateVersionId = document.templateVersionId;
    let templateVersionNo = document.templateVersionNo;
    let templateId = document.templateId;
    if (input.templateVersionId) {
      const resolved = await this.templates.resolveVersion(
        input.templateVersionId,
        document.documentType,
      );
      templateVersionId = resolved.version.id;
      templateVersionNo = resolved.version.version;
      templateId = resolved.template.id;
    }

    const currency = (input.currency ?? document.currency).toUpperCase();
    if (currency !== document.currency && !input.items) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentCurrencyMismatch,
        'Changing the document currency requires re-entering item prices.',
      );
    }

    const seller = this.mergeSnapshot(document.sellerSnapshot, input.seller);
    const buyer = this.mergeSnapshot(document.buyerSnapshot, input.buyer);
    const consignee =
      input.consignee === null
        ? null
        : input.consignee
          ? this.mergeSnapshot(document.consigneeSnapshot, input.consignee)
          : ((document.consigneeSnapshot as Record<string, unknown> | null) ?? null);
    const notifyParty =
      input.notifyParty === null
        ? null
        : input.notifyParty
          ? this.mergeSnapshot(document.notifyPartySnapshot, input.notifyParty)
          : ((document.notifyPartySnapshot as Record<string, unknown> | null) ?? null);
    const trade = this.mergeSnapshot(document.tradeSnapshot, input.trade);
    const shipping = this.mergeSnapshot(document.shippingSnapshot, input.shipping);
    // Browser-supplied payment data is never trusted. A draft keeps its
    // existing snapshot unless a bankAccountId is supplied, in which case the
    // server re-reads the complete account below (docs/44 §10.2, §12).
    let payment = (document.paymentSnapshot as Record<string, unknown> | null) ?? null;
    let calculationSnapshot =
      (document.calculationSnapshot as Record<string, unknown> | null) ?? {};
    const storedCompanyProfileId =
      typeof calculationSnapshot.companyProfileId === 'string'
        ? calculationSnapshot.companyProfileId
        : null;

    if (input.bankAccountId !== undefined) {
      const companyProfileId = input.companyProfileId ?? storedCompanyProfileId;
      if (input.bankAccountId === null) {
        // Explicitly clearing the selection also clears the copied payment data.
        payment = null;
        calculationSnapshot = { ...calculationSnapshot, companyProfileId, bankAccountId: null };
      } else {
        if (!companyProfileId) {
          throw new ApiError(
            ERROR_CODES.companyProfileNotFound,
            'A seller company profile is required to select a bank account.',
          );
        }
        const account = await this.resolveBankAccount(
          companyProfileId,
          input.bankAccountId,
          currency,
        );
        if (!account) {
          throw new ApiError(ERROR_CODES.bankAccountNotFound, 'Bank account not found.');
        }
        payment = this.paymentSnapshot(account);
        calculationSnapshot = {
          ...calculationSnapshot,
          companyProfileId: account.companyProfileId,
          bankAccountId: account.id,
        };
      }
    } else if (input.currency && input.currency !== document.currency) {
      // Never keep old-currency receiving details after a currency change.
      payment = null;
      calculationSnapshot = { ...calculationSnapshot, bankAccountId: null };
    } else if (input.companyProfileId !== undefined) {
      calculationSnapshot = {
        ...calculationSnapshot,
        companyProfileId: input.companyProfileId,
      };
    }

    const declaration = this.mergeSnapshot(document.declarationSnapshot, input.declaration);
    const signature = this.mergeSnapshot(document.signatureSnapshot, input.signature);

    const itemInputs: CommercialDocumentItemInput[] = input.items
      ? input.items
      : document.items.map((item) => ({
          lineNo: item.lineNo,
          productId: item.productId,
          sku: item.skuSnapshot,
          description: item.descriptionSnapshot,
          hsCode: item.hsCodeSnapshot ?? '',
          originCountryCode: item.originCountrySnapshot,
          quantity: item.quantity.toString(),
          unit: item.unit,
          unitPrice: item.unitPrice.toString(),
          discountAmount: item.discountAmount.toString(),
          currency: item.currency,
          cartons: item.cartons,
          unitsPerCarton: item.unitsPerCarton,
          netWeightKg: item.netWeightKg?.toString() ?? null,
          grossWeightKg: item.grossWeightKg?.toString() ?? null,
          cbm: item.cbm?.toString() ?? null,
          packaging: (item.packagingSnapshot as Record<string, unknown> | null | undefined) ?? null,
        }));

    const totals = this.calculateTotals(currency, itemInputs, {
      discountAmount: input.discountAmount ?? document.discountAmount.toString(),
      freightAmount: input.freightAmount ?? document.freightAmount.toString(),
      insuranceAmount: input.insuranceAmount ?? document.insuranceAmount.toString(),
      otherCharges: input.otherCharges ?? document.otherCharges.toString(),
    });
    const normalizedItems = itemInputs.map((item, index) => ({
      ...item,
      ...totals.normalizedItems[index]!,
    }));

    const updated = await this.prisma.$transaction(async (transaction) => {
      if (input.items) {
        await transaction.commercialDocumentItem.deleteMany({ where: { documentId: id } });
        await transaction.commercialDocumentItem.createMany({
          data: normalizedItems.map((item, index) =>
            this.normalizedItemCreateData(
              id,
              item,
              index,
              currency,
              totals.normalizedItems[index]!,
            ),
          ),
        });
      }
      const result = await transaction.commercialDocument.updateMany({
        where: { id, version: input.version, status: document.status },
        data: {
          version: { increment: 1 },
          ...(input.locale ? { locale: input.locale } : {}),
          currency,
          ...(input.issueDate !== undefined
            ? { issueDate: input.issueDate ? this.parseDateOnly(input.issueDate) : null }
            : {}),
          ...(input.validUntil !== undefined
            ? { validUntil: input.validUntil ? this.parseDateOnly(input.validUntil) : null }
            : {}),
          ...(templateVersionId ? { templateVersionId } : {}),
          ...(templateVersionNo ? { templateVersionNo } : {}),
          ...(templateId ? { templateId } : {}),
          sellerSnapshot: seller as Prisma.InputJsonValue,
          buyerSnapshot: buyer as Prisma.InputJsonValue,
          consigneeSnapshot: (consignee ?? Prisma.DbNull) as Prisma.InputJsonValue,
          notifyPartySnapshot: (notifyParty ?? Prisma.DbNull) as Prisma.InputJsonValue,
          tradeSnapshot: trade as Prisma.InputJsonValue,
          shippingSnapshot: shipping as Prisma.InputJsonValue,
          paymentSnapshot: (payment ?? Prisma.DbNull) as Prisma.InputJsonValue,
          calculationSnapshot: calculationSnapshot as Prisma.InputJsonValue,
          declarationSnapshot: declaration as Prisma.InputJsonValue,
          signatureSnapshot: signature as Prisma.InputJsonValue,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          freightAmount: totals.freightAmount,
          insuranceAmount: totals.insuranceAmount,
          otherCharges: totals.otherCharges,
          totalAmount: totals.totalAmount,
          totalsSnapshot: totals as unknown as Prisma.InputJsonValue,
          // Any edit invalidates the previously rendered draft PDF.
          pdfFileKey: null,
          pdfSha256: null,
          pdfSizeBytes: null,
          generatedAt: null,
        },
      });
      if (result.count !== 1) {
        const current = await transaction.commercialDocument.findUnique({
          where: { id },
          select: { version: true, status: true },
        });
        if (!current)
          throw new ApiError(ERROR_CODES.commercialDocumentNotFound, 'Document not found.');
        if (!EDITABLE_STATUSES.has(current.status)) {
          throw new ApiError(
            ERROR_CODES.commercialDocumentNotEditable,
            'The document is no longer editable.',
          );
        }
        throw new ApiError(
          ERROR_CODES.commercialDocumentConcurrentUpdate,
          'The document was changed by another session. Reload and try again.',
          { status: 409, details: { currentVersion: current.version } },
        );
      }
      return transaction.commercialDocument.findUniqueOrThrow({ where: { id } });
    });

    await this.audit.record({
      actorId,
      action: 'commercial_document.updated',
      entityType: 'CommercialDocument',
      entityId: id,
      requestId,
      metadata: {
        documentNo: document.documentNo,
        changedFields: Object.keys(input).filter((key) => key !== 'version'),
        totalAmount: totals.totalAmount,
        templateVersion: templateVersionNo,
      },
    });
    return this.detail(updated.id);
  }

  async preview(id: string) {
    const document = await this.loadDetail(id);
    const config = this.configFromDocument(document);
    const data = this.renderData(document);
    const assets = await this.renderAssets(data);
    return {
      data: {
        html: renderCommercialDocumentHtml(config, data, assets),
        missingFields: findMissingDocumentFields(data, config).missing,
        documentNo: document.documentNo,
        revisionNo: document.revisionNo,
      },
    };
  }

  async requestRender(id: string, actorId: string, requestId: string) {
    const document = await this.prisma.commercialDocument.findUnique({ where: { id } });
    if (!document)
      throw new ApiError(ERROR_CODES.commercialDocumentNotFound, 'Document not found.');
    if (document.status === 'CANCELLED') {
      throw new ApiError(
        ERROR_CODES.commercialDocumentStateConflict,
        'A cancelled document cannot be rendered.',
      );
    }
    const existing = await this.prisma.documentRenderJob.findFirst({
      where: {
        documentId: id,
        status: { in: ['QUEUED', 'PROCESSING'] },
        templateVersionId: document.templateVersionId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { data: this.renderJobDto(existing) };

    const job = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.documentRenderJob.create({
        data: {
          documentId: id,
          templateVersionId: document.templateVersionId,
          status: 'QUEUED',
          attemptId: randomUUID(),
          requestedById: actorId,
        },
      });
      const payload: DocumentRenderJobPayload = {
        jobId: created.id,
        attemptId: created.attemptId,
      };
      await transaction.outboxEvent.create({
        data: {
          eventType: 'commercial-document-render',
          payload: payload as unknown as Prisma.InputJsonValue,
          idempotencyKey: `commercial-document-render:${created.id}:${created.attemptId}`,
        },
      });
      return created;
    });
    await this.audit.record({
      actorId,
      action: 'commercial_document.render_requested',
      entityType: 'CommercialDocument',
      entityId: id,
      requestId,
      metadata: { documentNo: document.documentNo, jobId: job.id },
    });
    return { data: this.renderJobDto(job) };
  }

  async issue(id: string, version: number | undefined, actorId: string, requestId: string) {
    const document = await this.loadDetail(id);
    if (document.status === 'ISSUED') {
      // Idempotent: a repeated issue request returns the frozen document.
      return this.dto(document);
    }
    if (!EDITABLE_STATUSES.has(document.status)) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentStateConflict,
        'Only a draft or review document can be issued.',
      );
    }
    if (version !== undefined && document.version !== version) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentConcurrentUpdate,
        'The document was changed by another session. Reload and try again.',
        { status: 409, details: { currentVersion: document.version } },
      );
    }
    if (!document.templateVersionId || !document.templateVersion) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentTemplateRequired,
        'Select a published document template before issuing.',
      );
    }
    if (document.templateVersion.status !== 'PUBLISHED') {
      throw new ApiError(
        ERROR_CODES.documentTemplateNotPublished,
        'The document template version is not published.',
      );
    }
    const config = parseTemplateConfig(document.templateVersion.config);
    const data = this.renderData(document);
    const missing = findMissingDocumentFields(data, config);
    if (missing.missing.length > 0 || missing.missingItemLines.length > 0) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentMissingFields,
        'Complete the required fields before issuing this document.',
        {
          status: 422,
          details: {
            missingFields: missing.missing,
            missingItemLines: missing.missingItemLines,
          },
        },
      );
    }

    const issued = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.commercialDocument.updateMany({
        where: { id, version: document.version, status: { in: ['DRAFT', 'REVIEW'] } },
        data: {
          status: 'ISSUED',
          issuedAt: new Date(),
          issuedById: actorId,
          version: { increment: 1 },
          ...(document.issueDate ? {} : { issueDate: this.todayDateOnly() }),
        },
      });
      if (result.count !== 1) {
        const current = await transaction.commercialDocument.findUnique({
          where: { id },
          select: { status: true, version: true },
        });
        if (current?.status === 'ISSUED') return { alreadyIssued: true as const };
        throw new ApiError(
          ERROR_CODES.commercialDocumentStateConflict,
          'The document state changed before it could be issued. Reload and retry.',
          { status: 409 },
        );
      }
      const created = await transaction.documentRenderJob.create({
        data: {
          documentId: id,
          templateVersionId: document.templateVersionId,
          status: 'QUEUED',
          attemptId: randomUUID(),
          requestedById: actorId,
        },
      });
      const payload: DocumentRenderJobPayload = {
        jobId: created.id,
        attemptId: created.attemptId,
      };
      await transaction.outboxEvent.create({
        data: {
          eventType: 'commercial-document-render',
          payload: payload as unknown as Prisma.InputJsonValue,
          idempotencyKey: `commercial-document-render:${created.id}:${created.attemptId}`,
        },
      });
      return { alreadyIssued: false as const, jobId: created.id };
    });
    await this.audit.record({
      actorId,
      action: 'commercial_document.issued',
      entityType: 'CommercialDocument',
      entityId: id,
      requestId,
      metadata: {
        documentNo: document.documentNo,
        revisionNo: document.revisionNo,
        documentType: document.documentType,
        totalAmount: document.totalAmount.toString(),
        alreadyIssued: issued.alreadyIssued,
      },
    });
    return this.detail(id);
  }

  async createRevision(id: string, actorId: string, requestId: string) {
    const source = await this.prisma.commercialDocument.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    if (!source) throw new ApiError(ERROR_CODES.commercialDocumentNotFound, 'Document not found.');
    if (source.status !== 'ISSUED') {
      throw new ApiError(
        ERROR_CODES.commercialDocumentStateConflict,
        'Only an issued document can be revised. Save changes to a draft instead.',
      );
    }
    const revision = await this.prisma.$transaction(async (transaction) => {
      const latest = await transaction.commercialDocument.findFirst({
        where: { documentType: source.documentType, documentNo: source.documentNo },
        orderBy: { revisionNo: 'desc' },
        select: { revisionNo: true },
      });
      const created = await transaction.commercialDocument.create({
        data: {
          documentType: source.documentType,
          documentNo: source.documentNo,
          revisionNo: (latest?.revisionNo ?? source.revisionNo) + 1,
          status: 'DRAFT',
          locale: source.locale,
          currency: source.currency,
          issueDate: source.issueDate,
          validUntil: source.validUntil,
          version: 1,
          orderId: source.orderId,
          templateId: source.templateId,
          templateVersionId: source.templateVersionId,
          templateVersionNo: source.templateVersionNo,
          createdById: actorId,
          supersedesId: source.id,
          sellerSnapshot: source.sellerSnapshot as Prisma.InputJsonValue,
          buyerSnapshot: source.buyerSnapshot as Prisma.InputJsonValue,
          consigneeSnapshot: (source.consigneeSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
          notifyPartySnapshot: (source.notifyPartySnapshot ??
            Prisma.DbNull) as Prisma.InputJsonValue,
          tradeSnapshot: (source.tradeSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
          shippingSnapshot: (source.shippingSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
          paymentSnapshot: (source.paymentSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
          declarationSnapshot: (source.declarationSnapshot ??
            Prisma.DbNull) as Prisma.InputJsonValue,
          signatureSnapshot: (source.signatureSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
          totalsSnapshot: source.totalsSnapshot as Prisma.InputJsonValue,
          calculationSnapshot: {
            ...((source.calculationSnapshot as Record<string, unknown> | null) ?? {}),
            revisionOf: source.id,
            sourceRevision: source.revisionNo,
          } as Prisma.InputJsonValue,
          subtotal: source.subtotal,
          discountAmount: source.discountAmount,
          freightAmount: source.freightAmount,
          insuranceAmount: source.insuranceAmount,
          otherCharges: source.otherCharges,
          totalAmount: source.totalAmount,
          notes: source.notes,
          items: {
            create: source.items.map((item) => ({
              lineNo: item.lineNo,
              productId: item.productId,
              skuSnapshot: item.skuSnapshot,
              descriptionSnapshot: item.descriptionSnapshot,
              hsCodeSnapshot: item.hsCodeSnapshot,
              originCountrySnapshot: item.originCountrySnapshot,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount,
              lineAmount: item.lineAmount,
              currency: item.currency,
              cartons: item.cartons,
              unitsPerCarton: item.unitsPerCarton,
              netWeightKg: item.netWeightKg,
              grossWeightKg: item.grossWeightKg,
              cbm: item.cbm,
              packagingSnapshot: (item.packagingSnapshot ?? undefined) as
                Prisma.InputJsonValue | undefined,
            })),
          },
        },
      });
      await transaction.commercialDocument.update({
        where: { id: source.id },
        data: { status: 'SUPERSEDED', version: { increment: 1 } },
      });
      return created;
    });
    await this.audit.record({
      actorId,
      action: 'commercial_document.revision.created',
      entityType: 'CommercialDocument',
      entityId: revision.id,
      requestId,
      metadata: {
        documentNo: revision.documentNo,
        revisionNo: revision.revisionNo,
        supersedes: source.id,
      },
    });
    return this.detail(revision.id);
  }

  async cancel(id: string, input: { reason?: string | null }, actorId: string, requestId: string) {
    const document = await this.prisma.commercialDocument.findUnique({ where: { id } });
    if (!document)
      throw new ApiError(ERROR_CODES.commercialDocumentNotFound, 'Document not found.');
    if (document.status === 'CANCELLED') return this.detail(id);
    if (document.status === 'SUPERSEDED') {
      throw new ApiError(
        ERROR_CODES.commercialDocumentStateConflict,
        'A superseded revision cannot be cancelled.',
      );
    }
    const updated = await this.prisma.commercialDocument.update({
      where: { id },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    await this.audit.record({
      actorId,
      action: 'commercial_document.cancelled',
      entityType: 'CommercialDocument',
      entityId: id,
      requestId,
      metadata: {
        documentNo: document.documentNo,
        revisionNo: document.revisionNo,
        reason: input.reason ?? null,
      },
    });
    return this.detail(updated.id);
  }

  async download(id: string, actorId: string, requestId: string) {
    const document = await this.prisma.commercialDocument.findUnique({ where: { id } });
    if (!document)
      throw new ApiError(ERROR_CODES.commercialDocumentNotFound, 'Document not found.');
    if (!DOWNLOADABLE_STATUSES.has(document.status)) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentPdfUnavailable,
        'Only an issued or cancelled document can be downloaded.',
      );
    }
    if (!document.pdfFileKey || !document.pdfSizeBytes) {
      throw new ApiError(
        ERROR_CODES.commercialDocumentPdfUnavailable,
        'The PDF is still being generated. Retry shortly.',
      );
    }
    await this.audit.record({
      actorId,
      action: 'commercial_document.downloaded',
      entityType: 'CommercialDocument',
      entityId: id,
      requestId,
      metadata: {
        documentNo: document.documentNo,
        revisionNo: document.revisionNo,
        documentType: document.documentType,
      },
    });
    return {
      storageKey: document.pdfFileKey,
      sizeBytes: Number(document.pdfSizeBytes),
      filename: `${document.documentNo}-R${document.revisionNo}.pdf`,
      sha256: document.pdfSha256,
    };
  }

  // ------------------------------------------------------------- helpers

  private async loadDetail(id: string): Promise<DocumentDetail> {
    const document = await this.prisma.commercialDocument.findUnique({
      where: { id },
      include: documentDetailInclude,
    });
    if (!document)
      throw new ApiError(ERROR_CODES.commercialDocumentNotFound, 'Document not found.');
    return document;
  }

  private async loadOrder(id: string): Promise<OrderForDocument> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderForDocumentInclude,
    });
    if (!order) throw ApiError.notFound('Order not found.');
    return order;
  }

  private async enabledCompanyProfile(id: string) {
    const profile = await this.prisma.companyProfile.findFirst({
      where: { id, enabled: true },
    });
    if (!profile) {
      throw new ApiError(ERROR_CODES.companyProfileNotFound, 'The company profile was not found.');
    }
    return profile;
  }

  /**
   * Resolves a document's receiving account.
   *
   * Manual selection must match the document currency, be enabled and belong to
   * the selected company. Automatic selection only uses an enabled *default*
   * account in the document currency; it never substitutes another currency
   * (docs/44 §11).
   */
  private async resolveBankAccount(
    companyProfileId: string | null,
    bankAccountId: string | null,
    currencyCode: string,
  ): Promise<BankAccountProfile | null> {
    if (bankAccountId) {
      const account = await this.prisma.bankAccountProfile.findUnique({
        where: { id: bankAccountId },
      });
      if (!account || (companyProfileId && account.companyProfileId !== companyProfileId)) {
        throw new ApiError(
          ERROR_CODES.bankAccountNotFound,
          'The selected bank account was not found for this company.',
        );
      }
      if (!account.enabled) {
        throw new ApiError(
          ERROR_CODES.bankAccountDisabled,
          'The selected bank account is disabled.',
        );
      }
      if (!account.currencyCode || account.currencyCode !== currencyCode) {
        throw new ApiError(
          ERROR_CODES.bankAccountCurrencyMismatch,
          'The selected bank account currency does not match the document currency.',
        );
      }
      return account;
    }
    if (!companyProfileId) return null;
    return this.prisma.bankAccountProfile.findFirst({
      where: {
        companyProfileId,
        currencyCode,
        enabled: true,
        isDefault: true,
      },
    });
  }

  /** Distinguishes "choose an account" from "no account exists at all". */
  private async assertBankAccountAvailable(companyProfileId: string | null, currencyCode: string) {
    if (!companyProfileId) {
      throw new ApiError(
        ERROR_CODES.bankAccountMissing,
        'No active bank account is configured for the selected document currency.',
      );
    }
    const count = await this.prisma.bankAccountProfile.count({
      where: { companyProfileId, currencyCode, enabled: true },
    });
    if (count === 0) {
      throw new ApiError(
        ERROR_CODES.bankAccountMissing,
        'No active bank account is configured for the selected document currency.',
      );
    }
    throw new ApiError(
      ERROR_CODES.bankAccountDefaultRequired,
      'Select a bank account in the document currency before creating this document.',
    );
  }

  private async bankAccountStatus(
    companyProfileId: string | null,
    currencyCode: string,
    selected: BankAccountProfile | null,
  ): Promise<'MATCHED' | 'SELECT_REQUIRED' | 'MISSING'> {
    if (selected) return 'MATCHED';
    if (!companyProfileId) return 'MISSING';
    const count = await this.prisma.bankAccountProfile.count({
      where: { companyProfileId, currencyCode, enabled: true },
    });
    return count > 0 ? 'SELECT_REQUIRED' : 'MISSING';
  }

  private bankAccountSummary(account: BankAccountProfile) {
    const normalized = account.accountNumber.replace(/\s+/g, '');
    return {
      id: account.id,
      label: account.label,
      bankName: account.bankName,
      currencyCode: account.currencyCode,
      bankCountryCode: account.bankCountryCode,
      isDefault: account.isDefault,
      enabled: account.enabled,
      maskedAccountNumber: `****${normalized.slice(-4)}`,
    };
  }

  private paymentSnapshot(account: BankAccountProfile) {
    return {
      schemaVersion: 1,
      label: account.label,
      accountHolder: account.accountHolder,
      bankName: account.bankName,
      bankAddress: account.bankAddress,
      bankCountryCode: account.bankCountryCode,
      accountNumber: account.accountNumber,
      swiftCode: account.swiftCode,
      wireRoutingNumber: account.wireRoutingNumber,
      achRoutingNumber: account.achRoutingNumber,
      currencyCode: account.currencyCode,
    };
  }

  private async resolveTemplateForOrder(
    order: OrderForDocument,
    documentType: CommercialDocumentType,
    locale: string,
    templateVersionId: string | null,
    actorId: string,
    requestId?: string,
  ) {
    if (templateVersionId) {
      return this.templates.resolveVersion(templateVersionId, documentType);
    }
    void order;
    return this.templates.ensureDefaultVersion(documentType, locale, actorId, requestId);
  }

  private async buildFromOrder(
    order: OrderForDocument,
    documentType: CommercialDocumentType,
    config: DocumentTemplateConfig,
    companyProfile: Awaited<ReturnType<CompanyProfilesService['defaultProfile']>>,
    bankAccount: import('@b2b/database').BankAccountProfile | null,
  ): Promise<BuiltDocumentData> {
    const buyer = this.buyerFromOrder(order);
    const consignee = this.consigneeFromOrder(order);
    const notifyParty = (order.notifyPartySnapshot as Record<string, unknown> | null) ?? null;
    const seller = companyProfile
      ? {
          schemaVersion: 1,
          companyName: companyProfile.companyName,
          contactName: companyProfile.contactName,
          phone: companyProfile.phone,
          email: companyProfile.email,
          taxId: companyProfile.taxId,
          address: this.normalizeAddress(companyProfile.address),
          logoAssetId: companyProfile.logoAssetId,
          stampAssetId: companyProfile.stampAssetId,
        }
      : {
          schemaVersion: 1,
          companyName: null,
          contactName: null,
          phone: null,
          email: null,
          taxId: null,
          address: null,
        };
    const payment = bankAccount ? this.paymentSnapshot(bankAccount) : null;
    const trade = this.tradeFromOrder(order);
    const shipping = this.shippingFromOrder(order);
    const items = order.items.map((item, index) => {
      const netWeight =
        item.netWeightPerUnitKgSnapshot && item.quantity
          ? new Decimal(item.netWeightPerUnitKgSnapshot.toString())
              .times(item.quantity.toString())
              .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
              .toString()
          : null;
      return {
        lineNo: item.lineNo || index + 1,
        productId: item.productId,
        sku: item.skuSnapshot,
        description:
          item.customsDescriptionSnapshot || item.descriptionSnapshot || item.productNameSnapshot,
        hsCode: item.hsCodeSnapshot ?? '',
        originCountryCode: item.originCountryCodeSnapshot ?? null,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitSalePriceForeign.toString(),
        discountAmount: '0',
        currency: order.currencyCode,
        cartons: item.cartonCount,
        unitsPerCarton: item.unitsPerCarton,
        netWeightKg: netWeight,
        grossWeightKg: item.totalGrossWeightKg.isZero() ? null : item.totalGrossWeightKg.toString(),
        cbm: item.totalCbm?.toString() ?? null,
        packaging: item.packagingSnapshot,
      };
    });
    const fees = this.feesFromOrder(order);
    const totals = this.calculateTotals(
      order.currencyCode,
      items as unknown as CommercialDocumentItemInput[],
      fees,
    );
    // Merge the server-computed line totals back into the persisted snapshot.
    // The browser never supplies line amounts (docs/41 §10).
    const normalizedItems = items.map((item, index) => ({
      ...item,
      ...totals.normalizedItems[index]!,
    }));
    const uniqueOrigins = Array.from(
      new Set(items.map((item) => item.originCountryCode).filter(Boolean)),
    );
    void config;
    void documentType;
    return {
      seller,
      buyer,
      consignee,
      notifyParty,
      trade,
      shipping,
      payment,
      declaration: {
        schemaVersion: 1,
        countryOfOrigin: uniqueOrigins.length === 1 ? uniqueOrigins[0] : null,
        text: null,
        authenticityText: null,
      },
      signature: {
        schemaVersion: 1,
        sellerName: companyProfile?.companyName ?? null,
        sellerTitle: null,
        stampAssetId: companyProfile?.stampAssetId ?? null,
      },
      items: normalizedItems,
      totals: {
        currency: totals.currency,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        freightAmount: totals.freightAmount,
        insuranceAmount: totals.insuranceAmount,
        otherCharges: totals.otherCharges,
        totalAmount: totals.totalAmount,
      },
    };
  }

  private buyerFromOrder(order: OrderForDocument): Record<string, unknown> {
    const buyerSnapshot = (order.buyerSnapshot as Record<string, unknown> | null) ?? null;
    const customer = (order.customerSnapshot as Record<string, unknown> | null) ?? {};
    const billing =
      order.billingAddressSnapshot ??
      buyerSnapshot?.billingAddress ??
      customer.billingAddress ??
      null;
    return {
      schemaVersion: 1,
      companyName:
        order.buyerCompanyName ??
        (buyerSnapshot?.companyName as string | undefined) ??
        (customer.legalCompanyName as string | undefined) ??
        (customer.companyName as string | undefined) ??
        null,
      contactName:
        order.buyerContactName ??
        (buyerSnapshot?.contactName as string | undefined) ??
        (customer.contactName as string | undefined) ??
        null,
      phone:
        order.buyerPhoneE164 ??
        (buyerSnapshot?.phone as string | undefined) ??
        (customer.phoneE164 as string | undefined) ??
        null,
      email:
        order.buyerEmail ??
        (buyerSnapshot?.email as string | undefined) ??
        (customer.email as string | undefined) ??
        null,
      taxId:
        (buyerSnapshot?.taxId as string | undefined) ??
        (customer.taxId as string | undefined) ??
        null,
      countryCode:
        order.buyerCountryCode ??
        (buyerSnapshot?.countryCode as string | undefined) ??
        (customer.countryCode as string | undefined) ??
        null,
      billingAddress: this.normalizeAddress(billing),
    };
  }

  private consigneeFromOrder(order: OrderForDocument): Record<string, unknown> | null {
    const consignee = (order.consigneeSnapshot as Record<string, unknown> | null) ?? null;
    const shipping = order.shippingAddressSnapshot as Record<string, unknown> | null;
    if (!consignee && !shipping) return null;
    return {
      schemaVersion: 1,
      companyName:
        (consignee?.companyName as string | undefined) ??
        (shipping?.companyName as string | undefined) ??
        null,
      contactName:
        order.consigneeName ??
        (consignee?.contactName as string | undefined) ??
        (shipping?.recipient as string | undefined) ??
        null,
      phone:
        (consignee?.phone as string | undefined) ??
        (shipping?.phoneE164 as string | undefined) ??
        null,
      email: (consignee?.email as string | undefined) ?? null,
      shippingAddress: this.normalizeAddress(
        (consignee?.shippingAddress as Record<string, unknown> | null) ?? shipping,
      ),
    };
  }

  private tradeFromOrder(order: OrderForDocument): Record<string, unknown> {
    const trade = (order.tradeSnapshot as Record<string, unknown> | null) ?? {};
    const rate = new Decimal(order.exchangeRate.toString());
    const exchangeRateText =
      order.currencyCode === 'CNY'
        ? '1 CNY = 1 CNY'
        : `1 CNY = ${rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} ${order.currencyCode}`;
    return {
      schemaVersion: 1,
      incotermCode: (trade.incotermCode as string | undefined) ?? null,
      namedPlace: (trade.namedPlace as string | undefined) ?? null,
      paymentTerms: (trade.paymentTerms as string | undefined) ?? null,
      contractNo: order.contractNo ?? (trade.contractNo as string | undefined) ?? null,
      buyerReference: order.buyerReference ?? (trade.buyerReference as string | undefined) ?? null,
      exchangeRateText: (trade.exchangeRateText as string | undefined) ?? exchangeRateText,
    };
  }

  private shippingFromOrder(order: OrderForDocument): Record<string, unknown> {
    const cartons = order.items.reduce((sum, item) => sum + (item.cartonCount ?? 0), 0);
    const gross = order.items.reduce(
      (sum, item) => sum.plus(item.totalGrossWeightKg),
      new Decimal(0),
    );
    const cbm = order.items.reduce((sum, item) => sum.plus(item.totalCbm ?? 0), new Decimal(0));
    return {
      schemaVersion: 1,
      // The order stores a freight billing basis, not a transport method. Do
      // not invent a shipping method for customs; the operator confirms it.
      method: null,
      portOfLoading: null,
      portOfDischarge: null,
      route: null,
      transitTime: null,
      cartonCount: cartons > 0 ? cartons : null,
      netWeightKg: null,
      grossWeightKg: gross.isZero()
        ? null
        : gross.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString(),
      cbm: cbm.isZero() ? null : cbm.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toString(),
      marks: null,
    };
  }

  private feesFromOrder(order: OrderForDocument) {
    let freight = new Decimal(0);
    let insurance = new Decimal(0);
    let other = new Decimal(0);
    for (const fee of order.fees) {
      const amount = new Decimal(fee.amountForeign.toString());
      if (fee.isFreight) {
        freight = freight.plus(amount);
      } else if (fee.feeTypeCode === 'insurance' || /insurance/i.test(fee.nameSnapshot)) {
        insurance = insurance.plus(amount);
      } else {
        other = other.plus(amount);
      }
    }
    return {
      discountAmount: '0',
      freightAmount: freight.toString(),
      insuranceAmount: insurance.toString(),
      otherCharges: other.toString(),
    };
  }

  private calculateTotals(
    currency: string,
    items: CommercialDocumentItemInput[],
    charges: {
      discountAmount?: string;
      freightAmount?: string;
      insuranceAmount?: string;
      otherCharges?: string;
    },
  ) {
    try {
      const result = calculateDocumentTotals({
        currency,
        items: items.map((item) => ({
          lineNo: item.lineNo,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          currency: item.currency,
        })),
        ...charges,
      });
      return { ...result, normalizedItems: result.items };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Document totals could not be calculated.';
      throw ApiError.validation(message, { totals: 'validation.document.totals' });
    }
  }

  private itemRenderData(item: Record<string, unknown>, index: number) {
    return {
      lineNo: (item.lineNo as number | undefined) ?? index + 1,
      sku: (item.sku as string | undefined) ?? null,
      description: (item.description as string | undefined) ?? null,
      hsCode: (item.hsCode as string | undefined) ?? null,
      originCountryCode: (item.originCountryCode as string | undefined) ?? null,
      quantity: String(item.quantity ?? ''),
      unit: (item.unit as string | undefined) ?? null,
      unitPrice: String(item.unitPrice ?? ''),
      cartons: (item.cartons as number | null | undefined) ?? null,
      netWeightKg: (item.netWeightKg as string | null | undefined) ?? null,
      grossWeightKg: (item.grossWeightKg as string | null | undefined) ?? null,
      cbm: (item.cbm as string | null | undefined) ?? null,
      lineAmount: String(item.lineAmount ?? ''),
    };
  }

  private prefillRenderData(
    order: OrderForDocument,
    documentType: CommercialDocumentType,
    items: CommercialDocumentRenderData['items'],
    totals: DocumentTotals,
    data: {
      seller: Record<string, unknown>;
      buyer: Record<string, unknown>;
      consignee: Record<string, unknown> | null;
      notifyParty: Record<string, unknown> | null;
      trade: Record<string, unknown>;
      shipping: Record<string, unknown>;
      payment: Record<string, unknown> | null;
      declaration: Record<string, unknown>;
      signature: Record<string, unknown>;
    },
  ): CommercialDocumentRenderData {
    return this.renderDataFromParts({
      documentType,
      documentNo: 'PREVIEW',
      revisionNo: 1,
      status: 'DRAFT',
      locale: 'en-US',
      currency: order.currencyCode,
      issueDate: this.todayDateOnly().toISOString().slice(0, 10),
      validUntil: null,
      orderNo: order.orderNo,
      orderDate: order.orderDate.toISOString().slice(0, 10),
      seller: data.seller,
      buyer: data.buyer,
      consignee: data.consignee,
      notifyParty: data.notifyParty,
      trade: data.trade,
      shipping: data.shipping,
      payment: data.payment,
      declaration: data.declaration,
      signature: data.signature,
      items,
      totals,
    });
  }

  private renderData(document: DocumentDetail): CommercialDocumentRenderData {
    return this.renderDataFromParts({
      documentType: document.documentType,
      documentNo: document.documentNo,
      revisionNo: document.revisionNo,
      status: document.status,
      locale: document.locale === 'zh-CN' ? 'zh-CN' : 'en-US',
      currency: document.currency,
      issueDate: document.issueDate?.toISOString().slice(0, 10) ?? null,
      validUntil: document.validUntil?.toISOString().slice(0, 10) ?? null,
      orderNo: document.order?.orderNo ?? null,
      orderDate: document.order?.orderDate.toISOString().slice(0, 10) ?? null,
      seller: (document.sellerSnapshot as Record<string, unknown> | null) ?? {},
      buyer: (document.buyerSnapshot as Record<string, unknown> | null) ?? {},
      consignee: (document.consigneeSnapshot as Record<string, unknown> | null) ?? null,
      notifyParty: (document.notifyPartySnapshot as Record<string, unknown> | null) ?? null,
      trade: (document.tradeSnapshot as Record<string, unknown> | null) ?? {},
      shipping: (document.shippingSnapshot as Record<string, unknown> | null) ?? {},
      payment: (document.paymentSnapshot as Record<string, unknown> | null) ?? null,
      declaration: (document.declarationSnapshot as Record<string, unknown> | null) ?? {},
      signature: (document.signatureSnapshot as Record<string, unknown> | null) ?? {},
      notes: document.notes,
      items: document.items.map((item) => ({
        lineNo: item.lineNo,
        sku: item.skuSnapshot,
        description: item.descriptionSnapshot,
        hsCode: item.hsCodeSnapshot,
        originCountryCode: item.originCountrySnapshot,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        cartons: item.cartons,
        netWeightKg: item.netWeightKg?.toString() ?? null,
        grossWeightKg: item.grossWeightKg?.toString() ?? null,
        cbm: item.cbm?.toString() ?? null,
        lineAmount: item.lineAmount.toString(),
      })),
      totals: {
        currency: document.currency,
        subtotal: document.subtotal.toString(),
        discountAmount: document.discountAmount.toString(),
        freightAmount: document.freightAmount.toString(),
        insuranceAmount: document.insuranceAmount.toString(),
        otherCharges: document.otherCharges.toString(),
        totalAmount: document.totalAmount.toString(),
      },
    });
  }

  private renderDataFromParts(input: {
    documentType: CommercialDocumentType;
    documentNo: string;
    revisionNo: number;
    status: string;
    locale: 'en-US' | 'zh-CN';
    currency: string;
    issueDate: string | null;
    validUntil: string | null;
    orderNo: string | null;
    orderDate: string | null;
    seller: Record<string, unknown>;
    buyer: Record<string, unknown>;
    consignee: Record<string, unknown> | null;
    notifyParty: Record<string, unknown> | null;
    trade: Record<string, unknown>;
    shipping: Record<string, unknown>;
    payment: Record<string, unknown> | null;
    declaration: Record<string, unknown>;
    signature: Record<string, unknown>;
    notes?: string | null;
    items: CommercialDocumentRenderData['items'];
    totals: DocumentTotals;
  }): CommercialDocumentRenderData {
    const trade = input.trade as DocumentTradeSnapshot;
    return {
      documentType: input.documentType,
      documentNo: input.documentNo,
      revisionNo: input.revisionNo,
      status: input.status,
      locale: input.locale,
      currency: input.currency,
      issueDate: input.issueDate,
      validUntil: input.validUntil,
      orderNo: input.orderNo,
      orderDate: input.orderDate,
      contractNo: (trade.contractNo as string | null | undefined) ?? null,
      buyerReference: (trade.buyerReference as string | null | undefined) ?? null,
      exchangeRateText: (trade.exchangeRateText as string | null | undefined) ?? null,
      seller: input.seller as DocumentPartySnapshot,
      buyer: input.buyer as DocumentPartySnapshot,
      consignee: input.consignee as DocumentPartySnapshot | null,
      notifyParty: input.notifyParty as DocumentPartySnapshot | null,
      trade,
      shipping: input.shipping as DocumentShippingSnapshot,
      payment: input.payment as DocumentPaymentSnapshot | null,
      declaration: input.declaration as CommercialDocumentRenderData['declaration'],
      signature: input.signature as CommercialDocumentRenderData['signature'],
      notes: input.notes ?? null,
      items: input.items,
      totals: {
        subtotal: input.totals.subtotal,
        discountAmount: input.totals.discountAmount,
        freightAmount: input.totals.freightAmount,
        insuranceAmount: input.totals.insuranceAmount,
        otherCharges: input.totals.otherCharges,
        totalAmount: input.totals.totalAmount,
      },
    };
  }

  private async renderAssets(data: CommercialDocumentRenderData) {
    const seller = data.seller as Record<string, unknown>;
    const logo = await this.loadAssetDataUri(seller.logoAssetId);
    const stamp = await this.loadAssetDataUri(seller.stampAssetId);
    return { logoDataUri: logo, stampDataUri: stamp };
  }

  private async loadAssetDataUri(assetId: unknown): Promise<string | null> {
    if (typeof assetId !== 'string' || assetId.length === 0) return null;
    try {
      const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
      if (!asset || asset.status !== 'ready') return null;
      const size = Number(asset.sizeBytes);
      if (size <= 0 || size > MAX_ASSET_BYTES) return null;
      const extension = asset.storageKey.split('.').pop()?.toLowerCase() ?? '';
      const mime = ASSET_MIME[extension];
      if (!mime) return null;
      const buffer = await this.storage.get(asset.storageKey);
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (error) {
      this.logger.warn('commercial_document.asset_unavailable', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }

  private dto(document: DocumentDetail) {
    const data = this.renderData(document);
    const config = this.configFromDocument(document);
    const missing = findMissingDocumentFields(data, config);
    const latestJob = document.renderJobs[0] ?? null;
    const calculationMeta = (document.calculationSnapshot as Record<string, unknown> | null) ?? {};
    return {
      id: document.id,
      type: document.documentType,
      documentNo: document.documentNo,
      revisionNo: document.revisionNo,
      status: document.status,
      locale: document.locale,
      currency: document.currency,
      issueDate: document.issueDate?.toISOString().slice(0, 10) ?? null,
      validUntil: document.validUntil?.toISOString().slice(0, 10) ?? null,
      version: document.version,
      orderId: document.orderId,
      orderNo: document.order?.orderNo ?? null,
      companyProfileId:
        typeof calculationMeta.companyProfileId === 'string'
          ? calculationMeta.companyProfileId
          : null,
      bankAccountId:
        typeof calculationMeta.bankAccountId === 'string' ? calculationMeta.bankAccountId : null,
      buyerReference: data.buyerReference,
      contractNo: data.contractNo,
      exchangeRateText: data.exchangeRateText,
      seller: document.sellerSnapshot,
      buyer: document.buyerSnapshot,
      consignee: document.consigneeSnapshot,
      notifyParty: document.notifyPartySnapshot,
      trade: document.tradeSnapshot,
      shipping: document.shippingSnapshot,
      payment: document.paymentSnapshot,
      declaration: document.declarationSnapshot,
      signature: document.signatureSnapshot,
      notes: document.notes,
      items: document.items.map((item) => ({
        id: item.id,
        lineNo: item.lineNo,
        productId: item.productId,
        sku: item.skuSnapshot,
        description: item.descriptionSnapshot,
        hsCode: item.hsCodeSnapshot,
        originCountryCode: item.originCountrySnapshot,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        discountAmount: item.discountAmount.toString(),
        lineAmount: item.lineAmount.toString(),
        currency: item.currency,
        cartons: item.cartons,
        unitsPerCarton: item.unitsPerCarton,
        netWeightKg: item.netWeightKg?.toString() ?? null,
        grossWeightKg: item.grossWeightKg?.toString() ?? null,
        cbm: item.cbm?.toString() ?? null,
        packaging: item.packagingSnapshot,
      })),
      totals: {
        subtotal: document.subtotal.toString(),
        discountAmount: document.discountAmount.toString(),
        freightAmount: document.freightAmount.toString(),
        insuranceAmount: document.insuranceAmount.toString(),
        otherCharges: document.otherCharges.toString(),
        totalAmount: document.totalAmount.toString(),
      },
      template: {
        id: document.template?.id ?? null,
        name: document.template?.name ?? null,
        versionId: document.templateVersionId,
        version: document.templateVersionNo,
        status: document.templateVersion?.status ?? null,
      },
      missingFields: missing.missing,
      missingFieldLabels: missing.missing.map((key) => ({
        key,
        label: defaultFieldLabel(key, document.locale),
      })),
      missingItemLines: missing.missingItemLines,
      pdf: {
        available: Boolean(document.pdfFileKey),
        generatedAt: document.generatedAt?.toISOString() ?? null,
        sha256: document.pdfSha256,
        sizeBytes: document.pdfSizeBytes ? Number(document.pdfSizeBytes) : null,
      },
      renderJob: latestJob ? this.renderJobDto(latestJob) : null,
      issuedAt: document.issuedAt?.toISOString() ?? null,
      issuedById: document.issuedById,
      supersedesId: document.supersedesId,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      config,
    };
  }

  private configFromDocument(
    document: Pick<DocumentDetail, 'templateVersion' | 'template' | 'documentType'>,
  ): DocumentTemplateConfig {
    const raw = document.templateVersion?.config ?? document.template?.draftConfig;
    try {
      return parseTemplateConfig(raw);
    } catch {
      throw new ApiError(
        ERROR_CODES.commercialDocumentTemplateInvalid,
        'The document template configuration is invalid.',
      );
    }
  }

  private renderJobDto(job: {
    id: string;
    status: string;
    attemptId: string;
    errorCode: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }) {
    return {
      id: job.id,
      status: job.status,
      errorCode: job.errorCode,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  private mergeSnapshot(
    current: Prisma.JsonValue | null | undefined,
    patch: object | null | undefined,
  ): Record<string, unknown> | null {
    if (patch === undefined) return (current as Record<string, unknown> | null) ?? null;
    if (patch === null) return null;
    return {
      schemaVersion: 1,
      ...((current as Record<string, unknown> | null) ?? {}),
      ...(patch as Record<string, unknown>),
    };
  }

  private normalizeAddress(value: unknown): DocumentAddressSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const address = value as Record<string, unknown>;
    const text = (field: string) =>
      typeof address[field] === 'string' && address[field] !== ''
        ? (address[field] as string)
        : null;
    const normalized = {
      recipient: text('recipient'),
      companyName: text('companyName'),
      line1: text('line1'),
      line2: text('line2'),
      city: text('city'),
      state: text('state') ?? text('region'),
      postalCode: text('postalCode'),
      countryCode: text('countryCode'),
    };
    return Object.values(normalized).some(Boolean) ? normalized : null;
  }

  private itemCreateData(item: Record<string, unknown>, index: number, currency: string) {
    return {
      lineNo: (item.lineNo as number | undefined) ?? index + 1,
      productId: (item.productId as string | null | undefined) ?? null,
      skuSnapshot: (item.sku as string | undefined) ?? '',
      descriptionSnapshot: (item.description as string | undefined) ?? null,
      hsCodeSnapshot: (item.hsCode as string | undefined) ?? null,
      originCountrySnapshot: (item.originCountryCode as string | undefined) ?? null,
      quantity: String(item.quantity ?? '0'),
      unit: (item.unit as string | undefined) ?? 'pcs',
      unitPrice: String(item.unitPrice ?? '0'),
      discountAmount: String(item.discountAmount ?? '0'),
      lineAmount: String(item.lineAmount ?? '0'),
      currency,
      cartons: (item.cartons as number | null | undefined) ?? null,
      unitsPerCarton: (item.unitsPerCarton as number | null | undefined) ?? null,
      netWeightKg: (item.netWeightKg as string | null | undefined) ?? null,
      grossWeightKg: (item.grossWeightKg as string | null | undefined) ?? null,
      cbm: (item.cbm as string | null | undefined) ?? null,
      packagingSnapshot: (item.packaging ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  }

  private normalizedItemCreateData(
    documentId: string,
    item: CommercialDocumentItemInput,
    index: number,
    currency: string,
    normalized: {
      lineNo: number;
      quantity: string;
      unitPrice: string;
      discountAmount: string;
      lineAmount: string;
    },
  ) {
    return {
      documentId,
      lineNo: normalized.lineNo ?? item.lineNo ?? index + 1,
      productId: item.productId ?? null,
      skuSnapshot: item.sku,
      descriptionSnapshot: item.description ?? null,
      hsCodeSnapshot: item.hsCode || null,
      originCountrySnapshot: item.originCountryCode ?? null,
      quantity: normalized.quantity,
      unit: item.unit,
      unitPrice: normalized.unitPrice,
      discountAmount: normalized.discountAmount,
      lineAmount: normalized.lineAmount,
      currency,
      cartons: item.cartons ?? null,
      unitsPerCarton: item.unitsPerCarton ?? null,
      netWeightKg: item.netWeightKg ?? null,
      grossWeightKg: item.grossWeightKg ?? null,
      cbm: item.cbm ?? null,
      packagingSnapshot: (item.packaging ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  }

  private async generateDocumentNo(documentType: CommercialDocumentType): Promise<string> {
    const date = new Date();
    const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
      const candidate = `${documentType}-${stamp}-${suffix}`;
      const existing = await this.prisma.commercialDocument.findFirst({
        where: { documentNo: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    throw new ApiError(ERROR_CODES.conflict, 'Could not allocate a unique document number.');
  }

  private todayDateOnly(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private parseDateOnly(value: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw ApiError.validation('Invalid date value.');
    }
    return parsed;
  }

  private dateBoundary(value: string, endOfDay: boolean): Date {
    const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw ApiError.validation('Invalid date filter.');
    }
    return parsed;
  }
}
