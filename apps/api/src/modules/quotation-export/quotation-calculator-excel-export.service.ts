import { Injectable } from '@nestjs/common';
import { ERROR_CODES, QUOTATION_EXPORT_LIMITS } from '@b2b/contracts';
import type { Prisma } from '@b2b/database';
import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import type {
  QuotationCalculatorExcelExportInput,
  QuotationHistoryExcelExportInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isManagedProductImageKey } from '../products/product-image-policy';
import { inspectCalculatorQuoteTemplateWorkbook } from '../quote/calculator-quote-template-parser';
import { QuotationOrderService } from './quotation-order.service';
import { detectQuotationImage } from './quotation-image';
import {
  buildCalculatorQuotationWorkbook,
  type CalculatorQuotationWorkbookItem,
} from './quotation-calculator-workbook';
import { quotationFilename } from './quotation-workbook';

const SNAPSHOT_PREFIX = 'private/quotation-snapshots/';

export interface CalculatorTemplateOption {
  id: string;
  name: string;
  version: number;
}

interface LoadedCalculatorTemplate {
  option: CalculatorTemplateOption;
  buffer: Buffer;
}

interface HistoricalDocument {
  id: string;
  currencyCode: string;
  exchangeRate: Prisma.Decimal;
  freightBillingMethod: 'CBM' | 'KG' | null;
  freightCurrencyCode: string | null;
  selectedFreightAmount: Prisma.Decimal | null;
  fees: {
    feeTypeCode: string;
    amountCny: Prisma.Decimal;
    amountForeign: Prisma.Decimal;
    isFreight: boolean;
  }[];
  items: {
    lineNo: number;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: Prisma.Decimal;
    unitSalePriceCny: Prisma.Decimal;
    productDataSnapshot: Prisma.JsonValue;
  }[];
}

interface SnapshotProductData {
  categoryLeafNameEn?: unknown;
  categoryLocale?: unknown;
  imageSnapshotStatus?: unknown;
  imageSnapshotAssetId?: unknown;
}

