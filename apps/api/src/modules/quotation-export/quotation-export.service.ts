import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  PUBLIC_LOCALE,
  QUOTATION_EXPORT_CURRENCIES,
  QUOTATION_EXPORT_LIMITS,
  type QuotationExportConfig,
  type QuotationExportPricingPreview,
  type QuotationExportProduct,
  type QuotationExportProductList,
  type QuotationExportTemplateOption,
  type QuotationExportValidationIssue,
} from '@b2b/contracts';
import type {
  QuotationExportInput,
  QuotationExportPreviewInput,
  QuotationExportProductListQueryInput,
} from '@b2b/validation';
import type { Prisma, QuoteTemplate } from '@b2b/database';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { isManagedProductImageKey } from '../products/product-image-policy';
import {
  QuoteTemplateParseError,
  inspectQuoteTemplateWorkbook,
} from '../quote/quote-template-parser';
import {
  QuotationCalculationError,
  assertQuotationExchangeRate,
  calculateQuotationUnitPrice,
} from './quotation-calculator';
import { detectQuotationImage } from './quotation-image';
import {
  QuotationTemplateWorkbookError,
  buildQuotationWorkbookFromTemplate,
} from './quotation-template-workbook';
import {
  quotationFilename,
  type QuotationWorkbookProduct,
} from './quotation-workbook';

type ProductRow = Prisma.ProductGetPayload<{
  include: {
    translations: true;
    category: { include: { translations: true } };
    images: { include: { asset: true } };
  };
}>;

interface ValidatedProduct {
  productId: string;
  sku: string;
  englishName: string;
  costCny: string;
  cartonQuantity: number;
  cartonDimensions: string;
  cartonGrossWeightKg: string;
  size: string;
  weightGrams: number | null;
  packaging: string | null;
  category: string | null;
  lifecycleStatus: string;
  imageStorageKey: string;
  imageWidth: number | null;
  imageHeight: number | null;
}

type ProductQuoteTemplate = QuoteTemplate;

interface PreparedQuotation {
  products: ValidatedProduct[];
  prices: Map<string, string>;
  errors: QuotationExportValidationIssue[];
  currencyCode: QuotationExportPreviewInput['currencyCode'];
  markupPercent: string;
  exchangeRate: string;
}

