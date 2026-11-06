import { createHash } from 'node:crypto';
import {
  ERROR_CODES,
  PERMISSIONS,
  PRODUCT_IMAGE_LIMITS,
  PUBLIC_LOCALE,
  QUOTATION_EXPORT_LIMITS,
} from '@b2b/contracts';
import type { Prisma, PrismaClient } from '@b2b/database';
import { quotationExportSchema, type QuotationExportInput } from '@b2b/validation';
import {
  buildQuotationWorkbookFromTemplate,
  detectQuotationImage,
  inspectQuoteTemplateWorkbook,
  quotationFilename,
  type QuotationWorkbookProduct,
} from '@b2b/quotation-workbook';
import Decimal from 'decimal.js';
import sharp from 'sharp';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';

const PRODUCT_INCLUDE = {
  translations: true,
  category: { include: { translations: true } },
  images: {
    include: { asset: true },
    orderBy: [{ isCover: 'desc' as const }, { sortOrder: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.ProductInclude;

export async function processProductQuotationExport(
  jobId: string,
  templateId: string,
  templateVersion: number,
  rawInput: unknown,
  deps: { prisma: PrismaClient; storage: ObjectStorage; logger: WorkerLogger },
): Promise<{ fileKey: string; productCount: number }> {
  const { prisma, storage, logger } = deps;
  const job = await prisma.quoteExportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('JOB_NOT_FOUND');
  const input = parseInput(rawInput);
  if (input.templateId !== templateId) throw new Error('QUOTATION_EXPORT_INPUT_INVALID');
  const operator = await prisma.adminUser.findUnique({
    where: { id: job.requestedById },
    select: {
      status: true,
      userRoles: { select: { role: { select: { code: true, permissions: true } } } },
    },
  });
  if (!operator || operator.status !== 'ACTIVE') throw new Error('EXPORT_OPERATOR_UNAVAILABLE');
  const roles = operator.userRoles.map((entry) => entry.role.code);
  const permissionCodes = new Set(
    operator.userRoles.flatMap((entry) =>
      entry.role.permissions.map((permission) => permission.permissionCode),
    ),
  );
  if (!roles.includes('super_admin') && !permissionCodes.has(PERMISSIONS.quotationExportCreate)) {
    throw new Error('EXPORT_OPERATOR_UNAUTHORIZED');
  }
  const canExportUnpublished =
    roles.includes('super_admin') || permissionCodes.has(PERMISSIONS.quotationExportUnpublished);

  const template = await prisma.quoteTemplate.findUnique({ where: { id: templateId } });
  if (
    !template ||
    template.templateType !== 'product_quote' ||
    template.status !== 'active' ||
    template.version !== templateVersion ||
    !template.sheetName
  ) {
    throw new Error('QUOTE_TEMPLATE_INVALID');
  }
  const templateAsset = await prisma.fileAsset.findUnique({
    where: { storageKey: template.storageKey },
    select: { purpose: true, status: true, isPublic: true },
  });
  if (
    !templateAsset ||
    templateAsset.purpose !== 'quote-template' ||
    templateAsset.status !== 'ready' ||
    templateAsset.isPublic
  ) {
    throw new Error('QUOTE_TEMPLATE_FILE_UNAVAILABLE');
  }

  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: {
      enabled: true,
      translations: { select: { locale: true, name: true } },
    },
  });
  const material = category?.translations.find(
    (translation) => translation.locale === PUBLIC_LOCALE,
  )?.name;
  if (!category?.enabled || !material?.trim()) throw new Error('QUOTATION_CATEGORY_INVALID');

  const categoryIds = await resolveCategoryIds(prisma, input.categoryId, input.includeDescendants);
  const rows = await prisma.product.findMany({
    where: { id: { in: input.productIds } },
    include: PRODUCT_INCLUDE,
  });
  const byId = new Map(rows.map((product) => [product.id, product]));
  const categoryScope = new Set(categoryIds);
  const markupByProduct = new Map(
    (input.pricing.productMarkups ?? []).map((item) => [item.productId, item.markupPercent]),
  );
  const currency = await prisma.dictionaryItem.findFirst({
    where: {
      code: input.pricing.currencyCode,
      enabled: true,
      type: { code: 'currency', enabled: true },
    },
    select: { id: true },
  });
  if (!currency) throw new Error('QUOTATION_CURRENCY_INVALID');
  const exchangeRate = decimal(input.pricing.exchangeRate, 'QUOTATION_EXCHANGE_RATE_INVALID');
  if (exchangeRate.lte(0) || (input.pricing.currencyCode === 'CNY' && !exchangeRate.eq(1))) {
    throw new Error('QUOTATION_EXCHANGE_RATE_INVALID');
  }

  const generatedAt = new Date();
  const workbookProducts: QuotationWorkbookProduct[] = [];
  const imageRows = new Map<
    string,
    { key: string; sizeBytes: bigint | null; assetId: string | null }
  >();
  for (const productId of input.productIds) {
    const product = byId.get(productId);
    if (!product || !product.categoryId || !categoryScope.has(product.categoryId)) {
      throw new Error('QUOTATION_PRODUCT_SCOPE_INVALID');
    }
    if (
      product.lifecycleStatus === 'DISCONTINUED' ||
      (!canExportUnpublished && product.publishStatus !== 'PUBLISHED') ||
      product.priceCny === null ||
      !product.priceCny.gt(0) ||
      (product.cartonQuantity !== null && product.cartonQuantity <= 0)
    ) {
      throw new Error('QUOTATION_EXPORT_VALIDATION_FAILED');
    }
    const englishName = product.translations
      .find((translation) => translation.locale === PUBLIC_LOCALE)
      ?.name.trim();
    if (!englishName) throw new Error('QUOTATION_EXPORT_VALIDATION_FAILED');
    const cover = product.images.find((image) => image.deleteState === 'READY');
    const imageKey = cover?.asset?.storageKey ?? cover?.storageKey;
    if (
      !cover ||
      !isManagedImageKey(imageKey) ||
      (cover.asset !== null &&
        (cover.asset.status !== 'ready' ||
          !cover.asset.isPublic ||
          cover.asset.purpose !== 'product-image'))
    ) {
      throw new Error('QUOTATION_EXPORT_IMAGE_UNAVAILABLE');
    }
    const perProductMarkup = markupByProduct.get(productId) ?? input.pricing.markupPercent;
    const markup = decimal(perProductMarkup, 'QUOTATION_PRICING_INVALID');
    if (markup.lt(0) || markup.gt(500)) throw new Error('QUOTATION_PRICING_INVALID');
    const unitPrice = product.priceCny
      .times(new Decimal(1).plus(markup.dividedBy(100)))
      .times(exchangeRate)
      .toDecimalPlaces(2, Decimal.ROUND_CEIL);
    const productSize =
      product.lengthMm !== null && product.widthMm !== null && product.heightMm !== null
        ? `${product.lengthMm} × ${product.widthMm} × ${product.heightMm} mm`
        : '-';
    const cartonDimensions =
      product.cartonLengthCm !== null &&
      product.cartonWidthCm !== null &&
      product.cartonHeightCm !== null
        ? `${product.cartonLengthCm.toString()} × ${product.cartonWidthCm.toString()} × ${product.cartonHeightCm.toString()} cm`
        : '-';
    const categoryName = product.category?.translations.find(
      (translation) => translation.locale === PUBLIC_LOCALE,
    )?.name;
    workbookProducts.push({
      productId,
      sku: product.sku,
      englishName,
      unitPrice: unitPrice.toFixed(2),
      cartonQuantity: product.cartonQuantity,
      cartonDimensions,
      cartonGrossWeightKg: product.cartonWeightKg?.toString() ?? '',
      size: productSize,
      weightGrams: product.weightGrams,
      packaging: product.packaging,
      category: categoryName ?? null,
      lifecycleStatus: product.lifecycleStatus,
      image: { buffer: Buffer.alloc(0), extension: 'jpeg', width: null, height: null },
    });
    imageRows.set(productId, {
      key: imageKey,
      sizeBytes: cover.asset?.sizeBytes ?? cover.sizeBytes,
      assetId: cover.fileAssetId,
    });
  }
  const defaultMarkup = decimal(input.pricing.markupPercent, 'QUOTATION_PRICING_INVALID');
  if (defaultMarkup.lt(0) || defaultMarkup.gt(500)) throw new Error('QUOTATION_PRICING_INVALID');

  // Read one image at a time so the Worker does not hold several source and
  // transcoded buffers concurrently. ExcelJS retains only the final embedded
  // image set needed by the workbook.
  let totalSourceBytes = 0;
  let totalImageBytes = 0;
  for (const product of workbookProducts) {
    const imageRow = imageRows.get(product.productId);
    if (!imageRow) throw new Error('QUOTATION_EXPORT_IMAGE_UNAVAILABLE');
    let source: Buffer;
    try {
      source = await storage.get(imageRow.key);
    } catch {
      logger.warn('quotation_export.image_read_failed', {
        jobId,
        productId: product.productId,
        fileAssetId: imageRow.assetId,
      });
      throw new Error('QUOTATION_EXPORT_IMAGE_UNAVAILABLE');
    }
    if (
      source.byteLength === 0 ||
      source.byteLength > QUOTATION_EXPORT_LIMITS.maxImageBytes ||
      (imageRow.sizeBytes !== null && BigInt(source.byteLength) !== imageRow.sizeBytes)
    ) {
      throw new Error('QUOTATION_EXPORT_IMAGE_UNAVAILABLE');
    }
    totalSourceBytes += source.byteLength;
    if (totalSourceBytes > QUOTATION_EXPORT_LIMITS.maxProductQuoteTotalImageBytes) {
      throw new Error(ERROR_CODES.quotationExportImageSetTooLarge);
    }
    const prepared = await prepareImage(source);
    if (!prepared) throw new Error('QUOTATION_EXPORT_IMAGE_UNAVAILABLE');
    totalImageBytes += prepared.buffer.byteLength;
    if (totalImageBytes > QUOTATION_EXPORT_LIMITS.maxProductQuoteTotalImageBytes) {
      throw new Error(ERROR_CODES.quotationExportImageSetTooLarge);
    }
    product.image = prepared;
  }

  const templateBuffer = await storage.get(template.storageKey);
  const inspection = await inspectQuoteTemplateWorkbook(templateBuffer, {
    templateType: 'product_quote',
    sheetName: template.sheetName,
    headerRow: template.headerRow,
    itemStartRow: template.itemStartRow,
  });
  if (!inspection.requiredFieldsPresent) throw new Error('QUOTE_TEMPLATE_INVALID');
  const firstMarkup = workbookProducts[0]
    ? (markupByProduct.get(workbookProducts[0].productId) ?? input.pricing.markupPercent)
    : input.pricing.markupPercent;
  const mixedMarkup = workbookProducts.some(
    (product) =>
      !decimal(
        markupByProduct.get(product.productId) ?? input.pricing.markupPercent,
        'QUOTATION_PRICING_INVALID',
      ).eq(firstMarkup),
  );
  const output = await buildQuotationWorkbookFromTemplate({
    templateBuffer,
    sheetName: inspection.sheetName,
    headerRow: inspection.headerRow,
    itemStartRow: inspection.itemStartRow,
    fieldMapping: inspection.fieldMapping,
    material: material.trim(),
    currencyCode: input.pricing.currencyCode,
    markupPercent: input.pricing.markupPercent,
    markupDisplay: mixedMarkup ? 'Per product' : `${firstMarkup}%`,
    exchangeRate: input.pricing.exchangeRate,
    products: workbookProducts,
    generatedAt,
  });
  const fileKey = `quote-exports/product-quotation/${generatedAt.toISOString().slice(0, 7)}/${jobId}.xlsx`;
  await storage.put(
    fileKey,
    output,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const sha256 = createHash('sha256').update(output).digest('hex');
  await prisma.quoteExportJob.update({
    where: { id: jobId },
    data: {
      status: 'SUCCEEDED',
      fileKey,
      fileSha256: sha256,
      fileSizeBytes: BigInt(output.byteLength),
      errorCode: null,
      completedAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: job.requestedById,
      action: 'QUOTATION_EXCEL_EXPORT_COMPLETED',
      entityType: 'quote_export_job',
      entityId: jobId,
      requestId: null,
      metadata: {
        productCount: workbookProducts.length,
        currencyCode: input.pricing.currencyCode,
        totalSourceImageBytes: totalSourceBytes,
        totalEmbeddedImageBytes: totalImageBytes,
        fileSizeBytes: output.byteLength,
      },
    },
  });
  logger.info('quotation_export.product_quote_completed', {
    jobId,
    productCount: workbookProducts.length,
    totalSourceImageBytes: totalSourceBytes,
    totalEmbeddedImageBytes: totalImageBytes,
    fileSizeBytes: output.byteLength,
    fileName: quotationFilename(input.pricing.currencyCode, generatedAt),
  });
  return { fileKey, productCount: workbookProducts.length };
}

function parseInput(value: unknown): QuotationExportInput {
  const result = quotationExportSchema.safeParse(value);
  if (!result.success) throw new Error('QUOTATION_EXPORT_INPUT_INVALID');
  return result.data;
}

async function resolveCategoryIds(
  prisma: PrismaClient,
  rootId: string,
  includeDescendants: boolean,
): Promise<string[]> {
  if (!includeDescendants) return [rootId];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, "parentId" FROM categories WHERE id = ${rootId}::uuid
      UNION ALL
      SELECT c.id, c."parentId" FROM categories c JOIN subtree s ON c."parentId" = s.id
    )
    SELECT id FROM subtree
  `;
  return rows.map((row) => row.id);
}

function isManagedImageKey(key: string | null | undefined): key is string {
  return Boolean(
    key &&
    key.length >= 4 &&
    key.length <= 500 &&
    !key.includes('..') &&
    !key.startsWith('/') &&
    !key.startsWith('\\') &&
    /^[A-Za-z0-9/_.-]+$/.test(key) &&
    PRODUCT_IMAGE_LIMITS.managedKeyPrefixes.some((prefix) => key.startsWith(prefix)),
  );
}

function decimal(value: string, code: string): Decimal {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(code);
  const number = new Decimal(value);
  if (!number.isFinite()) throw new Error(code);
  return number;
}

async function prepareImage(buffer: Buffer): Promise<QuotationWorkbookProduct['image'] | null> {
  const detected = detectQuotationImage(buffer);
  if (detected) {
    if (detected.width * detected.height > QUOTATION_EXPORT_LIMITS.maxImagePixels) return null;
    return {
      buffer,
      extension: detected.extension,
      width: detected.width,
      height: detected.height,
    };
  }
  try {
    const options = {
      failOn: 'error' as const,
      limitInputPixels: QUOTATION_EXPORT_LIMITS.maxImagePixels,
      sequentialRead: true,
    };
    const metadata = await sharp(buffer, options).metadata();
    const width = metadata.autoOrient?.width ?? metadata.width;
    const height = metadata.autoOrient?.height ?? metadata.height;
    if (metadata.format !== 'webp' || !width || !height) return null;
    if (width * height > QUOTATION_EXPORT_LIMITS.maxImagePixels) return null;
    const pipeline = sharp(buffer, options).rotate();
    const converted = metadata.hasAlpha
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer({
          resolveWithObject: true,
        });
    if (converted.data.byteLength > QUOTATION_EXPORT_LIMITS.maxImageBytes) return null;
    const image = detectQuotationImage(converted.data);
    if (!image || image.width * image.height > QUOTATION_EXPORT_LIMITS.maxImagePixels) return null;
    return {
      buffer: converted.data,
      extension: image.extension,
      width: image.width,
      height: image.height,
    };
  } catch {
    return null;
  }
}