@Injectable()
export class QuotationCalculatorExcelExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quotationOrder: QuotationOrderService,
    private readonly logger: JsonLogger,
  ) {}

  async listTemplates(): Promise<CalculatorTemplateOption[]> {
    const templates = await this.prisma.quoteTemplate.findMany({
      where: { templateType: 'calculator_quote', status: 'active' },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
    const exportable = templates.filter((template) => {
      const report = (template.validationReport as Record<string, unknown> | null) ?? null;
      return report?.requiredFieldsPresent === true;
    });
    if (exportable.length === 0) return [];
    const assets = await this.prisma.fileAsset.findMany({
      where: {
        storageKey: { in: exportable.map((template) => template.storageKey) },
        purpose: 'quote-template',
        status: 'ready',
        isPublic: false,
      },
      select: { storageKey: true },
    });
    const readyKeys = new Set(assets.map((asset) => asset.storageKey));
    return exportable
      .filter((template) => readyKeys.has(template.storageKey))
      .map((template) => ({ id: template.id, name: template.name, version: template.version }));
  }

  async exportCurrent(
    input: QuotationCalculatorExcelExportInput,
    actorId: string,
    requestId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const template = await this.loadTemplate(input.templateId);
    const { prepared, result } = await this.quotationOrder.calculateForExcelExport(
      input.calculation,
    );
    const items: CalculatorQuotationWorkbookItem[] = [];
    let totalImageBytes = 0;

    for (let index = 0; index < result.items.length; index += 1) {
      const calculated = result.items[index]!;
      const source = prepared.items[index]!;
      const englishName = source.product.translations[0]?.name.trim();
      const categoryLeafNameEn = source.categorySnapshot?.name;
      if (!englishName || !categoryLeafNameEn) {
        throw this.validationError(
          'A selected product is missing its English name or terminal category.',
        );
      }

      const unitPrice = new Decimal(calculated.unitSalePriceCny)
        .times(input.calculation.exchangeRate)
        .toDecimalPlaces(2, Decimal.ROUND_CEIL);
      const quantity = new Decimal(calculated.quantity);
      const lineTotal = unitPrice.times(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const image = await this.readCurrentProductImage(source.product.images[0] ?? null);
      if (image) {
        totalImageBytes += image.buffer.byteLength;
        this.assertTotalImageBytes(totalImageBytes);
      } else {
        this.logger.warn('quotation_calculator_excel.product_image_missing', {
          requestId,
          actorId,
          sourceType: 'current_calculation',
          productId: source.product.id,
        });
      }
      items.push({
        productId: calculated.productId ?? source.product.id,
        sku: calculated.sku,
        englishName,
        categoryLeafNameEn,
        quantity: calculated.quantity,
        unitPrice: unitPrice.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
        image,
      });
    }

    const productSubtotal = items.reduce((sum, item) => sum.plus(item.lineTotal), new Decimal(0));
    const shippingCost = result.fees.reduce(
      (sum, fee) => sum.plus(fee.amountForeign),
      new Decimal(0),
    );
    const totalCost = productSubtotal.plus(shippingCost);
    const buffer = await this.buildWorkbook(template.buffer, {
      currencyCode: input.calculation.currencyCode,
      items,
      productSubtotal: productSubtotal.toFixed(2),
      shippingCost: shippingCost.toFixed(2),
      totalCost: totalCost.toFixed(2),
    });
    await this.recordExport({
      actorId,
      requestId,
      sourceType: 'current_calculation',
      sourceId: null,
      template: template.option,
      currencyCode: input.calculation.currencyCode,
      itemCount: items.length,
      freightBillingMethod: result.freight.freightBillingMethod,
      outputSize: buffer.byteLength,
    });
    return { buffer, filename: quotationFilename(input.calculation.currencyCode, new Date()) };
  }

  async exportQuotation(
    quotationId: string,
    input: QuotationHistoryExcelExportInput,
    actorId: string,
    requestId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const [template, document] = await Promise.all([
      this.loadTemplate(input.templateId),
      this.loadQuotation(quotationId),
    ]);
    return this.exportHistoricalDocument({
      template,
      document,
      sourceType: 'quotation',
      actorId,
      requestId,
    });
  }

  async exportOrder(
    orderId: string,
    input: QuotationHistoryExcelExportInput,
    actorId: string,
    requestId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const [template, document] = await Promise.all([
      this.loadTemplate(input.templateId),
      this.loadOrder(orderId),
    ]);
    return this.exportHistoricalDocument({
      template,
      document,
      sourceType: 'order',
      actorId,
      requestId,
    });
  }

  private async exportHistoricalDocument(input: {
    template: LoadedCalculatorTemplate;
    document: HistoricalDocument;
    sourceType: 'quotation' | 'order';
    actorId: string;
    requestId: string;
  }): Promise<{ buffer: Buffer; filename: string }> {
    const { document } = input;
    this.assertHistoricalFreight(document);
    const imageAssetIds = new Set<string>();
    const snapshots = document.items.map((item) => {
      const snapshot = this.snapshotProductData(item.productDataSnapshot);
      if (
        typeof snapshot.categoryLeafNameEn !== 'string' ||
        snapshot.categoryLeafNameEn.trim().length === 0 ||
        snapshot.categoryLocale !== 'en-US' ||
        (snapshot.imageSnapshotStatus !== 'READY' && snapshot.imageSnapshotStatus !== 'NO_IMAGE')
      ) {
        throw this.historySnapshotError();
      }
      if (snapshot.imageSnapshotStatus === 'READY') {
        if (typeof snapshot.imageSnapshotAssetId !== 'string') throw this.historySnapshotError();
        imageAssetIds.add(snapshot.imageSnapshotAssetId);
      } else if (snapshot.imageSnapshotAssetId !== null) {
        throw this.historySnapshotError();
      }
      if (!item.skuSnapshot || !item.productNameSnapshot.trim()) throw this.historySnapshotError();
      return { item, snapshot };
    });
    for (const { item, snapshot } of snapshots) {
      if (snapshot.imageSnapshotStatus === 'NO_IMAGE') {
        this.logger.warn('quotation_calculator_excel.product_image_missing', {
          requestId: input.requestId,
          actorId: input.actorId,
          sourceType: input.sourceType,
          sourceId: document.id,
          lineNo: item.lineNo,
        });
      }
    }

    const imageAssets = imageAssetIds.size
      ? await this.prisma.fileAsset.findMany({
          where: {
            id: { in: [...imageAssetIds] },
            purpose: 'quotation-snapshot-image',
            status: 'ready',
            isPublic: false,
            storageKey: { startsWith: SNAPSHOT_PREFIX },
          },
          select: {
            id: true,
            storageKey: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            width: true,
            height: true,
          },
        })
      : [];
    const assetsById = new Map(imageAssets.map((asset) => [asset.id, asset]));
    const imageBuffers = new Map<string, CalculatorQuotationWorkbookItem['image']>();
    for (const assetId of imageAssetIds) {
      const asset = assetsById.get(assetId);
      if (!asset) throw this.historySnapshotError();
      let buffer: Buffer;
      try {
        buffer = await this.storage.get(asset.storageKey);
      } catch {
        throw this.historySnapshotError();
      }
      if (
        buffer.byteLength > QUOTATION_EXPORT_LIMITS.maxImageBytes ||
        BigInt(buffer.byteLength) !== asset.sizeBytes
      ) {
        throw this.historySnapshotError();
      }
      const detected = detectQuotationImage(buffer);
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      if (
        !detected ||
        detected.width * detected.height > QUOTATION_EXPORT_LIMITS.maxImagePixels ||
        !asset.sha256 ||
        sha256 !== asset.sha256 ||
        asset.width !== detected.width ||
        asset.height !== detected.height ||
        asset.mimeType !== (detected.extension === 'png' ? 'image/png' : 'image/jpeg')
      ) {
        throw this.historySnapshotError();
      }
      imageBuffers.set(assetId, {
        buffer,
        extension: detected.extension,
        width: detected.width,
        height: detected.height,
      });
    }
    let embeddedImageBytes = 0;
    for (const { snapshot } of snapshots) {
      if (snapshot.imageSnapshotStatus !== 'READY') continue;
      const assetId = snapshot.imageSnapshotAssetId;
      if (typeof assetId !== 'string') throw this.historySnapshotError();
      const image = imageBuffers.get(assetId);
      if (!image) throw this.historySnapshotError();
      embeddedImageBytes += image.buffer.byteLength;
      this.assertTotalImageBytes(embeddedImageBytes);
    }

    const exchangeRate = document.exchangeRate;
    if (!exchangeRate.gt(0) || !/^[A-Z]{3}$/.test(document.currencyCode)) {
      throw this.historySnapshotError();
    }
    const items: CalculatorQuotationWorkbookItem[] = snapshots.map(({ item, snapshot }) => {
      const unitPrice = item.unitSalePriceCny
        .times(exchangeRate)
        .toDecimalPlaces(2, Decimal.ROUND_CEIL);
      const lineTotal = unitPrice.times(item.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const assetId =
        typeof snapshot.imageSnapshotAssetId === 'string' ? snapshot.imageSnapshotAssetId : null;
      return {
        productId: `line-${item.lineNo}`,
        sku: item.skuSnapshot,
        englishName: item.productNameSnapshot,
        categoryLeafNameEn: snapshot.categoryLeafNameEn as string,
        quantity: item.quantity.toString(),
        unitPrice: unitPrice.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
        image: assetId ? (imageBuffers.get(assetId) ?? null) : null,
      };
    });
    const productSubtotal = items.reduce((sum, item) => sum.plus(item.lineTotal), new Decimal(0));
    const shippingCost = document.fees.reduce(
      (sum, fee) => sum.plus(fee.amountForeign),
      new Decimal(0),
    );
    const totalCost = productSubtotal.plus(shippingCost);
    const buffer = await this.buildWorkbook(input.template.buffer, {
      currencyCode: document.currencyCode,
      items,
      productSubtotal: productSubtotal.toFixed(2),
      shippingCost: shippingCost.toFixed(2),
      totalCost: totalCost.toFixed(2),
    });
    await this.recordExport({
      actorId: input.actorId,
      requestId: input.requestId,
      sourceType: input.sourceType,
      sourceId: document.id,
      template: input.template.option,
      currencyCode: document.currencyCode,
      itemCount: items.length,
      freightBillingMethod: document.freightBillingMethod,
      outputSize: buffer.byteLength,
    });
    return { buffer, filename: quotationFilename(document.currencyCode, new Date()) };
  }

  private async loadQuotation(id: string): Promise<HistoricalDocument> {
    const document = await this.prisma.quotation.findUnique({
      where: { id },
      select: {
        id: true,
        currencyCode: true,
        exchangeRate: true,
        freightBillingMethod: true,
        freightCurrencyCode: true,
        selectedFreightAmount: true,
        items: {
          orderBy: { lineNo: 'asc' },
          select: {
            lineNo: true,
            skuSnapshot: true,
            productNameSnapshot: true,
            quantity: true,
            unitSalePriceCny: true,
            productDataSnapshot: true,
          },
        },
        fees: {
          orderBy: { lineNo: 'asc' },
          select: { feeTypeCode: true, amountCny: true, amountForeign: true, isFreight: true },
        },
      },
    });
    if (!document) throw ApiError.notFound('Quotation not found.');
    return document;
  }

  private async loadOrder(id: string): Promise<HistoricalDocument> {
    const document = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        currencyCode: true,
        exchangeRate: true,
        freightBillingMethod: true,
        freightCurrencyCode: true,
        selectedFreightAmount: true,
        items: {
          orderBy: { lineNo: 'asc' },
          select: {
            lineNo: true,
            skuSnapshot: true,
            productNameSnapshot: true,
            quantity: true,
            unitSalePriceCny: true,
            productDataSnapshot: true,
          },
        },
        fees: {
          orderBy: { lineNo: 'asc' },
          select: { feeTypeCode: true, amountCny: true, amountForeign: true, isFreight: true },
        },
      },
    });
    if (!document) throw ApiError.notFound('Order not found.');
    return document;
  }

  private async loadTemplate(templateId: string): Promise<LoadedCalculatorTemplate> {
    const template = await this.prisma.quoteTemplate.findUnique({ where: { id: templateId } });
    const report = (template?.validationReport as Record<string, unknown> | null) ?? null;
    if (
      !template ||
      template.templateType !== 'calculator_quote' ||
      template.status !== 'active' ||
      template.sheetName !== 'Quotation' ||
      report?.requiredFieldsPresent !== true
    ) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'Select an active, validated calculator quotation template.',
        {
          status: 422,
        },
      );
    }
    const asset = await this.prisma.fileAsset.findUnique({
      where: { storageKey: template.storageKey },
      select: { id: true, storageKey: true, status: true, isPublic: true, purpose: true },
    });
    if (
      !asset ||
      asset.status !== 'ready' ||
      asset.isPublic ||
      asset.purpose !== 'quote-template'
    ) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The selected private template file is unavailable.',
        {
          status: 422,
        },
      );
    }
    let buffer: Buffer;
    try {
      buffer = await this.storage.get(template.storageKey);
    } catch {
      throw new ApiError(
        ERROR_CODES.storageUnavailable,
        'The selected quotation template could not be read.',
      );
    }
    try {
      const inspection = await inspectCalculatorQuoteTemplateWorkbook(buffer);
      if (!inspection.requiredFieldsPresent) throw this.invalidTemplate();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw this.invalidTemplate();
    }
    return {
      option: { id: template.id, name: template.name, version: template.version },
      buffer,
    };
  }

  private async readCurrentProductImage(
    image: {
      storageKey: string;
      asset: { storageKey: string; status: string; isPublic: boolean; purpose: string } | null;
    } | null,
  ): Promise<CalculatorQuotationWorkbookItem['image']> {
    if (!image) return null;
    const storageKey = image.asset?.storageKey ?? image.storageKey;
    // Product source images are publication-approved (isPublic=true), while
    // the product-image/ key still routes the original object to private storage.
    if (
      !isManagedProductImageKey(storageKey) ||
      (image.asset !== null &&
        (image.asset.status !== 'ready' ||
          !image.asset.isPublic ||
          image.asset.purpose !== 'product-image'))
    ) {
      throw new ApiError(
        ERROR_CODES.quotationExportImageUnavailable,
        'A product image could not be read safely.',
      );
    }
    let buffer: Buffer;
    try {
      buffer = await this.storage.get(storageKey);
    } catch {
      throw new ApiError(
        ERROR_CODES.quotationExportImageUnavailable,
        'A product image could not be read safely.',
      );
    }
    if (buffer.byteLength > QUOTATION_EXPORT_LIMITS.maxImageBytes) {
      throw new ApiError(
        ERROR_CODES.quotationExportImageUnavailable,
        'A product image exceeds the export size limit.',
      );
    }
    const detected = detectQuotationImage(buffer);
    if (!detected || detected.width * detected.height > QUOTATION_EXPORT_LIMITS.maxImagePixels) {
      throw new ApiError(
        ERROR_CODES.quotationExportImageUnavailable,
        'A product image is not a supported, valid PNG/JPEG file.',
      );
    }
    return {
      buffer,
      extension: detected.extension,
      width: detected.width,
      height: detected.height,
    };
  }

  private async buildWorkbook(
    templateBuffer: Buffer,
    input: Omit<Parameters<typeof buildCalculatorQuotationWorkbook>[0], 'templateBuffer'>,
  ): Promise<Buffer> {
    try {
      return await buildCalculatorQuotationWorkbook({ templateBuffer, ...input });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw this.invalidTemplate();
    }
  }

  private assertHistoricalFreight(document: HistoricalDocument): void {
    const freightRows = document.fees.filter((fee) => fee.isFreight);
    if (
      !document.freightBillingMethod ||
      document.freightCurrencyCode !== 'CNY' ||
      !document.selectedFreightAmount ||
      freightRows.length !== 1 ||
      !freightRows[0]!.amountCny.eq(document.selectedFreightAmount) ||
      document.items.length === 0
    ) {
      throw this.historySnapshotError();
    }
  }

  private snapshotProductData(value: Prisma.JsonValue): SnapshotProductData {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return value as SnapshotProductData;
  }

  private assertTotalImageBytes(total: number): void {
    if (total > QUOTATION_EXPORT_LIMITS.maxTotalImageBytes) {
      throw new ApiError(
        ERROR_CODES.quotationExportImageUnavailable,
        'The selected product images exceed the export size limit.',
      );
    }
  }

  private async recordExport(input: {
    actorId: string;
    requestId: string;
    sourceType: 'current_calculation' | 'quotation' | 'order';
    sourceId: string | null;
    template: CalculatorTemplateOption;
    currencyCode: string;
    itemCount: number;
    freightBillingMethod: 'CBM' | 'KG' | null;
    outputSize: number;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'QUOTATION_EXCEL_EXPORTED',
        entityType: 'quotation_calculator_excel_export',
        entityId: input.sourceId,
        requestId: input.requestId,
        metadata: {
          sourceType: input.sourceType,
          templateId: input.template.id,
          templateVersion: input.template.version,
          currencyCode: input.currencyCode,
          itemCount: input.itemCount,
          freightBillingMethod: input.freightBillingMethod,
          outputFileSize: input.outputSize,
          requestId: input.requestId,
          outcome: 'SUCCEEDED',
        },
      },
    });
    this.logger.info('quotation_calculator_excel_export.completed', {
      requestId: input.requestId,
      actorId: input.actorId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      templateId: input.template.id,
      templateVersion: input.template.version,
      itemCount: input.itemCount,
      currencyCode: input.currencyCode,
      freightBillingMethod: input.freightBillingMethod,
      outputSize: input.outputSize,
    });
  }

  private validationError(message: string): ApiError {
    return new ApiError(ERROR_CODES.quotationExportValidationFailed, message, { status: 422 });
  }

  private historySnapshotError(): ApiError {
    return new ApiError(
      ERROR_CODES.quotationExportSnapshotMissing,
      'The saved quotation or order is missing historical product or freight snapshots required for Excel export.',
      { status: 422 },
    );
  }

  private invalidTemplate(): ApiError {
    return new ApiError(
      ERROR_CODES.quoteTemplateInvalid,
      'The calculator quotation template is invalid.',
      {
        status: 422,
      },
    );
  }
}

export type QuotationCalculatorExcelExportBody = QuotationCalculatorExcelExportInput;
export type QuotationHistoryExcelExportBody = QuotationHistoryExcelExportInput;
