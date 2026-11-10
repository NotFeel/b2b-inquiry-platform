import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@b2b/database';
import { DICTIONARY_TYPES, ERROR_CODES, QUOTATION_EXPORT_LIMITS } from '@b2b/contracts';
import Decimal from 'decimal.js';
import type {
  QuotationCalculationInput,
  QuotationListQuery,
  OrderListQuery,
  UpdateOrderCustomerSnapshotInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { JsonLogger } from '../../common/logger.service';
import { CategoriesService } from '../categories/categories.service';
import { isManagedProductImageKey } from '../products/product-image-policy';
import { PrismaService } from '../../prisma/prisma.service';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import {
  calculateQuotation,
  QuotationEngineError,
  type QuotationEngineInput,
} from './quotation-engine';
import { detectQuotationImage } from './quotation-image';

interface CategorySnapshotNode {
  id: string;
  parentId: string | null;
  translations: { locale: string; name: string }[];
}

interface ItemProductHistorySnapshot {
  categoryId: string | null;
  categoryLeafNameEn: string | null;
  categoryLocale: 'en-US';
  imageSnapshotStatus: 'READY' | 'NO_IMAGE';
  imageSnapshotAssetId: string | null;
}

interface StagedSnapshotAsset {
  id: string;
  storageKey: string;
}

interface PreparedProductHistorySnapshots {
  byProductId: Map<string, ItemProductHistorySnapshot>;
  stagedAssets: StagedSnapshotAsset[];
}

@Injectable()
export class QuotationOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly categories: CategoriesService,
    private readonly logger: JsonLogger,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async config(locale: string) {
    const rows = await this.prisma.dictionaryType.findMany({
      where: {
        code: {
          in: [
            DICTIONARY_TYPES.currency,
            DICTIONARY_TYPES.volumetricWeightDivisor,
            DICTIONARY_TYPES.quotationFeeType,
            DICTIONARY_TYPES.productPublishStatus,
            DICTIONARY_TYPES.productLifecycle,
          ],
        },
        enabled: true,
      },
      include: {
        items: {
          where: { enabled: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          include: { translations: true },
        },
      },
    });
    const types = new Map(rows.map((row) => [row.code, row]));
    const optionsFor = (typeCode: string) =>
      (types.get(typeCode)?.items ?? []).map((item) => ({
        code: item.code,
        label: this.label(item.translations, locale, item.code),
      }));
    return {
      currencies: (types.get(DICTIONARY_TYPES.currency)?.items ?? []).map((item) => ({
        code: item.code,
        symbol: item.value,
        label: this.label(item.translations, locale, item.code),
      })),
      volumetricDivisors: (types.get(DICTIONARY_TYPES.volumetricWeightDivisor)?.items ?? []).map(
        (item) => ({
          id: item.id,
          code: item.code,
          value: item.value,
          label: this.label(item.translations, locale, item.code),
        }),
      ),
      feeTypes: optionsFor(DICTIONARY_TYPES.quotationFeeType),
      publishStatuses: optionsFor(DICTIONARY_TYPES.productPublishStatus),
      productLifecycles: optionsFor(DICTIONARY_TYPES.productLifecycle),
      roundingMode: 'CEIL_2',
    };
  }

  /**
   * Generates the internal contract number for a formal order.
   *
   * `CT-YYYYMMDD-XXXXXX` (docs/43 §11.5). The date is formatted in the business
   * timezone, not the server timezone, and the random suffix uses Node's
   * cryptographically secure source. Only formal order creation paths call
   * this; quotations and historical orders keep their existing value.
   */
  generateContractNo(orderDate?: Date | string): string {
    const prefix =
      (this.env?.ORDER_CONTRACT_NO_PREFIX ?? process.env.ORDER_CONTRACT_NO_PREFIX ?? 'CT')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 12) || 'CT';
    const timeZone =
      this.env?.ORDER_CONTRACT_NO_TIMEZONE ??
      process.env.ORDER_CONTRACT_NO_TIMEZONE ??
      'Asia/Shanghai';
    // An order date is a calendar date, not an instant. Formatting an ISO date
    // string directly avoids shifting the day for timezones west of UTC.
    const dateOnly =
      typeof orderDate === 'string' ? orderDate.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    let year: string;
    let month: string;
    let day: string;
    if (dateOnly) {
      year = dateOnly[1] ?? '';
      month = dateOnly[2] ?? '';
      day = dateOnly[3] ?? '';
    } else {
      const date =
        orderDate instanceof Date && !Number.isNaN(orderDate.getTime()) ? orderDate : new Date();
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const value = (type: 'year' | 'month' | 'day') =>
        parts.find((part) => part.type === type)?.value ?? '';
      year = value('year');
      month = value('month');
      day = value('day');
    }
    return `${prefix}-${year}${month}${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  /**
   * Runs an order insert with a newly generated contract number. A unique
   * collision regenerates the number a bounded number of times; every other
   * database error is rethrown so it cannot be hidden as a retry.
   */
  private async withContractNoRetry<T>(
    create: (contractNo: string) => Promise<T>,
    orderDate?: Date | string,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await create(this.generateContractNo(orderDate));
      } catch (error) {
        if (!this.isContractNoConflict(error)) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('Could not allocate a unique contract number.');
  }

  private isContractNoConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = (error.meta as { target?: unknown } | undefined)?.target;
    const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return fields.toLowerCase().includes('contractno');
  }

  async products(
    q: string | undefined,
    categoryId: string | undefined,
    canReadCost: boolean,
    locale: string,
    publishStatus?: 'published' | 'unpublished',
  ) {
    const categoryIds = categoryId
      ? await this.categories.resolveAdminCategoryScope(categoryId, true)
      : undefined;
    if (categoryId && !categoryIds) {
      throw ApiError.validation('The selected category does not exist.', {
        categoryId: 'quotation.validation.categoryMissing',
      });
    }
    const products = await this.prisma.product.findMany({
      where: {
        ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
        ...(q
          ? {
              OR: [
                { sku: { contains: q, mode: 'insensitive' } },
                { translations: { some: { locale, name: { contains: q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
        priceCny: { not: null },
        lifecycleStatus: { not: 'DISCONTINUED' },
        publishStatus: publishStatus
          ? publishStatus === 'published'
            ? 'PUBLISHED'
            : 'UNPUBLISHED'
          : { not: 'DRAFT' },
      },
      orderBy: [{ sku: 'asc' }],
      take: 50,
      select: {
        id: true,
        sku: true,
        priceCny: true,
        cartonLengthCm: true,
        cartonWidthCm: true,
        cartonHeightCm: true,
        cartonWeightKg: true,
        cartonQuantity: true,
        publishStatus: true,
        lifecycleStatus: true,
        translations: { where: { locale }, select: { name: true } },
        images: {
          where: { deleteState: 'READY' },
          orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { fileAssetId: true, altText: true },
        },
      },
    });
    return products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.translations[0]?.name ?? product.sku,
      imageUrl: product.images[0]?.fileAssetId
        ? this.storage.adminProductImageUrl(product.images[0].fileAssetId)
        : null,
      imageAlt: product.images[0]?.altText ?? product.translations[0]?.name ?? product.sku,
      publishStatus: product.publishStatus.toLowerCase(),
      lifecycleStatus: product.lifecycleStatus.toLowerCase(),
      costCny: canReadCost ? (product.priceCny?.toString() ?? null) : null,
      packaging: {
        cartonLengthCm: product.cartonLengthCm?.toString() ?? null,
        cartonWidthCm: product.cartonWidthCm?.toString() ?? null,
        cartonHeightCm: product.cartonHeightCm?.toString() ?? null,
        cartonGrossWeightKg: product.cartonWeightKg?.toString() ?? null,
        unitsPerCarton: product.cartonQuantity,
      },
    }));
  }

  async preview(input: QuotationCalculationInput, canReadCost: boolean) {
    const prepared = await this.prepare(input);
    const result = this.calculate(prepared);
    return {
      ...result,
      freight: canReadCost ? result.freight : { ...result.freight, allocationSnapshot: undefined },
      items: result.items.map((item) => ({
        ...item,
        ...(!canReadCost
          ? {
              costCny: undefined,
              markupPercent: undefined,
              allocatedFreightCny: undefined,
              allocatedFreightForeign: undefined,
            }
          : {}),
      })),
    };
  }

  async createQuotation(
    input: QuotationCalculationInput,
    actorId: string,
    requestId: string,
    idempotencyKey: string,
  ) {
    const payloadHash = this.payloadHash(input);
    const existing = await this.prisma.quotation.findUnique({
      where: { createdById_idempotencyKey: { createdById: actorId, idempotencyKey } },
      include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
    });
    if (existing) {
      if (existing.idempotencyPayloadHash !== payloadHash)
        throw ApiError.conflict(
          ERROR_CODES.conflict,
          'Idempotency key was already used for a different request.',
        );
      return this.quotationDto(existing);
    }
    const prepared = await this.prepare(input);
    const result = this.calculate(prepared);
    const customerSnapshot = this.customerSnapshot(input);
    const no = this.number('Q');
    const historySnapshots = await this.snapshotProductHistory(prepared, actorId);
    const quotation = await this.prisma
      .$transaction(async (tx) => {
        const customerId = await this.ensureCustomer(tx, input);
        return tx.quotation.create({
          data: {
            quotationNo: no,
            title: input.title,
            status: 'DRAFT',
            customerId,
            createdById: actorId,
            idempotencyKey,
            idempotencyPayloadHash: payloadHash,
            quotedAt: input.quotedAt ? new Date(input.quotedAt) : new Date(),
            validUntil: input.validUntil ? new Date(input.validUntil) : null,
            currencyCode: input.currencyCode,
            exchangeRate: input.exchangeRate,
            exchangeRateDate: this.date(input.exchangeRateDate),
            exchangeRateEnteredById: actorId,
            ...this.freightFields(prepared, result),
            subtotalCny: result.totals.subtotalCny,
            freightCny: result.totals.freightCny,
            deliveryFeeCny: result.totals.deliveryFeeCny,
            otherFeesCny: result.totals.otherFeesCny,
            totalAmountCny: result.totals.totalAmountCny,
            totalAmountForeignExact: result.totals.totalAmountForeignExact,
            totalAmountForeign: result.totals.totalAmountForeign,
            customerSnapshot: customerSnapshot as Prisma.InputJsonValue,
            calculationSnapshot: { input, result } as unknown as Prisma.InputJsonValue,
            items: {
              create: this.persistableItems(prepared, result, historySnapshots.byProductId),
            },
            fees: {
              create: result.fees.map((fee, lineNo) => ({
                lineNo: lineNo + 1,
                feeTypeCode: fee.typeCode,
                nameSnapshot: fee.name,
                amountCny: fee.amountCny,
                amountForeign: fee.amountForeign,
                isFreight: fee.isFreight,
                notes: null,
              })),
            },
          },
          include: { items: true, fees: true },
        });
      })
      .catch(async (error: unknown) => {
        await this.discardSnapshotAssets(historySnapshots.stagedAssets);
        const concurrent = await this.prisma.quotation.findUnique({
          where: { createdById_idempotencyKey: { createdById: actorId, idempotencyKey } },
          include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
        });
        if (!concurrent) throw error;
        if (concurrent.idempotencyPayloadHash !== payloadHash)
          throw ApiError.conflict(
            ERROR_CODES.conflict,
            'Idempotency key was already used for a different request.',
          );
        return concurrent;
      });
    await this.audit.record({
      actorId,
      action: 'quotation.created',
      entityType: 'Quotation',
      entityId: quotation.id,
      requestId,
      metadata: { quotationNo: quotation.quotationNo, itemCount: quotation.items.length },
    });
    return this.quotationDto(quotation);
  }

  async createOrder(
    input: QuotationCalculationInput,
    actorId: string,
    requestId: string,
    idempotencyKey: string,
  ) {
    const payloadHash = this.payloadHash(input);
    const existing = await this.prisma.order.findUnique({
      where: { createdById_idempotencyKey: { createdById: actorId, idempotencyKey } },
      include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
    });
    if (existing) {
      if (existing.idempotencyPayloadHash !== payloadHash)
        throw ApiError.conflict(
          ERROR_CODES.conflict,
          'Idempotency key was already used for a different request.',
        );
      return this.orderDto(existing);
    }
    this.assertOrderCustomer(input);
    const prepared = await this.prepare(input);
    const result = this.calculate(prepared);
    const historySnapshots = await this.snapshotProductHistory(prepared, actorId);
    const order = await this.withContractNoRetry(
      (contractNo) =>
        this.prisma
          .$transaction(async (tx) => {
            const customerId = await this.ensureCustomer(tx, input);
            return tx.order.create({
              data: {
                orderNo: this.number('O'),
                status: 'CONFIRMED',
                customerId,
                createdById: actorId,
                idempotencyKey,
                idempotencyPayloadHash: payloadHash,
                orderDate: this.date(input.orderDate!),
                confirmedAt: new Date(),
                currencyCode: input.currencyCode,
                exchangeRate: input.exchangeRate,
                exchangeRateDate: this.date(input.exchangeRateDate),
                ...this.freightFields(prepared, result),
                subtotalCny: result.totals.subtotalCny,
                freightCny: result.totals.freightCny,
                deliveryFeeCny: result.totals.deliveryFeeCny,
                otherFeesCny: result.totals.otherFeesCny,
                totalAmountCny: result.totals.totalAmountCny,
                totalAmountForeignExact: result.totals.totalAmountForeignExact,
                totalAmountForeign: result.totals.totalAmountForeign,
                version: 1,
                buyerReference: input.buyerReference || null,
                contractNo,
                buyerCompanyName:
                  input.customer.legalCompanyName || input.customer.companyName || null,
                buyerContactName: input.customer.contactName || null,
                buyerEmail: input.customer.email ?? null,
                buyerPhoneE164: input.customer.phoneE164 || null,
                buyerCountryCode: input.customer.countryCode ?? null,
                consigneeName: input.customer.shippingAddress?.recipient ?? null,
                consigneeCountryCode: input.customer.shippingAddress?.countryCode ?? null,
                buyerSnapshot: this.buyerSnapshot(input) as Prisma.InputJsonValue,
                consigneeSnapshot: this.consigneeSnapshot(input) as Prisma.InputJsonValue,
                tradeSnapshot: this.tradeSnapshot(input, contractNo) as Prisma.InputJsonValue,
                customerSnapshot: this.customerSnapshot(input, contractNo) as Prisma.InputJsonValue,
                billingAddressSnapshot: input.customer.billingAddress as
                  Prisma.InputJsonValue | undefined,
                shippingAddressSnapshot: input.customer.shippingAddress as Prisma.InputJsonValue,
                calculationSnapshot: { input, result } as unknown as Prisma.InputJsonValue,
                items: {
                  create: this.persistableItems(prepared, result, historySnapshots.byProductId),
                },
                fees: {
                  create: result.fees.map((fee, lineNo) => ({
                    lineNo: lineNo + 1,
                    feeTypeCode: fee.typeCode,
                    nameSnapshot: fee.name,
                    amountCny: fee.amountCny,
                    amountForeign: fee.amountForeign,
                    isFreight: fee.isFreight,
                    notes: null,
                  })),
                },
              },
              include: { items: true, fees: true },
            });
          })
          .catch(async (error: unknown) => {
            // A contract-number collision is retried with a new number; keep the
            // staged image assets for that attempt.
            if (this.isContractNoConflict(error)) throw error;
            await this.discardSnapshotAssets(historySnapshots.stagedAssets);
            const concurrent = await this.prisma.order.findUnique({
              where: { createdById_idempotencyKey: { createdById: actorId, idempotencyKey } },
              include: {
                items: { orderBy: { lineNo: 'asc' } },
                fees: { orderBy: { lineNo: 'asc' } },
              },
            });
            if (!concurrent) throw error;
            if (concurrent.idempotencyPayloadHash !== payloadHash)
              throw ApiError.conflict(
                ERROR_CODES.conflict,
                'Idempotency key was already used for a different request.',
              );
            return concurrent;
          }),
      input.orderDate ?? undefined,
    ).catch(async (error: unknown) => {
      // Exhausted contract-number retries must not leave staged image assets
      // without an order.
      if (this.isContractNoConflict(error)) {
        await this.discardSnapshotAssets(historySnapshots.stagedAssets);
      }
      throw error;
    });
    await this.audit.record({
      actorId,
      action: 'order.created',
      entityType: 'Order',
      entityId: order.id,
      requestId,
      metadata: {
        orderNo: order.orderNo,
        itemCount: order.items.length,
        totalAmountCny: result.totals.totalAmountCny,
      },
    });
    return this.orderDto(order);
  }

  async listQuotations(query: QuotationListQuery) {
    const where: Prisma.QuotationWhereInput = {
      // The quotation centre is a working queue for actionable drafts. A
      // converted quotation remains linked to its immutable order for history,
      // but it is no longer a draft and must not stay in this list.
      status: query.status ?? 'DRAFT',
      ...(query.q
        ? {
            OR: [
              { quotationNo: { contains: query.q, mode: 'insensitive' } },
              { title: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.quotation.count({ where }),
      this.prisma.quotation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { quotationNo: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((row) => this.quotationDto(row, false)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async quotationDetail(id: string) {
    const row = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) throw ApiError.notFound('Quotation not found.');
    return this.quotationDto(row);
  }

  async quotationEditData(id: string) {
    const row = await this.prisma.quotation.findUnique({
      where: { id },
      select: {
        id: true,
        quotationNo: true,
        title: true,
        revision: true,
        status: true,
        calculationSnapshot: true,
      },
    });
    if (!row) throw ApiError.notFound('Quotation not found.');
    if (row.status !== 'DRAFT') {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Only draft quotations can be edited.');
    }
    const snapshot = row.calculationSnapshot as { input?: unknown } | null;
    const input = snapshot?.input as QuotationCalculationInput | undefined;
    if (!input || !Array.isArray(input.items)) {
      throw ApiError.validation('This quotation cannot be loaded into the calculator.');
    }
    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        lifecycleStatus: { not: 'DISCONTINUED' },
        priceCny: { not: null },
      },
      orderBy: [{ sku: 'asc' }],
      select: {
        id: true,
        sku: true,
        priceCny: true,
        cartonLengthCm: true,
        cartonWidthCm: true,
        cartonHeightCm: true,
        cartonWeightKg: true,
        cartonQuantity: true,
        publishStatus: true,
        lifecycleStatus: true,
        translations: { where: { locale: 'en-US' }, select: { name: true } },
        images: {
          where: { deleteState: 'READY' },
          orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { fileAssetId: true, altText: true },
        },
      },
    });
    if (products.length !== productIds.length) {
      throw ApiError.conflict(
        ERROR_CODES.conflict,
        'One or more products in this quotation are no longer editable. Delete the stale draft and create a new one.',
      );
    }
    return {
      quotation: {
        id: row.id,
        quotationNo: row.quotationNo,
        title: row.title,
        revision: row.revision,
      },
      calculation: input,
      products: products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.translations[0]?.name ?? product.sku,
        imageUrl: product.images[0]?.fileAssetId
          ? this.storage.adminProductImageUrl(product.images[0].fileAssetId)
          : null,
        imageAlt: product.images[0]?.altText ?? product.translations[0]?.name ?? product.sku,
        publishStatus: product.publishStatus.toLowerCase(),
        lifecycleStatus: product.lifecycleStatus.toLowerCase(),
        costCny: product.priceCny?.toString() ?? null,
        packaging: {
          cartonLengthCm: product.cartonLengthCm?.toString() ?? null,
          cartonWidthCm: product.cartonWidthCm?.toString() ?? null,
          cartonHeightCm: product.cartonHeightCm?.toString() ?? null,
          cartonGrossWeightKg: product.cartonWeightKg?.toString() ?? null,
          unitsPerCarton: product.cartonQuantity,
        },
      })),
    };
  }

  async updateQuotation(
    id: string,
    input: QuotationCalculationInput,
    actorId: string,
    requestId: string,
  ) {
    const existing = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw ApiError.notFound('Quotation not found.');
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Only draft quotations can be edited.');
    }
    const previousAssets = await this.quotationSnapshotAssets(existing.items);
    const prepared = await this.prepare(input);
    const result = this.calculate(prepared);
    const customerSnapshot = this.customerSnapshot(input);
    const historySnapshots = await this.snapshotProductHistory(prepared, actorId);

    let quotation: Prisma.QuotationGetPayload<{
      include: { items: true; fees: true };
    }>;
    try {
      quotation = await this.prisma.$transaction(async (tx) => {
        const current = await tx.quotation.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!current) throw ApiError.notFound('Quotation not found.');
        if (current.status !== 'DRAFT') {
          throw ApiError.conflict(ERROR_CODES.conflict, 'Only draft quotations can be edited.');
        }

        const customerId = await this.ensureCustomer(tx, input);
        // Replace the persisted snapshot atomically so a failed edit cannot
        // leave a mix of old and new line items.
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
        await tx.quotationFee.deleteMany({ where: { quotationId: id } });
        return tx.quotation.update({
          // Repeat the draft guard in the write so a concurrent conversion
          // cannot turn this response into a later revision of a formal
          // order's source quotation.
          where: { id, status: 'DRAFT' },
          data: {
            title: input.title,
            customerId,
            quotedAt: input.quotedAt ? new Date(input.quotedAt) : new Date(),
            validUntil: input.validUntil ? new Date(input.validUntil) : null,
            currencyCode: input.currencyCode,
            exchangeRate: input.exchangeRate,
            exchangeRateDate: this.date(input.exchangeRateDate),
            exchangeRateEnteredById: actorId,
            ...this.freightFields(prepared, result),
            subtotalCny: result.totals.subtotalCny,
            freightCny: result.totals.freightCny,
            deliveryFeeCny: result.totals.deliveryFeeCny,
            otherFeesCny: result.totals.otherFeesCny,
            totalAmountCny: result.totals.totalAmountCny,
            totalAmountForeignExact: result.totals.totalAmountForeignExact,
            totalAmountForeign: result.totals.totalAmountForeign,
            customerSnapshot: customerSnapshot as Prisma.InputJsonValue,
            calculationSnapshot: { input, result } as unknown as Prisma.InputJsonValue,
            revision: { increment: 1 },
            items: {
              create: this.persistableItems(prepared, result, historySnapshots.byProductId),
            },
            fees: {
              create: result.fees.map((fee, lineNo) => ({
                lineNo: lineNo + 1,
                feeTypeCode: fee.typeCode,
                nameSnapshot: fee.name,
                amountCny: fee.amountCny,
                amountForeign: fee.amountForeign,
                isFreight: fee.isFreight,
                notes: null,
              })),
            },
          },
          include: { items: true, fees: true },
        });
      });
    } catch (error) {
      await this.discardSnapshotAssets(historySnapshots.stagedAssets);
      throw error;
    }

    await this.discardSnapshotAssets(previousAssets);
    await this.audit.record({
      actorId,
      action: 'quotation.updated',
      entityType: 'Quotation',
      entityId: id,
      requestId,
      metadata: {
        quotationNo: quotation.quotationNo,
        revision: quotation.revision,
        itemCount: quotation.items.length,
      },
    });
    return this.quotationDto(quotation);
  }

  async deleteQuotation(id: string, actorId: string, requestId: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!quotation) throw ApiError.notFound('Quotation not found.');
    if (quotation.status !== 'DRAFT') {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Only draft quotations can be deleted.');
    }
    const linkedOrder = await this.prisma.order.findUnique({
      where: { sourceQuotationId: id },
      select: { id: true },
    });
    if (linkedOrder) {
      throw ApiError.conflict(
        ERROR_CODES.conflict,
        'A quotation linked to a formal order cannot be deleted.',
      );
    }
    const snapshotAssets = await this.quotationSnapshotAssets(quotation.items);
    await this.prisma.quotation.delete({ where: { id } });
    await this.discardSnapshotAssets(snapshotAssets);
    await this.audit.record({
      actorId,
      action: 'quotation.deleted',
      entityType: 'Quotation',
      entityId: id,
      requestId,
      metadata: { quotationNo: quotation.quotationNo, itemCount: quotation.items.length },
    });
    return { id, deleted: true as const };
  }

  async convertQuotation(id: string, actorId: string, requestId: string) {
    const existingOrder = await this.prisma.order.findUnique({
      where: { sourceQuotationId: id },
      include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
    });
    if (existingOrder) return this.orderDto(existingOrder);
    // Read the persisted quotation date before opening the write transaction so
    // the generated contract number uses the same business date. The value is
    // immutable for a quotation revision; the transaction still re-reads the
    // row and re-checks its status.
    const dateSource = await this.prisma.quotation.findUnique({
      where: { id },
      select: { calculationSnapshot: true },
    });
    if (!dateSource) throw ApiError.notFound('Quotation not found.');
    const dateInput = (dateSource.calculationSnapshot as { input: QuotationCalculationInput })
      .input;
    const order = await this.withContractNoRetry(
      (contractNo) =>
        this.prisma
          .$transaction(async (tx) => {
            const quotation = await tx.quotation.findUnique({
              where: { id },
              include: {
                items: { orderBy: { lineNo: 'asc' } },
                fees: { orderBy: { lineNo: 'asc' } },
              },
            });
            if (!quotation) throw ApiError.notFound('Quotation not found.');
            if (quotation.status !== 'DRAFT')
              throw ApiError.conflict(ERROR_CODES.conflict, 'Quotation is not a draft.');
            const input = (quotation.calculationSnapshot as { input: QuotationCalculationInput })
              .input;
            this.assertOrderCustomer(input);
            if (
              quotation.items.some(
                (item) =>
                  !item.cartonCount ||
                  !item.cartonGrossWeightKg ||
                  item.cartonGrossWeightKg.isZero() ||
                  !item.cartonLengthCm ||
                  !item.cartonWidthCm ||
                  !item.cartonHeightCm,
              )
            ) {
              throw ApiError.validation(
                'Complete packaging data is required before converting this quotation to an order.',
              );
            }
            if (
              !quotation.freightBillingMethod ||
              !quotation.freightCurrencyCode ||
              !quotation.cbmRatePerCbm ||
              !quotation.kgRatePerKg ||
              !quotation.volumetricDivisorItemId ||
              !quotation.volumetricDivisorCode ||
              !quotation.volumetricDivisorValue
            ) {
              throw ApiError.conflict(
                ERROR_CODES.conflict,
                'This quotation uses an older freight calculation. Recalculate and save a new quotation before converting it.',
              );
            }
            const created = await tx.order.create({
              data: {
                orderNo: this.number('O'),
                status: 'CONFIRMED',
                sourceQuotationId: quotation.id,
                sourceQuotationRevision: quotation.revision,
                customerId: quotation.customerId,
                createdById: actorId,
                orderDate: this.date(input.orderDate!),
                confirmedAt: new Date(),
                currencyCode: quotation.currencyCode,
                exchangeRate: quotation.exchangeRate,
                exchangeRateDate: quotation.exchangeRateDate,
                freightBillingMethod: quotation.freightBillingMethod,
                freightCurrencyCode: quotation.freightCurrencyCode,
                cbmRatePerCbm: quotation.cbmRatePerCbm,
                orderTotalCbm: quotation.orderTotalCbm,
                cbmFreightAmount: quotation.cbmFreightAmount,
                kgRatePerKg: quotation.kgRatePerKg,
                volumetricDivisorItemId: quotation.volumetricDivisorItemId,
                volumetricDivisorCode: quotation.volumetricDivisorCode,
                volumetricDivisorValue: quotation.volumetricDivisorValue,
                orderTotalVolumeWeightKg: quotation.orderTotalVolumeWeightKg,
                orderTotalGrossWeightKg: quotation.orderTotalGrossWeightKg,
                chargeableWeightKg: quotation.chargeableWeightKg,
                kgChargeableBasis: quotation.kgChargeableBasis,
                kgFreightAmount: quotation.kgFreightAmount,
                selectedFreightAmount: quotation.selectedFreightAmount,
                freightAllocationSnapshot:
                  quotation.freightAllocationSnapshot as Prisma.InputJsonValue,
                subtotalCny: quotation.subtotalCny,
                freightCny: quotation.freightCny,
                deliveryFeeCny: quotation.deliveryFeeCny,
                otherFeesCny: quotation.otherFeesCny,
                totalAmountCny: quotation.totalAmountCny,
                totalAmountForeignExact: quotation.totalAmountForeignExact,
                totalAmountForeign: quotation.totalAmountForeign,
                version: 1,
                buyerReference: input.buyerReference || null,
                contractNo,
                buyerCompanyName:
                  input.customer.legalCompanyName || input.customer.companyName || null,
                buyerContactName: input.customer.contactName || null,
                buyerEmail: input.customer.email ?? null,
                buyerPhoneE164: input.customer.phoneE164 || null,
                buyerCountryCode: input.customer.countryCode ?? null,
                consigneeName: input.customer.shippingAddress?.recipient ?? null,
                consigneeCountryCode: input.customer.shippingAddress?.countryCode ?? null,
                buyerSnapshot: this.buyerSnapshot(input) as Prisma.InputJsonValue,
                consigneeSnapshot: this.consigneeSnapshot(input) as Prisma.InputJsonValue,
                tradeSnapshot: this.tradeSnapshot(input, contractNo) as Prisma.InputJsonValue,
                customerSnapshot: {
                  ...((quotation.customerSnapshot as Record<string, unknown> | null) ?? {}),
                  contractNo,
                } as Prisma.InputJsonValue,
                billingAddressSnapshot: input.customer.billingAddress as
                  Prisma.InputJsonValue | undefined,
                shippingAddressSnapshot: input.customer.shippingAddress as Prisma.InputJsonValue,
                calculationSnapshot: quotation.calculationSnapshot as Prisma.InputJsonValue,
                items: { create: quotation.items.map((item) => this.copyItem(item)) },
                fees: {
                  create: quotation.fees.map((fee) => ({
                    lineNo: fee.lineNo,
                    feeTypeCode: fee.feeTypeCode,
                    nameSnapshot: fee.nameSnapshot,
                    amountCny: fee.amountCny,
                    amountForeign: fee.amountForeign,
                    isFreight: fee.isFreight,
                    notes: fee.notes,
                  })),
                },
              },
              include: { items: true, fees: true },
            });
            await tx.quotation.update({
              where: { id: quotation.id, status: 'DRAFT' },
              data: { status: 'CONVERTED', convertedAt: new Date() },
            });
            return created;
          })
          .catch(async (error: unknown) => {
            // `sourceQuotationId` is unique. If two conversion requests race, the
            // loser returns the winner's persisted order instead of duplicating it.
            const concurrentOrder = await this.prisma.order.findUnique({
              where: { sourceQuotationId: id },
              include: {
                items: { orderBy: { lineNo: 'asc' } },
                fees: { orderBy: { lineNo: 'asc' } },
              },
            });
            if (concurrentOrder) return concurrentOrder;
            throw error;
          }),
      dateInput.orderDate ?? undefined,
    );
    await this.audit.record({
      actorId,
      action: 'quotation.converted_to_order',
      entityType: 'Quotation',
      entityId: id,
      requestId,
      metadata: { orderNo: order.orderNo },
    });
    return this.orderDto(order);
  }

  /**
   * List filters may only use enabled dictionary options. The UI already uses
   * the same option sets, but a crafted query must not silently produce an
   * empty result for a code that does not exist (docs/43 R2-1).
   */
  private async assertReferenceCode(typeCode: 'country' | 'currency', code?: string) {
    if (!code) return;
    const item = await this.prisma.dictionaryItem.findFirst({
      where: { code, enabled: true, type: { code: typeCode, enabled: true } },
      select: { id: true },
    });
    if (!item) {
      throw ApiError.validation(`Unknown ${typeCode} option.`, {
        code: 'validation.reference.invalid',
      });
    }
  }

  async listOrders(query: OrderListQuery) {
    await this.assertReferenceCode('country', query.country);
    await this.assertReferenceCode('currency', query.currency);
    const documentWhere = (type: 'PI' | 'CI') => {
      const flag = type === 'PI' ? query.hasPi : query.hasCi;
      if (flag === undefined) return undefined;
      const filter = { documentType: type, status: { not: 'CANCELLED' as const } };
      return flag === 'true' ? { some: filter } : { none: filter };
    };
    const and: Prisma.OrderWhereInput[] = [];
    if (query.q) {
      and.push({
        OR: [
          { orderNo: { contains: query.q, mode: 'insensitive' } },
          { buyerCompanyName: { contains: query.q, mode: 'insensitive' } },
          { buyerContactName: { contains: query.q, mode: 'insensitive' } },
          { buyerEmail: { contains: query.q, mode: 'insensitive' } },
          { buyerPhoneE164: { contains: query.q } },
        ],
      });
    }
    if (query.from || query.to) {
      const range: Prisma.DateTimeFilter = {};
      if (query.from) {
        const from = new Date(`${query.from}T00:00:00.000Z`);
        if (Number.isNaN(from.getTime())) {
          throw ApiError.validation('The order date range start is invalid.');
        }
        range.gte = from;
      }
      if (query.to) {
        const to = new Date(`${query.to}T23:59:59.999Z`);
        if (Number.isNaN(to.getTime())) {
          throw ApiError.validation('The order date range end is invalid.');
        }
        range.lte = to;
      }
      and.push({ orderDate: range });
    }
    const pi = documentWhere('PI');
    if (pi) and.push({ commercialDocuments: pi });
    const ci = documentWhere('CI');
    if (ci) and.push({ commercialDocuments: ci });

    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currencyCode: query.currency } : {}),
      ...(query.country ? { buyerCountryCode: query.country } : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };
    const orderBy: Prisma.OrderOrderByWithRelationInput[] = [
      { createdAt: query.sortOrder },
      { orderNo: query.sortOrder },
    ];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          orderNo: true,
          status: true,
          currencyCode: true,
          totalAmountCny: true,
          totalAmountForeign: true,
          orderDate: true,
          customerSnapshot: true,
          buyerCompanyName: true,
          buyerContactName: true,
          buyerCountryCode: true,
          version: true,
          updatedAt: true,
        },
      }),
    ]);
    const ids = rows.map((row) => row.id);
    const [documents, itemSummaries] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.commercialDocument.findMany({
              where: { orderId: { in: ids }, status: { not: 'CANCELLED' } },
              orderBy: [{ createdAt: 'desc' }],
              select: {
                id: true,
                orderId: true,
                documentType: true,
                documentNo: true,
                revisionNo: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                issuedAt: true,
                totalAmount: true,
                currency: true,
                pdfFileKey: true,
              },
            }),
            this.prisma.orderItem.groupBy({
              by: ['orderId'],
              where: { orderId: { in: ids } },
              _count: { _all: true },
              _sum: { quantity: true, cartonCount: true },
            }),
          ]);
    const documentsByOrder = new Map<string, typeof documents>();
    for (const document of documents) {
      if (!document.orderId) continue;
      const existing = documentsByOrder.get(document.orderId) ?? [];
      existing.push(document);
      documentsByOrder.set(document.orderId, existing);
    }
    const itemSummaryByOrder = new Map(
      itemSummaries.map((summary) => [summary.orderId, summary] as const),
    );
    const documentSummary = (document: (typeof documents)[number] | null) =>
      document
        ? {
            id: document.id,
            type: document.documentType,
            documentNo: document.documentNo,
            revisionNo: document.revisionNo,
            status: document.status,
            totalAmount: document.totalAmount.toString(),
            currency: document.currency,
            hasPdf: Boolean(document.pdfFileKey),
            createdAt: document.createdAt.toISOString(),
            updatedAt: document.updatedAt.toISOString(),
            issuedAt: document.issuedAt?.toISOString() ?? null,
          }
        : null;
    // "Current" is resolved on the server: highest revision per document type,
    // with creation time only as the tie-breaker between separate document
    // series. The client never guesses from a sorted created-at list.
    const currentByType = (related: typeof documents, type: 'PI' | 'CI') => {
      const series = new Map<string, typeof documents>();
      for (const document of related) {
        if (document.documentType !== type) continue;
        const existing = series.get(document.documentNo) ?? [];
        existing.push(document);
        series.set(document.documentNo, existing);
      }
      const candidates = [...series.values()].map(
        (documentsInSeries) =>
          [...documentsInSeries].sort(
            (left, right) =>
              right.revisionNo - left.revisionNo ||
              right.createdAt.getTime() - left.createdAt.getTime(),
          )[0]!,
      );
      // Revisions are compared only inside one documentNo series. Separate
      // series are ordered by the creation time of their latest revision.
      return (
        candidates.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ??
        null
      );
    };
    return {
      data: rows.map((row) => {
        const related = documentsByOrder.get(row.id) ?? [];
        const piCount = related.filter((document) => document.documentType === 'PI').length;
        const ciCount = related.filter((document) => document.documentType === 'CI').length;
        const latest = related[0] ?? null;
        const items = itemSummaryByOrder.get(row.id);
        return {
          ...this.orderDto(row, false),
          buyer: this.orderBuyer(row),
          updatedAt: row.updatedAt.toISOString(),
          itemSummary: {
            lineCount: items?._count._all ?? 0,
            totalQuantity: items?._sum.quantity?.toString() ?? '0',
            totalCartons: items?._sum.cartonCount ?? 0,
          },
          documents: {
            piCount,
            ciCount,
            latest: documentSummary(latest),
            pi: documentSummary(currentByType(related, 'PI')),
            ci: documentSummary(currentByType(related, 'CI')),
          },
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

  async orderDetail(id: string) {
    const [row, documents, auditTrail] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id },
        include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
      }),
      this.prisma.commercialDocument.findMany({
        where: { orderId: id },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          documentType: true,
          documentNo: true,
          revisionNo: true,
          status: true,
          currency: true,
          totalAmount: true,
          issueDate: true,
          issuedAt: true,
          supersedesId: true,
          templateVersionNo: true,
          pdfFileKey: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'Order', entityId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { actor: { select: { displayName: true } } },
      }),
    ]);
    if (!row) throw ApiError.notFound('Order not found.');
    return {
      ...this.orderDto(row, true),
      buyer: this.orderBuyer(row),
      documents: documents.map((document) => ({
        id: document.id,
        type: document.documentType,
        documentNo: document.documentNo,
        revisionNo: document.revisionNo,
        status: document.status,
        currency: document.currency,
        totalAmount: document.totalAmount.toString(),
        issueDate: document.issueDate?.toISOString().slice(0, 10) ?? null,
        issuedAt: document.issuedAt?.toISOString() ?? null,
        supersedesId: document.supersedesId,
        templateVersion: document.templateVersionNo,
        hasPdf: Boolean(document.pdfFileKey),
        createdAt: document.createdAt.toISOString(),
      })),
      auditTrail: auditTrail.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actor: entry.actor?.displayName ?? null,
        createdAt: entry.createdAt.toISOString(),
        metadata: entry.metadata,
      })),
    };
  }

  /**
   * Corrects only the customer/consignee snapshot of one order. Prices, items,
   * fees and totals are untouched; the version column is an optimistic lock so
   * two administrators cannot silently overwrite each other (docs/41 §4.3).
   */
  async updateOrderCustomerSnapshot(
    id: string,
    input: UpdateOrderCustomerSnapshotInput,
    actorId: string,
    requestId: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw ApiError.notFound('Order not found.');
    if (order.status === 'CANCELLED') {
      throw new ApiError(
        ERROR_CODES.orderSnapshotUpdateForbidden,
        'A cancelled order cannot be corrected. Reopen the order first.',
      );
    }
    const buyer = this.partySnapshot(input.buyer);
    const consignee = this.partySnapshot(input.consignee);
    const existingTrade = (order.tradeSnapshot as Record<string, unknown> | null) ?? {};
    // A few historical orders only carry the number inside tradeSnapshot; keep
    // that value when the dedicated column is still empty.
    const persistedContractNo =
      order.contractNo ??
      (typeof existingTrade.contractNo === 'string' ? existingTrade.contractNo : null);
    const trade = {
      ...existingTrade,
      schemaVersion: 1,
      ...(input.trade
        ? {
            incotermCode: input.trade.incotermCode ?? null,
            namedPlace: input.trade.namedPlace ?? null,
            paymentTerms: input.trade.paymentTerms ?? null,
          }
        : {}),
      // Contract numbers are system-owned. The correction endpoint accepts the
      // field for backward compatibility but always preserves the persisted
      // value (docs/43 §11.5).
      contractNo: persistedContractNo,
      buyerReference: input.buyerReference ?? null,
    };
    const updated = await this.prisma.order.updateMany({
      where: { id, version: input.version },
      data: {
        version: { increment: 1 },
        buyerSnapshot: buyer as Prisma.InputJsonValue,
        consigneeSnapshot: consignee as Prisma.InputJsonValue,
        notifyPartySnapshot:
          input.notifyParty === null
            ? Prisma.DbNull
            : input.notifyParty
              ? (this.partySnapshot(input.notifyParty) as Prisma.InputJsonValue)
              : undefined,
        tradeSnapshot: trade as Prisma.InputJsonValue,
        buyerReference: input.buyerReference ?? null,
        buyerCompanyName: buyer.companyName,
        buyerContactName: buyer.contactName,
        buyerEmail: buyer.email,
        buyerPhoneE164: buyer.phone,
        buyerCountryCode: buyer.countryCode,
        consigneeName: consignee.contactName ?? consignee.companyName,
        consigneeCountryCode: consignee.shippingAddress?.countryCode ?? null,
        customerSnapshot: {
          ...((order.customerSnapshot as Record<string, unknown> | null) ?? {}),
          schemaVersion: 1,
          companyName: buyer.companyName,
          legalCompanyName: buyer.companyName,
          contactName: buyer.contactName,
          phoneE164: buyer.phone,
          email: buyer.email,
          countryCode: buyer.countryCode,
          taxId: buyer.taxId,
          billingAddress: buyer.billingAddress,
          shippingAddress: consignee.shippingAddress,
          buyerReference: input.buyerReference ?? null,
          contractNo: persistedContractNo,
        } as Prisma.InputJsonValue,
        billingAddressSnapshot: (buyer.billingAddress ?? undefined) as
          Prisma.InputJsonValue | undefined,
        shippingAddressSnapshot: (consignee.shippingAddress ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
    if (updated.count !== 1) {
      const current = await this.prisma.order.findUnique({
        where: { id },
        select: { version: true },
      });
      if (!current) throw ApiError.notFound('Order not found.');
      throw new ApiError(
        ERROR_CODES.orderConcurrentUpdate,
        'The order was changed by another session. Reload and try again.',
        { status: 409, details: { currentVersion: current.version } },
      );
    }
    const changedFields: string[] = [];
    if (JSON.stringify(order.buyerSnapshot) !== JSON.stringify(buyer)) {
      changedFields.push('buyerSnapshot');
    }
    if (JSON.stringify(order.consigneeSnapshot) !== JSON.stringify(consignee)) {
      changedFields.push('consigneeSnapshot');
    }
    if ((order.buyerReference ?? null) !== (input.buyerReference ?? null)) {
      changedFields.push('buyerReference');
    }
    if (input.trade) changedFields.push('tradeSnapshot');
    if (input.notifyParty) changedFields.push('notifyPartySnapshot');
    await this.audit.record({
      actorId,
      action: 'order.customer_snapshot.updated',
      entityType: 'Order',
      entityId: id,
      requestId,
      // Only field names: no phone, address, tax id or email content in logs.
      metadata: { orderNo: order.orderNo, changedFields },
    });
    return this.orderDetail(id);
  }

  /** Explicitly copies the corrected order snapshot into the customer master. */
  async syncOrderCustomerProfile(
    id: string,
    input: { version: number },
    actorId: string,
    requestId: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw ApiError.notFound('Order not found.');
    if (order.version !== input.version) {
      throw new ApiError(
        ERROR_CODES.orderConcurrentUpdate,
        'The order was changed by another session. Reload and try again.',
        { status: 409, details: { currentVersion: order.version } },
      );
    }
    if (!order.customerId) {
      throw ApiError.validation('This order is not linked to a customer profile.');
    }
    const buyer = (order.buyerSnapshot ?? {}) as Record<string, unknown>;
    const consignee = (order.consigneeSnapshot ?? {}) as Record<string, unknown>;
    const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId } });
    if (!customer) throw ApiError.notFound('Customer profile not found.');
    const billing = buyer.billingAddress as Record<string, unknown> | null | undefined;
    const shipping = consignee.shippingAddress as Record<string, unknown> | null | undefined;
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        displayName:
          (typeof buyer.companyName === 'string' && buyer.companyName) || customer.displayName,
        legalName: typeof buyer.companyName === 'string' ? buyer.companyName : customer.legalName,
        contactName:
          typeof buyer.contactName === 'string' ? buyer.contactName : customer.contactName,
        email: typeof buyer.email === 'string' ? buyer.email : customer.email,
        countryCode:
          typeof buyer.countryCode === 'string' ? buyer.countryCode : customer.countryCode,
        taxId: typeof buyer.taxId === 'string' ? buyer.taxId : customer.taxId,
        billingAddress: billing
          ? (billing as Prisma.InputJsonValue)
          : customer.billingAddress === null
            ? Prisma.DbNull
            : (customer.billingAddress as Prisma.InputJsonValue),
        defaultShippingAddress: shipping
          ? (shipping as Prisma.InputJsonValue)
          : customer.defaultShippingAddress === null
            ? Prisma.DbNull
            : (customer.defaultShippingAddress as Prisma.InputJsonValue),
      },
    });
    await this.audit.record({
      actorId,
      action: 'order.customer_profile.synced',
      entityType: 'Customer',
      entityId: customer.id,
      requestId,
      metadata: {
        orderNo: order.orderNo,
        fields: ['company', 'contact', 'email', 'tax', 'address'],
      },
    });
    return { customerId: customer.id };
  }

  private orderBuyer(row: {
    buyerSnapshot?: Prisma.JsonValue | null;
    buyerCompanyName?: string | null;
    buyerContactName?: string | null;
    buyerCountryCode?: string | null;
    customerSnapshot?: Prisma.JsonValue;
  }) {
    if (row.buyerSnapshot) return row.buyerSnapshot;
    const snapshot = (row.customerSnapshot ?? {}) as Record<string, unknown>;
    if (row.buyerCompanyName || row.buyerContactName) {
      return {
        companyName: row.buyerCompanyName ?? null,
        contactName: row.buyerContactName ?? null,
        countryCode: row.buyerCountryCode ?? null,
        billingAddress: snapshot.billingAddress ?? null,
      };
    }
    return {
      companyName: snapshot.companyName ?? null,
      contactName: snapshot.contactName ?? null,
      phone: snapshot.phoneE164 ?? null,
      email: snapshot.email ?? null,
      countryCode: snapshot.countryCode ?? null,
      billingAddress: snapshot.billingAddress ?? null,
    };
  }

  private partySnapshot(input: {
    companyName?: string | null;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    taxId?: string | null;
    countryCode?: string | null;
    address?: Record<string, unknown> | null;
    billingAddress?: Record<string, unknown> | null;
    shippingAddress?: Record<string, unknown> | null;
  }) {
    return {
      schemaVersion: 1,
      companyName: input.companyName ?? null,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      taxId: input.taxId ?? null,
      countryCode: input.countryCode ?? null,
      billingAddress: input.billingAddress ?? input.address ?? null,
      shippingAddress: input.shippingAddress ?? input.address ?? null,
    };
  }

  private async prepare(input: QuotationCalculationInput) {
    if (input.freightCurrencyCode !== 'CNY') {
      throw ApiError.validation('CBM and KG freight rates must use CNY.');
    }
    if (input.currencyCode === 'CNY' && new Decimal(input.exchangeRate).comparedTo(1) !== 0) {
      throw ApiError.validation('CNY exchange rate must be 1.');
    }
    const currency = await this.prisma.dictionaryItem.findFirst({
      where: { code: input.currencyCode, enabled: true, type: { code: 'currency', enabled: true } },
      select: { id: true },
    });
    if (!currency) throw ApiError.validation('Currency is not available.');
    const divisor = await this.prisma.dictionaryItem.findFirst({
      where: {
        id: input.volumetricDivisorItemId,
        enabled: true,
        type: { code: 'volumetric_weight_divisor', enabled: true },
      },
      select: { id: true, code: true, value: true },
    });
    if (!divisor) throw ApiError.validation('Invalid volumetric weight divisor.');
    const divisorRaw = divisor.value ?? divisor.code;
    if (!/^[1-9]\d*$/.test(divisorRaw)) {
      throw ApiError.validation('Volumetric weight divisor must be a positive integer.');
    }
    const divisorValue = Number(divisorRaw);
    if (!Number.isSafeInteger(divisorValue)) {
      throw ApiError.validation('Volumetric weight divisor must be a positive integer.');
    }
    const feeCodes = [...new Set(input.fees.map((fee) => fee.feeTypeCode))];
    if (feeCodes.length > 0) {
      const feeType = await this.prisma.dictionaryType.findUnique({
        where: { code: 'quotation_fee_type' },
        select: { id: true, enabled: true },
      });
      const validFees = feeType?.enabled
        ? await this.prisma.dictionaryItem.findMany({
            where: { typeId: feeType.id, code: { in: feeCodes }, enabled: true },
            select: { code: true },
          })
        : [];
      if (validFees.length !== feeCodes.length)
        throw ApiError.validation('One or more fee types are not available.');
    }
    const ids = [...new Set(input.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, lifecycleStatus: { not: 'DISCONTINUED' }, priceCny: { not: null } },
      include: {
        translations: { where: { locale: 'en-US' } },
        category: { include: { translations: { where: { locale: 'en-US' } } } },
        images: {
          where: { deleteState: 'READY' },
          orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
          include: {
            asset: {
              select: {
                id: true,
                storageKey: true,
                mimeType: true,
                status: true,
                purpose: true,
                isPublic: true,
              },
            },
          },
        },
      },
    });
    const categoryNodes = await this.prisma.category.findMany({
      select: { id: true, parentId: true, translations: { select: { locale: true, name: true } } },
    });
    const categorySnapshots = new Map(categoryNodes.map((node) => [node.id, node] as const));
    if (products.length !== ids.length)
      throw ApiError.validation('One or more products are unavailable for quotation.');
    const productById = new Map(products.map((row) => [row.id, row]));
    const items = input.items.map((request) => {
      const product = productById.get(request.productId)!;
      const translation = product.translations[0];
      const value = (
        override: string | null | undefined,
        fallback: string | number | Prisma.Decimal | null | undefined,
      ) => (override === undefined ? (fallback?.toString() ?? null) : override);
      return {
        product,
        categorySnapshot: terminalCategorySnapshot(product.categoryId, categorySnapshots),
        engine: {
          productId: product.id,
          sku: product.sku,
          productName: translation?.name ?? product.sku,
          description: translation?.description ?? null,
          costCny: product.priceCny!.toString(),
          markupPercent: request.markupPercent,
          cartonCount: request.cartonCount,
          unitsPerCarton: product.cartonQuantity,
          cartonLengthCm: value(request.cartonLengthCm, product.cartonLengthCm),
          cartonWidthCm: value(request.cartonWidthCm, product.cartonWidthCm),
          cartonHeightCm: value(request.cartonHeightCm, product.cartonHeightCm),
          cartonGrossWeightKg: value(request.cartonGrossWeightKg, product.cartonWeightKg),
        },
      };
    });
    const engineInput: QuotationEngineInput = {
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      freightCurrencyCode: input.freightCurrencyCode,
      freightBillingMethod: input.freightBillingMethod,
      cbmRatePerCbm: input.cbmRatePerCbm,
      kgRatePerKg: input.kgRatePerKg,
      volumetricDivisor: divisorValue,
      deliveryFeeCny: input.deliveryFeeCny,
      fees: input.fees.map((fee) => ({
        typeCode: fee.feeTypeCode,
        name: fee.name,
        amountCny: fee.amountCny,
        notes: fee.notes ?? null,
      })),
      items: items.map((item) => item.engine),
      requirePackaging: true,
    };
    return { items, engineInput, divisor };
  }

  /** Internal trusted calculation result used only by the calculator Excel export. */
  async calculateForExcelExport(input: QuotationCalculationInput) {
    const prepared = await this.prepare(input);
    return { prepared, result: this.calculate(prepared) };
  }

  private calculate(prepared: Awaited<ReturnType<QuotationOrderService['prepare']>>) {
    try {
      return calculateQuotation(prepared.engineInput);
    } catch (error) {
      if (!(error instanceof QuotationEngineError)) throw error;
      const field = error.lineNo
        ? `items.${error.lineNo - 1}.${error.field ?? 'packaging'}`
        : (error.field ?? 'freight');
      throw ApiError.validation(`Quotation calculation failed: ${error.code}.`, {
        [field]: `quotation.validation.${error.code.toLowerCase()}`,
      });
    }
  }

  private async snapshotProductHistory(
    prepared: Awaited<ReturnType<QuotationOrderService['prepare']>>,
    actorId: string,
  ): Promise<PreparedProductHistorySnapshots> {
    const byProductId = new Map<string, ItemProductHistorySnapshot>();
    const stagedAssets: StagedSnapshotAsset[] = [];
    const archivedBySourceKey = new Map<string, StagedSnapshotAsset>();
    let totalImageBytes = 0;

    try {
      for (const source of prepared.items) {
        if (!source.product.translations[0]?.name.trim()) {
          throw new ApiError(
            ERROR_CODES.quotationExportValidationFailed,
            'A product must have an English name before it can be saved in quotation history.',
            { status: 422 },
          );
        }
        if (!source.categorySnapshot) {
          throw new ApiError(
            ERROR_CODES.quotationExportValidationFailed,
            'A product must have an unambiguous terminal category with an English name before it can be saved in quotation history.',
            { status: 422 },
          );
        }
        const cover = source.product.images[0] ?? null;
        let imageSnapshotAssetId: string | null = null;
        let imageSnapshotStatus: ItemProductHistorySnapshot['imageSnapshotStatus'] = 'NO_IMAGE';

        if (cover) {
          const sourceKey = cover.asset?.storageKey ?? cover.storageKey;
          // Product gallery sources are publication-approved, but the managed
          // product-image/ key still routes the original object to private storage.
          if (
            !isManagedProductImageKey(sourceKey) ||
            (cover.asset !== null &&
              (cover.asset.status !== 'ready' ||
                !cover.asset.isPublic ||
                cover.asset.purpose !== 'product-image'))
          ) {
            throw new ApiError(
              ERROR_CODES.quotationExportImageUnavailable,
              'The product image cannot be archived safely for the quotation history.',
            );
          }

          let archived = archivedBySourceKey.get(sourceKey);
          if (!archived) {
            let buffer: Buffer;
            try {
              buffer = await this.storage.get(sourceKey);
            } catch {
              throw new ApiError(
                ERROR_CODES.storageUnavailable,
                'A product image could not be archived. Retry saving the quotation.',
              );
            }
            if (
              buffer.byteLength > QUOTATION_EXPORT_LIMITS.maxImageBytes ||
              totalImageBytes + buffer.byteLength > QUOTATION_EXPORT_LIMITS.maxTotalImageBytes
            ) {
              throw new ApiError(
                ERROR_CODES.quotationExportImageUnavailable,
                'The quotation product images exceed the safe archive size limit.',
              );
            }
            const detected = detectQuotationImage(buffer);
            if (
              !detected ||
              detected.width * detected.height > QUOTATION_EXPORT_LIMITS.maxImagePixels
            ) {
              throw new ApiError(
                ERROR_CODES.quotationExportImageUnavailable,
                'A product image is not a supported, valid PNG/JPEG file.',
              );
            }
            totalImageBytes += buffer.byteLength;

            const assetId = randomUUID();
            const storageKey = this.storage.buildKey(
              'private/quotation-snapshots',
              `quotation-snapshot-${assetId}`,
              `.${detected.extension}`,
            );
            const mimeType = detected.extension === 'png' ? 'image/png' : 'image/jpeg';
            const sha256 = createHash('sha256').update(buffer).digest('hex');
            const asset = await this.prisma.fileAsset.create({
              data: {
                id: assetId,
                storageKey,
                originalName: `quotation-snapshot-${assetId}.${detected.extension}`,
                mimeType,
                sizeBytes: BigInt(buffer.byteLength),
                sha256,
                width: detected.width,
                height: detected.height,
                purpose: 'quotation-snapshot-image',
                status: 'processing',
                isPublic: false,
                uploadedById: actorId,
              },
            });
            archived = { id: asset.id, storageKey: asset.storageKey };
            stagedAssets.push(archived);
            try {
              await this.storage.put(storageKey, buffer, mimeType);
              await this.prisma.fileAsset.update({
                where: { id: assetId },
                data: { status: 'ready' },
              });
            } catch {
              throw new ApiError(
                ERROR_CODES.storageUnavailable,
                'A product image could not be archived. Retry saving the quotation.',
              );
            }
            archivedBySourceKey.set(sourceKey, archived);
          }

          imageSnapshotAssetId = archived.id;
          imageSnapshotStatus = 'READY';
        }

        byProductId.set(source.product.id, {
          categoryId: source.categorySnapshot?.id ?? null,
          categoryLeafNameEn: source.categorySnapshot?.name ?? null,
          categoryLocale: 'en-US',
          imageSnapshotStatus,
          imageSnapshotAssetId,
        });
      }
      return { byProductId, stagedAssets };
    } catch (error) {
      await this.discardSnapshotAssets(stagedAssets);
      throw error;
    }
  }

  private async quotationSnapshotAssets(
    items: Array<{ productDataSnapshot: Prisma.JsonValue }>,
  ): Promise<StagedSnapshotAsset[]> {
    const assetIds = new Set<string>();
    for (const item of items) {
      const snapshot = item.productDataSnapshot as { imageSnapshotAssetId?: unknown } | null;
      if (typeof snapshot?.imageSnapshotAssetId === 'string') {
        assetIds.add(snapshot.imageSnapshotAssetId);
      }
    }
    if (assetIds.size === 0) return [];
    return this.prisma.fileAsset.findMany({
      where: {
        id: { in: [...assetIds] },
        purpose: 'quotation-snapshot-image',
      },
      select: { id: true, storageKey: true },
    });
  }

  private async discardSnapshotAssets(assets: StagedSnapshotAsset[]): Promise<void> {
    for (const asset of assets) {
      try {
        await this.storage.delete(asset.storageKey);
        await this.prisma.fileAsset.deleteMany({ where: { id: asset.id } });
      } catch {
        try {
          await this.prisma.$transaction(async (transaction) => {
            await transaction.fileDeletionJob.upsert({
              where: { idempotencyKey: `quotation-snapshot:${asset.id}` },
              create: {
                storageKey: asset.storageKey,
                entityType: 'file_asset',
                entityId: asset.id,
                status: 'QUEUED',
                idempotencyKey: `quotation-snapshot:${asset.id}`,
              },
              update: {
                status: 'QUEUED',
                runAfter: new Date(),
                lockedBy: null,
                lockedUntil: null,
                heartbeatAt: null,
                lastErrorCode: null,
              },
            });
            await transaction.fileAsset.deleteMany({ where: { id: asset.id } });
          });
        } catch {
          // The dry-run orphan-asset maintenance script remains the recovery path
          // if both immediate removal and durable task creation fail.
          this.logger.error(
            'quotation.snapshot_image_cleanup_failed',
            undefined,
            'QuotationOrderService',
            { assetId: asset.id },
          );
        }
      }
    }
  }

  private freightFields(
    prepared: Awaited<ReturnType<QuotationOrderService['prepare']>>,
    result: ReturnType<typeof calculateQuotation>,
  ) {
    return {
      freightBillingMethod: result.freight.freightBillingMethod,
      freightCurrencyCode: result.freight.freightCurrencyCode,
      cbmRatePerCbm: result.freight.cbmRatePerCbm,
      orderTotalCbm: result.freight.orderTotalCbm,
      cbmFreightAmount: result.freight.cbmFreightAmount,
      kgRatePerKg: result.freight.kgRatePerKg,
      volumetricDivisorItemId: prepared.divisor.id,
      volumetricDivisorCode: prepared.divisor.code,
      volumetricDivisorValue: result.freight.volumetricDivisor,
      orderTotalVolumeWeightKg: result.freight.orderTotalVolumeWeightKg,
      orderTotalGrossWeightKg: result.freight.orderTotalGrossWeightKg,
      chargeableWeightKg: result.freight.chargeableWeightKg,
      kgChargeableBasis: result.freight.kgChargeableBasis,
      kgFreightAmount: result.freight.kgFreightAmount,
      selectedFreightAmount: result.freight.selectedFreightAmount,
      freightAllocationSnapshot: {
        method: result.freight.freightBillingMethod,
        currencyCode: result.freight.freightCurrencyCode,
        kgChargeableBasis: result.freight.kgChargeableBasis,
        allocation: result.freight.allocationSnapshot,
      } as Prisma.InputJsonValue,
    };
  }

  private persistableItems(
    prepared: Awaited<ReturnType<QuotationOrderService['prepare']>>,
    result: ReturnType<typeof calculateQuotation>,
    historySnapshots: Map<string, ItemProductHistorySnapshot>,
  ) {
    return result.items.map((item, index) => {
      const source = prepared.items[index]!;
      const packaging = item.packaging;
      const productHistory = historySnapshots.get(source.product.id);
      if (!productHistory) {
        throw new Error('A product history snapshot was not prepared.');
      }
      return {
        lineNo: item.lineNo,
        productId: item.productId,
        skuSnapshot: item.sku,
        productNameSnapshot: item.productName,
        descriptionSnapshot: item.description,
        quantity: item.quantity,
        costCny: item.costCny,
        markupPercent: item.markupPercent,
        unitSalePriceCny: item.unitSalePriceCny,
        lineAmountCny: item.lineAmountCny,
        cartonCount: packaging.cartonCount,
        unitsPerCarton: packaging.unitsPerCarton,
        cartonLengthCm: packaging.cartonLengthCm,
        cartonWidthCm: packaging.cartonWidthCm,
        cartonHeightCm: packaging.cartonHeightCm,
        cartonGrossWeightKg: packaging.cartonGrossWeightKg,
        cartonVolumeCbm: item.packaging.cartonVolumeCbm,
        totalCbm: item.packaging.totalCbm,
        volumetricDivisor: null,
        totalVolumeWeightKg: item.totalVolumeWeightKg,
        totalGrossWeightKg: item.totalGrossWeightKg,
        freightAllocationBasis: item.freightAllocationBasis,
        allocatedFreightCny: item.allocatedFreightCny,
        allocatedFreightForeign: item.allocatedFreightForeign,
        unitSalePriceForeign: item.unitSalePriceForeign,
        lineAmountForeign: item.lineAmountForeign,
        hsCodeSnapshot: source.product.hsCode ?? null,
        originCountryCodeSnapshot: source.product.originCountryCode ?? null,
        customsDescriptionSnapshot: source.product.customsDescription ?? null,
        netWeightPerUnitKgSnapshot: source.product.netWeightPerUnitKg?.toString() ?? null,
        productDataSnapshot: {
          id: source.product.id,
          sku: source.product.sku,
          priceCny: source.product.priceCny!.toString(),
          name: item.productName,
          hsCode: source.product.hsCode ?? null,
          originCountryCode: source.product.originCountryCode ?? null,
          customsDescription: source.product.customsDescription ?? null,
          netWeightPerUnitKg: source.product.netWeightPerUnitKg?.toString() ?? null,
          exportUnit: source.product.exportUnit ?? null,
          categoryId: productHistory.categoryId,
          categoryLeafNameEn: productHistory.categoryLeafNameEn,
          categoryLocale: productHistory.categoryLocale,
          imageSnapshotStatus: productHistory.imageSnapshotStatus,
          imageSnapshotAssetId: productHistory.imageSnapshotAssetId,
        } as Prisma.InputJsonValue,
        packagingSnapshot: packaging as Prisma.InputJsonValue,
      };
    });
  }

  private copyItem(item: Prisma.QuotationItemGetPayload<object>) {
    return {
      lineNo: item.lineNo,
      productId: item.productId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      descriptionSnapshot: item.descriptionSnapshot,
      quantity: item.quantity,
      unit: item.unit,
      costCny: item.costCny,
      markupPercent: item.markupPercent,
      unitSalePriceCny: item.unitSalePriceCny,
      lineAmountCny: item.lineAmountCny,
      cartonCount: item.cartonCount,
      unitsPerCarton: item.unitsPerCarton,
      cartonLengthCm: item.cartonLengthCm,
      cartonWidthCm: item.cartonWidthCm,
      cartonHeightCm: item.cartonHeightCm,
      cartonGrossWeightKg: item.cartonGrossWeightKg,
      cartonVolumeCbm: item.cartonVolumeCbm,
      totalCbm: item.totalCbm,
      volumetricDivisor: item.volumetricDivisor,
      totalVolumeWeightKg: item.totalVolumeWeightKg,
      totalGrossWeightKg: item.totalGrossWeightKg,
      freightAllocationBasis: item.freightAllocationBasis,
      allocatedFreightCny: item.allocatedFreightCny,
      allocatedFreightForeign: item.allocatedFreightForeign,
      unitSalePriceForeign: item.unitSalePriceForeign,
      lineAmountForeign: item.lineAmountForeign,
      hsCodeSnapshot: this.snapshotString(item.productDataSnapshot, 'hsCode'),
      originCountryCodeSnapshot: this.snapshotString(item.productDataSnapshot, 'originCountryCode'),
      customsDescriptionSnapshot: this.snapshotString(
        item.productDataSnapshot,
        'customsDescription',
      ),
      netWeightPerUnitKgSnapshot: this.snapshotString(
        item.productDataSnapshot,
        'netWeightPerUnitKg',
      ),
      productDataSnapshot: item.productDataSnapshot as Prisma.InputJsonValue,
      packagingSnapshot: item.packagingSnapshot as Prisma.InputJsonValue,
    };
  }

  private async ensureCustomer(
    tx: Prisma.TransactionClient,
    input: QuotationCalculationInput,
  ): Promise<string | null> {
    if (input.customerId) {
      const existing = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true },
      });
      if (!existing) throw ApiError.validation('Selected customer does not exist.');
      return existing.id;
    }
    if (!input.customer.phoneE164) return null;
    if (!/^\+[1-9]\d{1,14}$/.test(input.customer.phoneE164))
      throw ApiError.validation('Customer phone must be in E.164 format.');
    const customer = await tx.customer.upsert({
      where: { phoneE164: input.customer.phoneE164 },
      create: {
        phoneE164: input.customer.phoneE164,
        countryCode: input.customer.countryCode ?? null,
        displayName: input.customer.legalCompanyName || input.customer.companyName || null,
        legalName: input.customer.legalCompanyName || null,
        contactName: input.customer.contactName || null,
        email: input.customer.email ?? null,
        customerType: input.customer.customerType,
        taxId: input.customer.taxId || null,
        website: input.customer.website || null,
        preferredLanguage: input.customer.preferredLanguage,
        billingAddress: input.customer.billingAddress as Prisma.InputJsonValue | undefined,
        defaultShippingAddress: input.customer.shippingAddress as Prisma.InputJsonValue | undefined,
      },
      update: {},
      select: { id: true },
    });
    return customer.id;
  }

  private assertOrderCustomer(input: QuotationCalculationInput) {
    const customer = input.customer;
    const address = customer.shippingAddress;
    const fields: string[] = [];
    if (!input.orderDate) fields.push('orderDate');
    if (!customer.companyName && !customer.contactName) fields.push('customerName');
    if (!customer.phoneE164 || !/^\+[1-9]\d{1,14}$/.test(customer.phoneE164)) fields.push('phone');
    if (!customer.countryCode) fields.push('countryCode');
    if (!address?.recipient) fields.push('recipient');
    if (!address?.countryCode) fields.push('shippingCountryCode');
    if (!address?.city) fields.push('city');
    if (!address?.line1) fields.push('addressLine');

    if (fields.length) {
      throw ApiError.validation(
        'A customer name, phone, country, complete shipping address and order date are required to create an order.',
        { fields },
      );
    }
  }

  private customerSnapshot(input: QuotationCalculationInput, contractNo = input.contractNo) {
    return {
      schemaVersion: 1,
      companyName: input.customer.companyName,
      legalCompanyName: input.customer.legalCompanyName || null,
      contactName: input.customer.contactName,
      phoneE164: input.customer.phoneE164,
      email: input.customer.email ?? null,
      countryCode: input.customer.countryCode ?? null,
      customerType: input.customer.customerType,
      taxId: input.customer.taxId || null,
      website: input.customer.website || null,
      preferredLanguage: input.customer.preferredLanguage,
      billingAddress: this.normalizeAddress(input.customer.billingAddress),
      shippingAddress: this.normalizeAddress(input.customer.shippingAddress),
      buyerReference: input.buyerReference || null,
      contractNo: contractNo || null,
    };
  }

  private normalizeAddress(
    address: QuotationCalculationInput['customer']['billingAddress'] | undefined | null,
  ) {
    if (!address) return null;
    return {
      recipient: address.recipient || null,
      companyName: address.companyName || null,
      phoneE164: address.phoneE164 || null,
      line1: address.line1 || null,
      line2: address.line2 || null,
      city: address.city || null,
      state: address.region || null,
      postalCode: address.postalCode || null,
      countryCode: address.countryCode,
    };
  }

  private buyerSnapshot(input: QuotationCalculationInput) {
    return {
      schemaVersion: 1,
      companyName: input.customer.legalCompanyName || input.customer.companyName || null,
      contactName: input.customer.contactName || null,
      phone: input.customer.phoneE164 || null,
      email: input.customer.email ?? null,
      taxId: input.customer.taxId || null,
      countryCode: input.customer.countryCode ?? null,
      customerType: input.customer.customerType,
      billingAddress: this.normalizeAddress(input.customer.billingAddress),
      preferredLanguage: input.customer.preferredLanguage,
    };
  }

  private consigneeSnapshot(input: QuotationCalculationInput) {
    const shipping = input.customer.shippingAddress;
    if (!shipping) return null;
    return {
      schemaVersion: 1,
      companyName:
        shipping.companyName ||
        input.customer.legalCompanyName ||
        input.customer.companyName ||
        null,
      contactName: shipping.recipient || input.customer.contactName || null,
      phone: shipping.phoneE164 || input.customer.phoneE164 || null,
      email: input.customer.email ?? null,
      shippingAddress: this.normalizeAddress(shipping),
    };
  }

  private tradeSnapshot(input: QuotationCalculationInput, contractNo = input.contractNo) {
    const rate = new Decimal(input.exchangeRate);
    const exchangeRateText =
      input.currencyCode === 'CNY'
        ? '1 CNY = 1 CNY'
        : `1 CNY = ${rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} ${input.currencyCode}`;
    return {
      schemaVersion: 1,
      incotermCode: input.trade?.incotermCode ?? null,
      namedPlace: input.trade?.namedPlace || null,
      paymentTerms: input.trade?.paymentTerms || null,
      contractNo: contractNo || null,
      buyerReference: input.buyerReference || null,
      exchangeRateText,
    };
  }

  private quotationDto(
    row: {
      id: string;
      quotationNo: string;
      title: string;
      status: string;
      currencyCode: string;
      exchangeRate?: Prisma.Decimal;
      exchangeRateDate?: Date;
      freightBillingMethod?: string | null;
      freightCurrencyCode?: string | null;
      cbmRatePerCbm?: Prisma.Decimal | null;
      orderTotalCbm?: Prisma.Decimal | null;
      cbmFreightAmount?: Prisma.Decimal | null;
      kgRatePerKg?: Prisma.Decimal | null;
      volumetricDivisorItemId?: string | null;
      volumetricDivisorCode?: string | null;
      volumetricDivisorValue?: number | null;
      orderTotalVolumeWeightKg?: Prisma.Decimal | null;
      orderTotalGrossWeightKg?: Prisma.Decimal | null;
      chargeableWeightKg?: Prisma.Decimal | null;
      kgChargeableBasis?: string | null;
      kgFreightAmount?: Prisma.Decimal | null;
      selectedFreightAmount?: Prisma.Decimal | null;
      freightAllocationSnapshot?: Prisma.JsonValue | null;
      revision?: number;
      validUntil?: Date | null;
      totalAmountCny: Prisma.Decimal;
      totalAmountForeign: Prisma.Decimal;
      createdAt: Date;
      customerSnapshot: Prisma.JsonValue;
      items?: {
        id: string;
        lineNo: number;
        skuSnapshot: string;
        productNameSnapshot: string;
        quantity: Prisma.Decimal;
        lineAmountCny: Prisma.Decimal;
        costCny: Prisma.Decimal;
        markupPercent?: Prisma.Decimal;
        unitSalePriceCny?: Prisma.Decimal;
        allocatedFreightCny: Prisma.Decimal;
        allocatedFreightForeign?: Prisma.Decimal;
        cartonCount?: number | null;
        unitsPerCarton?: number | null;
        cartonLengthCm?: Prisma.Decimal | null;
        cartonWidthCm?: Prisma.Decimal | null;
        cartonHeightCm?: Prisma.Decimal | null;
        cartonGrossWeightKg?: Prisma.Decimal | null;
        cartonVolumeCbm?: Prisma.Decimal | null;
        totalCbm?: Prisma.Decimal | null;
        packagingSnapshot: Prisma.JsonValue;
        volumetricDivisor?: number | null;
        totalVolumeWeightKg?: Prisma.Decimal;
        totalGrossWeightKg?: Prisma.Decimal;
        unitSalePriceForeign?: Prisma.Decimal;
        lineAmountForeign?: Prisma.Decimal;
      }[];
      fees?: {
        id: string;
        feeTypeCode?: string;
        nameSnapshot: string;
        amountCny: Prisma.Decimal;
        amountForeign: Prisma.Decimal;
        isFreight?: boolean;
        notes?: string | null;
      }[];
    },
    includeFreight = true,
  ) {
    return {
      id: row.id,
      quotationNo: row.quotationNo,
      title: row.title,
      status: row.status,
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate?.toString(),
      exchangeRateDate: row.exchangeRateDate?.toISOString().slice(0, 10),
      freight: includeFreight ? this.freightDto(row) : undefined,
      revision: row.revision,
      validUntil: row.validUntil?.toISOString() ?? null,
      totalAmountCny: row.totalAmountCny.toString(),
      totalAmountForeign: row.totalAmountForeign.toString(),
      customer: row.customerSnapshot,
      createdAt: row.createdAt.toISOString(),
      items: row.items?.map((item) => ({
        id: item.id,
        lineNo: item.lineNo,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        quantity: item.quantity.toString(),
        lineAmountCny: item.lineAmountCny.toString(),
        costCny: item.costCny.toString(),
        markupPercent: item.markupPercent?.toString(),
        unitSalePriceCny: item.unitSalePriceCny?.toString(),
        allocatedFreightCny: item.allocatedFreightCny.toString(),
        allocatedFreightForeign: item.allocatedFreightForeign?.toString(),
        packaging: {
          cartonCount: item.cartonCount,
          unitsPerCarton: item.unitsPerCarton,
          cartonLengthCm: item.cartonLengthCm?.toString() ?? null,
          cartonWidthCm: item.cartonWidthCm?.toString() ?? null,
          cartonHeightCm: item.cartonHeightCm?.toString() ?? null,
          cartonGrossWeightKg: item.cartonGrossWeightKg?.toString() ?? null,
          cartonVolumeCbm: item.cartonVolumeCbm?.toString() ?? null,
          cartonVolumeWeightKg: this.snapshotString(item.packagingSnapshot, 'cartonVolumeWeightKg'),
          totalCbm: item.totalCbm?.toString() ?? null,
          volumetricDivisor: item.volumetricDivisor,
        },
        totalVolumeWeightKg: item.totalVolumeWeightKg?.toString(),
        totalGrossWeightKg: item.totalGrossWeightKg?.toString(),
        unitSalePriceForeign: item.unitSalePriceForeign?.toString(),
        lineAmountForeign: item.lineAmountForeign?.toString(),
      })),
      fees: row.fees?.map((fee) => ({
        id: fee.id,
        typeCode: fee.feeTypeCode,
        name: fee.nameSnapshot,
        amountCny: fee.amountCny.toString(),
        amountForeign: fee.amountForeign.toString(),
        isFreight: fee.isFreight,
        notes: fee.notes,
      })),
    };
  }

  private orderDto(
    row: {
      id: string;
      orderNo: string;
      status: string;
      currencyCode: string;
      exchangeRate?: Prisma.Decimal;
      exchangeRateDate?: Date;
      freightBillingMethod?: string | null;
      freightCurrencyCode?: string | null;
      cbmRatePerCbm?: Prisma.Decimal | null;
      orderTotalCbm?: Prisma.Decimal | null;
      cbmFreightAmount?: Prisma.Decimal | null;
      kgRatePerKg?: Prisma.Decimal | null;
      volumetricDivisorItemId?: string | null;
      volumetricDivisorCode?: string | null;
      volumetricDivisorValue?: number | null;
      orderTotalVolumeWeightKg?: Prisma.Decimal | null;
      orderTotalGrossWeightKg?: Prisma.Decimal | null;
      chargeableWeightKg?: Prisma.Decimal | null;
      kgChargeableBasis?: string | null;
      kgFreightAmount?: Prisma.Decimal | null;
      selectedFreightAmount?: Prisma.Decimal | null;
      freightAllocationSnapshot?: Prisma.JsonValue | null;
      sourceQuotationId?: string | null;
      totalAmountCny: Prisma.Decimal;
      totalAmountForeign: Prisma.Decimal;
      orderDate: Date;
      updatedAt?: Date;
      version?: number;
      buyerReference?: string | null;
      contractNo?: string | null;
      buyerCompanyName?: string | null;
      buyerContactName?: string | null;
      buyerEmail?: string | null;
      buyerPhoneE164?: string | null;
      buyerCountryCode?: string | null;
      consigneeName?: string | null;
      consigneeCountryCode?: string | null;
      buyerSnapshot?: Prisma.JsonValue | null;
      consigneeSnapshot?: Prisma.JsonValue | null;
      notifyPartySnapshot?: Prisma.JsonValue | null;
      tradeSnapshot?: Prisma.JsonValue | null;
      customerSnapshot: Prisma.JsonValue;
      items?: {
        id: string;
        lineNo: number;
        skuSnapshot: string;
        productNameSnapshot: string;
        quantity: Prisma.Decimal;
        lineAmountCny: Prisma.Decimal;
        costCny: Prisma.Decimal;
        allocatedFreightCny: Prisma.Decimal;
        markupPercent?: Prisma.Decimal;
        unitSalePriceCny?: Prisma.Decimal;
        allocatedFreightForeign?: Prisma.Decimal;
        cartonCount?: number | null;
        unitsPerCarton?: number | null;
        cartonLengthCm?: Prisma.Decimal | null;
        cartonWidthCm?: Prisma.Decimal | null;
        cartonHeightCm?: Prisma.Decimal | null;
        cartonGrossWeightKg?: Prisma.Decimal | null;
        cartonVolumeCbm?: Prisma.Decimal | null;
        totalCbm?: Prisma.Decimal | null;
        packagingSnapshot: Prisma.JsonValue;
        volumetricDivisor?: number | null;
        totalVolumeWeightKg?: Prisma.Decimal;
        totalGrossWeightKg?: Prisma.Decimal;
        unitSalePriceForeign?: Prisma.Decimal;
        lineAmountForeign?: Prisma.Decimal;
      }[];
      fees?: {
        id: string;
        feeTypeCode?: string;
        nameSnapshot: string;
        amountCny: Prisma.Decimal;
        amountForeign: Prisma.Decimal;
        isFreight?: boolean;
        notes?: string | null;
      }[];
    },
    includeFreight = true,
  ) {
    return {
      id: row.id,
      orderNo: row.orderNo,
      status: row.status,
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate?.toString(),
      exchangeRateDate: row.exchangeRateDate?.toISOString().slice(0, 10),
      freight: includeFreight ? this.freightDto(row) : undefined,
      sourceQuotationId: row.sourceQuotationId,
      orderDate: row.orderDate.toISOString().slice(0, 10),
      totalAmountCny: row.totalAmountCny.toString(),
      totalAmountForeign: row.totalAmountForeign.toString(),
      updatedAt: row.updatedAt?.toISOString() ?? null,
      version: row.version ?? 1,
      buyer: this.orderBuyer(row),
      consignee: row.consigneeSnapshot ?? null,
      notifyParty: row.notifyPartySnapshot ?? null,
      trade: row.tradeSnapshot ?? null,
      buyerReference: row.buyerReference ?? null,
      contractNo: row.contractNo ?? null,
      customer: row.customerSnapshot,
      items: row.items?.map((item) => ({
        id: item.id,
        lineNo: item.lineNo,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        quantity: item.quantity.toString(),
        lineAmountCny: item.lineAmountCny.toString(),
        costCny: item.costCny.toString(),
        markupPercent: item.markupPercent?.toString(),
        unitSalePriceCny: item.unitSalePriceCny?.toString(),
        allocatedFreightCny: item.allocatedFreightCny.toString(),
        allocatedFreightForeign: item.allocatedFreightForeign?.toString(),
        packaging: {
          cartonCount: item.cartonCount,
          unitsPerCarton: item.unitsPerCarton,
          cartonLengthCm: item.cartonLengthCm?.toString() ?? null,
          cartonWidthCm: item.cartonWidthCm?.toString() ?? null,
          cartonHeightCm: item.cartonHeightCm?.toString() ?? null,
          cartonGrossWeightKg: item.cartonGrossWeightKg?.toString() ?? null,
          cartonVolumeCbm: item.cartonVolumeCbm?.toString() ?? null,
          cartonVolumeWeightKg: this.snapshotString(item.packagingSnapshot, 'cartonVolumeWeightKg'),
          totalCbm: item.totalCbm?.toString() ?? null,
          volumetricDivisor: item.volumetricDivisor,
        },
        totalVolumeWeightKg: item.totalVolumeWeightKg?.toString(),
        totalGrossWeightKg: item.totalGrossWeightKg?.toString(),
        unitSalePriceForeign: item.unitSalePriceForeign?.toString(),
        lineAmountForeign: item.lineAmountForeign?.toString(),
      })),
      fees: row.fees?.map((fee) => ({
        id: fee.id,
        typeCode: fee.feeTypeCode,
        name: fee.nameSnapshot,
        amountCny: fee.amountCny.toString(),
        amountForeign: fee.amountForeign.toString(),
        isFreight: fee.isFreight,
        notes: fee.notes,
      })),
    };
  }

  private freightDto(row: {
    freightBillingMethod?: string | null;
    freightCurrencyCode?: string | null;
    cbmRatePerCbm?: Prisma.Decimal | null;
    orderTotalCbm?: Prisma.Decimal | null;
    cbmFreightAmount?: Prisma.Decimal | null;
    kgRatePerKg?: Prisma.Decimal | null;
    volumetricDivisorItemId?: string | null;
    volumetricDivisorCode?: string | null;
    volumetricDivisorValue?: number | null;
    orderTotalVolumeWeightKg?: Prisma.Decimal | null;
    orderTotalGrossWeightKg?: Prisma.Decimal | null;
    chargeableWeightKg?: Prisma.Decimal | null;
    kgChargeableBasis?: string | null;
    kgFreightAmount?: Prisma.Decimal | null;
    selectedFreightAmount?: Prisma.Decimal | null;
    freightAllocationSnapshot?: Prisma.JsonValue | null;
  }) {
    if (!row.freightBillingMethod) return null;
    return {
      billingMethod: row.freightBillingMethod,
      currencyCode: row.freightCurrencyCode,
      cbmRatePerCbm: row.cbmRatePerCbm?.toString() ?? null,
      orderTotalCbm: row.orderTotalCbm?.toString() ?? null,
      cbmFreightAmount: row.cbmFreightAmount?.toString() ?? null,
      kgRatePerKg: row.kgRatePerKg?.toString() ?? null,
      volumetricDivisor: {
        itemId: row.volumetricDivisorItemId ?? null,
        code: row.volumetricDivisorCode ?? null,
        value: row.volumetricDivisorValue ?? null,
      },
      orderTotalVolumeWeightKg: row.orderTotalVolumeWeightKg?.toString() ?? null,
      orderTotalGrossWeightKg: row.orderTotalGrossWeightKg?.toString() ?? null,
      chargeableWeightKg: row.chargeableWeightKg?.toString() ?? null,
      kgChargeableBasis: row.kgChargeableBasis ?? null,
      kgFreightAmount: row.kgFreightAmount?.toString() ?? null,
      selectedFreightAmount: row.selectedFreightAmount?.toString() ?? null,
      allocationSnapshot: row.freightAllocationSnapshot ?? null,
    };
  }

  private snapshotString(snapshot: Prisma.JsonValue, key: string): string | null {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;
    const value = snapshot[key];
    return typeof value === 'string' ? value : null;
  }

  private label(
    translations: { locale: string; label: string }[],
    locale: string,
    fallback: string,
  ) {
    return (
      translations.find((translation) => translation.locale === locale)?.label ??
      translations.find((translation) => translation.locale === 'en-US')?.label ??
      fallback
    );
  }

  private number(prefix: 'Q' | 'O') {
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `${prefix}-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private payloadHash(input: QuotationCalculationInput): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private date(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }
}

function terminalCategorySnapshot(
  categoryId: string | null,
  categories: Map<string, CategorySnapshotNode>,
): { id: string; name: string } | null {
  if (!categoryId) return null;
  let currentNode: CategorySnapshotNode | null = categories.get(categoryId) ?? null;
  if (!currentNode) return null;
  const childrenByParent = new Map<string, CategorySnapshotNode[]>();
  for (const candidate of categories.values()) {
    if (!candidate.parentId) continue;
    const siblings = childrenByParent.get(candidate.parentId) ?? [];
    siblings.push(candidate);
    childrenByParent.set(candidate.parentId, siblings);
  }
  const visited = new Set<string>();
  while (true) {
    if (!currentNode) return null;
    if (visited.has(currentNode.id)) return null;
    visited.add(currentNode.id);
    const children: CategorySnapshotNode[] = childrenByParent.get(currentNode.id) ?? [];
    if (children.length === 0) {
      const name = currentNode.translations
        .find((translation) => translation.locale === 'en-US')
        ?.name.trim();
      return name ? { id: currentNode.id, name } : null;
    }
    // A product attached to a non-leaf category can be resolved only when its
    // tree has one unambiguous terminal descendant.
    if (children.length !== 1) return null;
    currentNode = children[0] ?? null;
  }
}