const PRODUCT_INCLUDE = {
  translations: true,
  category: { include: { translations: true } },
  images: {
    include: { asset: true },
    orderBy: [{ isCover: 'desc' as const }, { sortOrder: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class QuotationExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly storage: StorageService,
    private readonly logger: JsonLogger,
  ) {}

  config(): QuotationExportConfig {
    return {
      currencies: [...QUOTATION_EXPORT_CURRENCIES],
      defaultMarkupPercent: '15',
      maxProducts: QUOTATION_EXPORT_LIMITS.maxProducts,
      exchangeRateBase: 'CNY',
      rounding: 'CEIL_2',
    };
  }

  async listTemplates(): Promise<QuotationExportTemplateOption[]> {
    const templates = await this.prisma.quoteTemplate.findMany({
      where: { templateType: 'product_quote', status: 'active' },
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
      select: { storageKey: true, originalName: true },
    });
    const namesByKey = new Map(assets.map((asset) => [asset.storageKey, asset.originalName]));
    return exportable.flatMap((template) => {
      const fileName = namesByKey.get(template.storageKey);
      if (fileName === undefined) return [];
      return [{
        id: template.id,
        name: template.name,
        version: template.version,
        fileName,
        sheetName: template.sheetName,
        status: 'active' as const,
      }];
    });
  }

  async listProducts(
    query: QuotationExportProductListQueryInput,
    canExportUnpublished: boolean,
    canReadCost: boolean,
  ): Promise<QuotationExportProductList> {
    const categoryIds = await this.categories.resolveAdminCategoryScope(
      query.categoryId,
      query.includeDescendants,
    );
    if (!categoryIds) {
      throw ApiError.validation('The selected category does not exist.', {
        categoryId: 'quotation.validation.categoryMissing',
      });
    }

    const where: Prisma.ProductWhereInput = {
      categoryId: { in: categoryIds },
      lifecycleStatus: { not: 'DISCONTINUED' },
      ...(canExportUnpublished ? {} : { publishStatus: 'PUBLISHED' }),
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' as const } },
              {
                translations: {
                  some: {
                    locale: PUBLIC_LOCALE,
                    name: { contains: query.search, mode: 'insensitive' as const },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [totalCount, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ sku: 'asc' as const }, { id: 'asc' as const }],
        take: QUOTATION_EXPORT_LIMITS.maxProducts,
      }),
    ]);
    const paths = await this.categoryPaths(query.locale);

    return {
      items: products.map((product) =>
        this.toProductSummary(product, paths, canExportUnpublished, canReadCost),
      ),
      totalCount,
      limitExceeded: totalCount > QUOTATION_EXPORT_LIMITS.maxProducts,
      maxProducts: QUOTATION_EXPORT_LIMITS.maxProducts,
    };
  }

  async preview(
    input: QuotationExportPreviewInput,
    canExportUnpublished: boolean,
  ): Promise<QuotationExportPricingPreview> {
    const prepared = await this.prepare(input, canExportUnpublished);
    return {
      currencyCode: prepared.currencyCode,
      markupPercent: prepared.markupPercent,
      exchangeRate: prepared.exchangeRate,
      itemCount: prepared.products.length,
      items: prepared.products.map((product) => ({
        productId: product.productId,
        sku: product.sku,
        finalUnitPrice: prepared.prices.get(product.productId) ?? '0.00',
        currencyCode: prepared.currencyCode,
      })),
      warnings: [],
      errors: prepared.errors,
    };
  }

  async export(
    input: QuotationExportInput,
    canExportUnpublished: boolean,
    actorId: string,
    requestId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const template = await this.loadProductQuoteTemplate(input.templateId);
    const prepared = await this.prepare(
      {
        ...input,
        ...input.pricing,
      },
      canExportUnpublished,
    );
    if (prepared.errors.length > 0) throw this.validationError(prepared.errors);
    if (prepared.products.length === 0) {
      throw ApiError.validation('Select at least one product.', {
        productIds: 'quotation.validation.noProducts',
      });
    }

    const templateFile = await this.readAndInspectTemplate(template);
    const imageProducts = await this.readOriginalImages(prepared.products);
    const workbookProducts: QuotationWorkbookProduct[] = prepared.products.map((product) => {
      const image = imageProducts.get(product.productId);
      if (!image) {
        throw new ApiError(
          ERROR_CODES.quotationExportImageUnavailable,
          'A product image could not be read. No quotation file was generated.',
        );
      }
      return {
        productId: product.productId,
        sku: product.sku,
        englishName: product.englishName,
        unitPrice: prepared.prices.get(product.productId) ?? '0.00',
        cartonQuantity: product.cartonQuantity,
        cartonDimensions: product.cartonDimensions,
        cartonGrossWeightKg: product.cartonGrossWeightKg,
        size: product.size,
        weightGrams: product.weightGrams,
        packaging: product.packaging,
        category: product.category,
        lifecycleStatus: product.lifecycleStatus,
        image,
      };
    });

    const generatedAt = new Date();
    let buffer: Buffer;
    try {
      buffer = await buildQuotationWorkbookFromTemplate({
        templateBuffer: templateFile.buffer,
        sheetName: templateFile.inspection.sheetName,
        headerRow: templateFile.inspection.headerRow,
        itemStartRow: templateFile.inspection.itemStartRow,
        fieldMapping: templateFile.inspection.fieldMapping,
        header: input.header,
        currencyCode: prepared.currencyCode,
        markupPercent: prepared.markupPercent,
        exchangeRate: prepared.exchangeRate,
        products: workbookProducts,
        generatedAt,
      });
    } catch (error) {
      if (!(error instanceof QuotationTemplateWorkbookError)) throw error;
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'The selected quotation template cannot be filled.',
        { status: 422, details: { reason: error.reason } },
      );
    }

    // Strict persistence: unlike the general audit helper, this write must
    // succeed before a customer-facing file can be returned (docs/36 §9).
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'QUOTATION_EXCEL_EXPORTED',
        entityType: 'quotation_export',
        entityId: input.categoryId,
        requestId,
        metadata: {
          actorId,
          templateId: template.id,
          templateVersion: template.version,
          templateSheetName: templateFile.inspection.sheetName,
          categoryId: input.categoryId,
          selectedProductCount: prepared.products.length,
          currencyCode: prepared.currencyCode,
          markupPercent: prepared.markupPercent,
          exchangeRate: prepared.exchangeRate,
          generatedAt: generatedAt.toISOString(),
          outputFileSize: buffer.byteLength,
          requestId,
          outcome: 'SUCCEEDED',
        },
      },
    });

    this.logger.info('quotation_export.completed', {
      requestId,
      actorId,
      templateId: template.id,
      templateVersion: template.version,
      productCount: prepared.products.length,
      currencyCode: prepared.currencyCode,
      outputFileSize: buffer.byteLength,
      durationTarget: 'sync',
    });
    return { buffer, filename: quotationFilename(prepared.currencyCode, generatedAt) };
  }

  private async loadProductQuoteTemplate(templateId: string): Promise<ProductQuoteTemplate> {
    const template = await this.prisma.quoteTemplate.findUnique({ where: { id: templateId } });
    const report = (template?.validationReport as Record<string, unknown> | null) ?? null;
    if (
      !template ||
      template.templateType !== 'product_quote' ||
      template.status !== 'active' ||
      !template.sheetName ||
      report?.requiredFieldsPresent !== true
    ) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'Select an active, validated product quotation template.',
        { status: 422, details: { reason: 'TEMPLATE_NOT_EXPORTABLE' } },
      );
    }

    const asset = await this.prisma.fileAsset.findUnique({
      where: { storageKey: template.storageKey },
      select: { storageKey: true, status: true, isPublic: true, purpose: true },
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
        { status: 422, details: { reason: 'TEMPLATE_FILE_UNAVAILABLE' } },
      );
    }
    return template;
  }

  private async readAndInspectTemplate(template: ProductQuoteTemplate) {
    let buffer: Buffer;
    try {
      buffer = await this.storage.get(template.storageKey);
    } catch {
      throw new ApiError(
        ERROR_CODES.storageUnavailable,
        'The selected quotation template could not be read. No file was generated.',
      );
    }

    try {
      const inspection = await inspectQuoteTemplateWorkbook(buffer, {
        templateType: 'product_quote',
        sheetName: template.sheetName,
        headerRow: template.headerRow,
        itemStartRow: template.itemStartRow,
      });
      if (!inspection.requiredFieldsPresent) {
        throw new ApiError(
          ERROR_CODES.quoteTemplateInvalid,
          'The selected quotation template no longer has a valid structure.',
          { status: 422, details: { reason: 'TEMPLATE_STRUCTURE_INVALID' } },
        );
      }
      return { buffer, inspection };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (!(error instanceof QuoteTemplateParseError)) throw error;
      throw new ApiError(ERROR_CODES.quoteTemplateInvalid, error.message, {
        status: 422,
        details: error.details,
      });
    }
  }

  private async prepare(
    input: QuotationExportPreviewInput,
    canExportUnpublished: boolean,
  ): Promise<PreparedQuotation> {
    if (input.productIds.length > QUOTATION_EXPORT_LIMITS.maxProducts) {
      throw this.validationError([
        {
          productId: null,
          sku: null,
          field: 'productIds',
          code: 'TOO_MANY_PRODUCTS',
          messageKey: 'quotation.errors.tooManyProducts',
        },
      ]);
    }
    try {
      assertQuotationExchangeRate(input.currencyCode, input.exchangeRate);
    } catch (error) {
      if (!(error instanceof QuotationCalculationError)) throw error;
      throw new ApiError(
        ERROR_CODES.quotationExportPricingInvalid,
        'The quotation currency or exchange rate is invalid.',
        { details: { field: error.field, reason: error.code } },
      );
    }

    const categoryIds = await this.categories.resolveAdminCategoryScope(
      input.categoryId,
      input.includeDescendants,
    );
    if (!categoryIds) {
      throw this.validationError([
        {
          productId: null,
          sku: null,
          field: 'categoryId',
          code: 'CATEGORY_NOT_FOUND',
          messageKey: 'quotation.errors.categoryMissing',
        },
      ]);
    }

    const rows = await this.prisma.product.findMany({
      where: { id: { in: input.productIds } },
      include: PRODUCT_INCLUDE,
    });
    const byId = new Map(rows.map((product) => [product.id, product]));
    const scope = new Set(categoryIds);
    const products: ValidatedProduct[] = [];
    const prices = new Map<string, string>();
    const errors: QuotationExportValidationIssue[] = [];

    for (const productId of input.productIds) {
      const product = byId.get(productId);
      if (!product) {
        errors.push({
          productId,
          sku: null,
          field: 'productIds',
          code: 'PRODUCT_NOT_FOUND',
          messageKey: 'quotation.errors.productNotFound',
        });
        continue;
      }
      if (!product.categoryId || !scope.has(product.categoryId)) {
        errors.push(this.issue(product, 'categoryId', 'PRODUCT_NOT_IN_CATEGORY'));
        continue;
      }

      const productIssues = this.validateProduct(product, canExportUnpublished);
      errors.push(...productIssues);
      if (productIssues.length > 0 || product.priceCny === null) continue;

      const costCny = product.priceCny.toString();
      let unitPrice: string;
      try {
        unitPrice = calculateQuotationUnitPrice({
          costCny,
          markupPercent: input.markupPercent,
          exchangeRate: input.exchangeRate,
        });
      } catch (error) {
        if (!(error instanceof QuotationCalculationError)) throw error;
        throw new ApiError(
          ERROR_CODES.quotationExportPricingInvalid,
          'The quotation pricing configuration is invalid.',
          { details: { field: error.field, reason: error.code } },
        );
      }
      const cover = this.coverImage(product);
      if (!cover) continue;
      products.push({
        productId: product.id,
        sku: product.sku,
        englishName: this.englishName(product) ?? '',
        costCny,
        cartonQuantity: product.cartonQuantity ?? 0,
        cartonDimensions: this.cartonDimensions(product),
        cartonGrossWeightKg: product.cartonWeightKg?.toString() ?? '',
        size: this.productSize(product),
        weightGrams: product.weightGrams,
        packaging: product.packaging,
        category:
          product.category?.translations.find(
            (translation) => translation.locale === PUBLIC_LOCALE,
          )?.name ?? null,
        lifecycleStatus: product.lifecycleStatus,
        imageStorageKey: cover.asset?.storageKey ?? cover.storageKey,
        imageWidth: cover.asset?.width ?? cover.width,
        imageHeight: cover.asset?.height ?? cover.height,
      });
      prices.set(product.id, unitPrice);
    }

    return {
      products,
      prices,
      errors,
      currencyCode: input.currencyCode,
      markupPercent: input.markupPercent,
      exchangeRate: input.exchangeRate,
    };
  }

  private validateProduct(
    product: ProductRow,
    canExportUnpublished: boolean,
  ): QuotationExportValidationIssue[] {
    const issues: QuotationExportValidationIssue[] = [];
    if (
      product.lifecycleStatus === 'DISCONTINUED' ||
      (!canExportUnpublished && product.publishStatus !== 'PUBLISHED')
    ) {
      issues.push(this.issue(product, 'publishStatus', 'PRODUCT_NOT_EXPORTABLE'));
    }
    if (product.priceCny === null || product.priceCny.lte(0)) {
      // Keep database column names out of API responses. The stable validation
      // field is the customer-facing concept that the Admin UI can localize.
      issues.push(this.issue(product, 'cost', 'MISSING_COST'));
    }
    if (!this.englishName(product)) {
      issues.push(this.issue(product, 'englishName', 'MISSING_ENGLISH_NAME'));
    }

    const usableImages = product.images.filter((image) => image.deleteState === 'READY');
    if (usableImages.length === 0) {
      issues.push(this.issue(product, 'image', 'MISSING_PRIMARY_IMAGE'));
    } else {
      const cover = this.coverImage(product);
      const key = cover ? (cover.asset?.storageKey ?? cover.storageKey) : null;
      if (
        !cover ||
        !key ||
        !isManagedProductImageKey(key) ||
        (cover.asset !== null && cover.asset.status !== 'ready')
      ) {
        issues.push(this.issue(product, 'image', 'IMAGE_NOT_READY'));
      }
    }

    if (product.cartonQuantity === null || product.cartonQuantity <= 0) {
      issues.push(this.issue(product, 'cartonQuantity', 'INVALID_CARTON_QUANTITY'));
    }
    const dimensions = [product.cartonLengthCm, product.cartonWidthCm, product.cartonHeightCm];
    const populated = dimensions.filter((value) => value !== null).length;
    if (populated !== 0 && (populated !== 3 || dimensions.some((value) => (value ?? 0) <= 0))) {
      issues.push(this.issue(product, 'cartonDimensions', 'INVALID_CARTON_DIMENSIONS'));
    }
    if (product.cartonWeightKg === null || product.cartonWeightKg.lte(0)) {
      issues.push(this.issue(product, 'cartonWeightKg', 'INVALID_CARTON_WEIGHT'));
    }
    return issues;
  }

  private issue(product: ProductRow, field: string, code: string): QuotationExportValidationIssue {
    const keys: Record<string, string> = {
      PRODUCT_NOT_IN_CATEGORY: 'quotation.errors.productOutsideCategory',
      PRODUCT_NOT_EXPORTABLE: 'quotation.errors.productNotExportable',
      MISSING_COST: 'quotation.errors.missingCost',
      MISSING_ENGLISH_NAME: 'quotation.errors.missingEnglishName',
      MISSING_PRIMARY_IMAGE: 'quotation.errors.missingPrimaryImage',
      IMAGE_NOT_READY: 'quotation.errors.imageNotReady',
      INVALID_CARTON_QUANTITY: 'quotation.errors.invalidCartonQuantity',
      INVALID_CARTON_DIMENSIONS: 'quotation.errors.invalidCartonDimensions',
      INVALID_CARTON_WEIGHT: 'quotation.errors.invalidCartonWeight',
    };
    return {
      productId: product.id,
      sku: product.sku,
      field,
      code,
      messageKey: keys[code] ?? 'quotation.errors.productInvalid',
    };
  }

  private validationError(errors: QuotationExportValidationIssue[]): ApiError {
    return new ApiError(
      ERROR_CODES.quotationExportValidationFailed,
      'One or more selected products cannot be exported. No file was generated.',
      { details: { errors } },
    );
  }

  private englishName(product: ProductRow): string | null {
    const value = product.translations
      .find((translation) => translation.locale === PUBLIC_LOCALE)
      ?.name.trim();
    return value ? value : null;
  }

  private coverImage(product: ProductRow): ProductRow['images'][number] | null {
    return (
      product.images
        .filter((image) => image.deleteState === 'READY')
        .sort(
          (left, right) =>
            Number(right.isCover) - Number(left.isCover) ||
            left.sortOrder - right.sortOrder ||
            left.id.localeCompare(right.id),
        )[0] ?? null
    );
  }

  private cartonDimensions(product: ProductRow): string {
    if (
      product.cartonLengthCm === null ||
      product.cartonWidthCm === null ||
      product.cartonHeightCm === null
    ) {
      return '-';
    }
    return `${product.cartonLengthCm} × ${product.cartonWidthCm} × ${product.cartonHeightCm} cm`;
  }

  private productSize(product: ProductRow): string {
    if (
      product.lengthMm === null ||
      product.lengthMm === undefined ||
      product.widthMm === null ||
      product.widthMm === undefined ||
      product.heightMm === null ||
      product.heightMm === undefined
    ) {
      return '-';
    }
    return `${product.lengthMm} × ${product.widthMm} × ${product.heightMm} mm`;
  }

  private toProductSummary(
    product: ProductRow,
    paths: Map<string, string>,
    canExportUnpublished: boolean,
    canReadCost: boolean,
  ): QuotationExportProduct {
    const cover = this.coverImage(product);
    const coverKey = cover ? (cover.asset?.storageKey ?? cover.storageKey) : null;
    const hasOriginalImage = Boolean(
      cover &&
      coverKey &&
      isManagedProductImageKey(coverKey) &&
      (cover.asset === null || cover.asset.status === 'ready'),
    );
    const hasCost = product.priceCny !== null && product.priceCny.gt(0);
    return {
      id: product.id,
      sku: product.sku,
      englishName: this.englishName(product),
      categoryPath: product.categoryId ? (paths.get(product.categoryId) ?? null) : null,
      // Legacy rows without FileAsset metadata still remain exportable, but
      // their storage key is not exposed in this API response. Authenticated
      // previews are available only for assets that have an opaque asset id.
      thumbnailUrl:
        cover?.fileAssetId && hasOriginalImage
          ? this.storage.adminProductImageUrl(cover.fileAssetId)
          : null,
      hasCost,
      costCny: canReadCost && hasCost ? (product.priceCny?.toString() ?? null) : null,
      hasOriginalImage,
      cartonQuantity: product.cartonQuantity,
      cartonDimensions:
        product.cartonLengthCm !== null &&
        product.cartonWidthCm !== null &&
        product.cartonHeightCm !== null
          ? this.cartonDimensions(product)
          : null,
      cartonGrossWeightKg: product.cartonWeightKg?.toString() ?? null,
      eligibilityCodes: this.validateProduct(product, canExportUnpublished).map(
        (issue) => issue.code,
      ),
    };
  }

  private async categoryPaths(locale: string): Promise<Map<string, string>> {
    const all = await this.prisma.category.findMany({
      select: {
        id: true,
        parentId: true,
        translations: { select: { locale: true, name: true } },
      },
    });
    const byId = new Map(all.map((category) => [category.id, category]));
    const paths = new Map<string, string>();
    const resolve = (id: string, seen = new Set<string>()): string => {
      if (paths.has(id)) return paths.get(id) ?? '';
      const current = byId.get(id);
      if (!current || seen.has(id)) return '';
      seen.add(id);
      const own =
        current.translations.find((translation) => translation.locale === locale)?.name ??
        current.translations.find((translation) => translation.locale === PUBLIC_LOCALE)?.name ??
        '';
      const parent = current.parentId ? resolve(current.parentId, seen) : '';
      const path = [parent, own].filter(Boolean).join(' / ');
      paths.set(id, path);
      return path;
    };
    for (const category of all) resolve(category.id);
    return paths;
  }

  private async readOriginalImages(
    products: ValidatedProduct[],
  ): Promise<Map<string, QuotationWorkbookProduct['image']>> {
    const results = new Map<string, QuotationWorkbookProduct['image']>();
    let totalBytes = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < products.length) {
        const product = products[cursor++];
        if (!product) break;
        let buffer: Buffer;
        try {
          buffer = await this.storage.get(product.imageStorageKey);
        } catch {
          throw new ApiError(
            ERROR_CODES.quotationExportImageUnavailable,
            'A product image could not be read. No quotation file was generated.',
          );
        }
        if (buffer.byteLength > QUOTATION_EXPORT_LIMITS.maxImageBytes) {
          throw new ApiError(
            ERROR_CODES.quotationExportImageUnavailable,
            'A product image exceeds the quotation export size limit.',
          );
        }
        totalBytes += buffer.byteLength;
        if (totalBytes > QUOTATION_EXPORT_LIMITS.maxTotalImageBytes) {
          throw new ApiError(
            ERROR_CODES.quotationExportImageUnavailable,
            'The selected product images exceed the quotation export size limit.',
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
        results.set(product.productId, {
          buffer,
          extension: detected.extension,
          width: detected.width,
          height: detected.height,
        });
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(QUOTATION_EXPORT_LIMITS.imageReadConcurrency, products.length) },
        worker,
      ),
    );
    return results;
  }
}
