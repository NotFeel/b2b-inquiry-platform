import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@b2b/database';
import { DICTIONARY_TYPES, ERROR_CODES, QUOTATION_EXPORT_LIMITS } from '@b2b/contracts';
import Decimal from 'decimal.js';
import type {
  QuotationCalculationInput,
  QuotationListQuery,
  OrderListQuery,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { JsonLogger } from '../../common/logger.service';
import { CategoriesService } from '../categories/categories.service';
import { isManagedProductImageKey } from '../products/product-image-policy';
import { PrismaService } from '../../prisma/prisma.service';
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
    const customerSnapshot = this.customerSnapshot(input);
    const historySnapshots = await this.snapshotProductHistory(prepared, actorId);
    const order = await this.prisma
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
            customerSnapshot: customerSnapshot as Prisma.InputJsonValue,
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
        await this.discardSnapshotAssets(historySnapshots.stagedAssets);
        const concurrent = await this.prisma.order.findUnique({
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
      ...(query.status ? { status: query.status } : {}),
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

  async convertQuotation(id: string, actorId: string, requestId: string) {
    const existingOrder = await this.prisma.order.findUnique({
      where: { sourceQuotationId: id },
      include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
    });
    if (existingOrder) return this.orderDto(existingOrder);
    const order = await this.prisma
      .$transaction(async (tx) => {
        const quotation = await tx.quotation.findUnique({
          where: { id },
          include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
        });
        if (!quotation) throw ApiError.notFound('Quotation not found.');
        if (quotation.status !== 'DRAFT')
          throw ApiError.conflict(ERROR_CODES.conflict, 'Quotation is not a draft.');
        const input = (quotation.calculationSnapshot as { input: QuotationCalculationInput }).input;
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
            freightAllocationSnapshot: quotation.freightAllocationSnapshot as Prisma.InputJsonValue,
            subtotalCny: quotation.subtotalCny,
            freightCny: quotation.freightCny,
            deliveryFeeCny: quotation.deliveryFeeCny,
            otherFeesCny: quotation.otherFeesCny,
            totalAmountCny: quotation.totalAmountCny,
            totalAmountForeignExact: quotation.totalAmountForeignExact,
            totalAmountForeign: quotation.totalAmountForeign,
            customerSnapshot: quotation.customerSnapshot as Prisma.InputJsonValue,
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
          include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
        });
        if (concurrentOrder) return concurrentOrder;
        throw error;
      });
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

  async listOrders(query: OrderListQuery) {
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { orderNo: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { orderNo: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((row) => this.orderDto(row, false)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async orderDetail(id: string) {
    const row = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } }, fees: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) throw ApiError.notFound('Order not found.');
    return this.orderDto(row);
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
      const defaultCartons = product.cartonQuantity
        ? new Decimal(request.quantity).div(product.cartonQuantity).ceil().toNumber()
        : null;
      return {
        product,
        categorySnapshot: terminalCategorySnapshot(product.categoryId, categorySnapshots),
        engine: {
          productId: product.id,
          sku: product.sku,
          productName: translation?.name ?? product.sku,
          description: translation?.description ?? null,
          costCny: product.priceCny!.toString(),
          quantity: request.quantity,
          markupPercent: request.markupPercent,
          cartonCount: request.cartonCount ?? defaultCartons,
          unitsPerCarton: request.unitsPerCarton ?? product.cartonQuantity,
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
        productDataSnapshot: {
          id: source.product.id,
          sku: source.product.sku,
          priceCny: source.product.priceCny!.toString(),
          name: item.productName,
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
        displayName: input.customer.companyName || null,
        contactName: input.customer.contactName || null,
        email: input.customer.email ?? null,
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
    if (
      !input.orderDate ||
      (!customer.companyName && !customer.contactName) ||
      !customer.phoneE164 ||
      !/^\+[1-9]\d{1,14}$/.test(customer.phoneE164) ||
      !customer.countryCode ||
      !customer.shippingAddress
    ) {
      throw ApiError.validation(
        'A customer name, phone, country, complete shipping address and order date are required to create an order.',
      );
    }
  }

  private customerSnapshot(input: QuotationCalculationInput) {
    return {
      companyName: input.customer.companyName,
      contactName: input.customer.contactName,
      phoneE164: input.customer.phoneE164,
      email: input.customer.email ?? null,
      countryCode: input.customer.countryCode ?? null,
      billingAddress: input.customer.billingAddress ?? null,
      shippingAddress: input.customer.shippingAddress ?? null,
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
