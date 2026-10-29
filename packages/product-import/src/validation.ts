import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  PRODUCT_IMPORT_LIMITS,
  productSlugCandidate,
  type ProductImportIssue,
  type ProductImportSettings,
  type ProductImportSummary,
  type ProductImportValidationResult,
} from '@b2b/contracts';
import type { Prisma, PrismaClient } from '@b2b/database';
import {
  ImportRowError,
  ProductBulkImportParser,
  type ParsedProductImage,
  type ParsedProductRow,
} from './product-bulk-import-parser';

const DICTIONARY_TYPES = {
  lifecycle: 'product_lifecycle',
  publish: 'publish_status',
} as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface StoredProductImage extends Omit<ParsedProductImage, 'bytes'> {
  fileAssetId: string;
  storageKey: string;
}

export interface StoredProductRow extends Omit<ParsedProductRow, 'images'> {
  images: StoredProductImage[];
}

export interface StoredImportConfiguration {
  settings: ProductImportSettings;
  lifecycleStatusItemId: string;
  publishStatusItemId: string;
  tagCodes: string[];
}

export interface ValidatedImportConfiguration extends StoredImportConfiguration {
  issues: ProductImportIssue[];
}

export interface StoredImportPayload {
  configuration: StoredImportConfiguration;
  rows: StoredProductRow[];
}

export interface ProductImportValidationDependencies {
  prisma: PrismaClient;
  storage: {
    put(key: string, body: Buffer, contentType: string): Promise<unknown>;
    delete(key: string): Promise<void>;
  };
}

export interface ProductImportValidationInput {
  buffer: Buffer;
  settings: ProductImportSettings;
  actor: {
    id: string;
    canUpdateCost: boolean;
    canPublish: boolean;
  };
  maxImageBytes: number;
  maxPixels: number;
  /** Stable across worker retries; the UUID doubles as the one-time commit token. */
  validationId?: string;
}

export interface ProductImportValidationOutcome {
  result: ProductImportValidationResult;
  validationRecordId: string | null;
  fileSha256: string | null;
  stagedImageCount: number;
}

export class ProductImportProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductImportProcessingError';
  }
}

/**
 * Parses and validates an import once, then stages every image in object
 * storage before creating the short-lived validation token. PostgreSQL stores
 * only asset ids and compact image metadata; workbook/image bytes never enter
 * JSONB.
 */
export async function validateAndStageProductImport(
  input: ProductImportValidationInput,
  deps: ProductImportValidationDependencies,
): Promise<ProductImportValidationOutcome> {
  if (input.validationId) {
    const existing = await deps.prisma.productImportValidation.findUnique({
      where: { id: input.validationId },
    });
    if (existing) {
      const payload = existing.payload as unknown as StoredImportPayload;
      if (Array.isArray(payload?.rows)) {
        return {
          result: {
            validationId: existing.id,
            templateVersion: existing.templateVersion as ProductImportSettings['templateVersion'],
            summary: {
              totalRows: payload.rows.length,
              validRows: payload.rows.length,
              invalidRows: 0,
              warningCount: 0,
              imageCount: payload.rows.reduce((sum, row) => sum + row.images.length, 0),
            },
            errors: [],
            warnings: [],
            expiresAt: existing.expiresAt.toISOString(),
          },
          validationRecordId: existing.id,
          fileSha256: existing.fileSha256,
          stagedImageCount: payload.rows.reduce((sum, row) => sum + row.images.length, 0),
        };
      }
    }
  }

  const parser = new ProductBulkImportParser({
    maxBytes: PRODUCT_IMPORT_LIMITS.maxBytes,
    maxRows: PRODUCT_IMPORT_LIMITS.maxRows,
    maxImageBytes: Math.min(PRODUCT_IMPORT_LIMITS.maxImageBytes, input.maxImageBytes),
    maxPixels: input.maxPixels,
    maxTotalUncompressedBytes: PRODUCT_IMPORT_LIMITS.maxTotalUncompressedBytes,
  });

  let parsed: Awaited<ReturnType<ProductBulkImportParser['parse']>>;
  try {
    parsed = await parser.parse(input.buffer);
  } catch (error) {
    if (error instanceof ImportRowError) {
      return {
        result: invalidResult(input.settings.templateVersion, error.issues),
        validationRecordId: null,
        fileSha256: null,
        stagedImageCount: 0,
      };
    }
    throw new ProductImportProcessingError(
      ERROR_CODES.importProcessingFailed,
      error instanceof Error ? error.message : 'The workbook could not be parsed.',
    );
  }

  const configuration = await validateProductImportConfiguration(deps.prisma, input.settings);
  const errors = [...parsed.errors, ...configuration.issues];
  if (input.settings.templateVersion !== parsed.templateVersion) {
    errors.push(
      issue(
        1,
        null,
        'templateVersion',
        ERROR_CODES.importHeaderInvalid,
        `products.import.errors.headerInvalid.${input.settings.templateVersion}`,
      ),
    );
  }

  const rows = parsed.rows.map((row) => ({ ...row }));
  const pushError = (rowNumber: number, rowIssue: ProductImportIssue) => {
    errors.push(rowIssue);
  };

  if (rows.some((row) => row.priceCny !== null) && !input.actor.canUpdateCost) {
    for (const row of rows.filter((candidate) => candidate.priceCny !== null)) {
      pushError(
        row.rowNumber,
        issue(
          row.rowNumber,
          row.sku || null,
          'priceCny',
          ERROR_CODES.importPricePermissionDenied,
          'products.import.errors.pricePermission',
        ),
      );
    }
  }
  if (input.settings.publishStatus === 'published' && !input.actor.canPublish) {
    for (const row of rows) {
      pushError(
        row.rowNumber,
        issue(
          row.rowNumber,
          row.sku || null,
          'publishStatus',
          ERROR_CODES.importPublishReadinessFailed,
          'products.import.errors.publishPermission',
        ),
      );
    }
  }

  await validateProductRows(deps.prisma, rows, input.settings.publishStatus, pushError);
  await resolveSlugs(deps.prisma, rows, pushError);
  const issues = dedupeIssues(errors);
  const summary = summarize(rows, issues, parsed.imageCount);
  if (issues.some((rowIssue) => rowIssue.severity === 'error')) {
    return {
      result: {
        validationId: null,
        templateVersion: parsed.templateVersion,
        summary,
        errors: dedupeIssues(issues.filter((rowIssue) => rowIssue.severity === 'error')),
        warnings: dedupeIssues(issues.filter((rowIssue) => rowIssue.severity === 'warning')),
        expiresAt: null,
      },
      validationRecordId: null,
      fileSha256: parsed.fileSha256,
      stagedImageCount: 0,
    };
  }

  const validationId = input.validationId ?? randomUUID();
  const expiresAt = new Date(Date.now() + PRODUCT_IMPORT_LIMITS.validationTtlSeconds * 1000);
  const stagedKeys: string[] = [];
  const storedRows: StoredProductRow[] = rows.map((row) => ({
    ...row,
    images: [],
  }));

  try {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]!;
      for (const image of row.images) {
        const storageKey = buildProductImageKey(image.mimeType);
        await deps.storage.put(storageKey, image.bytes, image.mimeType);
        stagedKeys.push(storageKey);
        // Never persist the decoded media bytes in the validation JSONB. Spread
        // the object with the runtime `bytes` property explicitly removed; the
        // TypeScript Omit type alone does not strip it from an object spread.
        const { bytes: _bytes, ...imageMetadata } = image;
        storedRows[rowIndex]!.images.push({
          ...imageMetadata,
          fileAssetId: '',
          storageKey,
        });
      }
    }

    const configHash = configurationHash(parsed.fileSha256, configuration);
    await deps.prisma.$transaction(async (transaction) => {
      for (const row of storedRows) {
        for (const image of row.images) {
          const asset = await transaction.fileAsset.create({
            data: {
              storageKey: image.storageKey,
              originalName: image.mediaName.slice(0, 255),
              mimeType: image.mimeType,
              sizeBytes: BigInt(image.sizeBytes),
              sha256: image.sha256,
              width: image.width,
              height: image.height,
              purpose: 'product-image',
              status: 'processing',
              isPublic: true,
              uploadedById: input.actor.id,
            },
            select: { id: true },
          });
          image.fileAssetId = asset.id;
        }
      }

      const payload: StoredImportPayload = { configuration, rows: storedRows };
      await transaction.productImportValidation.create({
        data: {
          id: validationId,
          tokenHash: sha256(validationId),
          actorId: input.actor.id,
          fileSha256: parsed.fileSha256,
          templateVersion: parsed.templateVersion,
          configHash,
          payload: payload as unknown as Prisma.InputJsonValue,
          rowCount: rows.length,
          imageCount: parsed.imageCount,
          expiresAt,
        },
      });
    });
  } catch (error) {
    await Promise.allSettled(stagedKeys.map((key) => deps.storage.delete(key)));
    throw new ProductImportProcessingError(
      ERROR_CODES.importProcessingFailed,
      error instanceof Error ? error.message : 'The staged import could not be persisted.',
    );
  }

  return {
    result: {
      validationId,
      templateVersion: parsed.templateVersion,
      summary,
      errors: [],
      warnings: dedupeIssues(issues.filter((rowIssue) => rowIssue.severity === 'warning')),
      expiresAt: expiresAt.toISOString(),
    },
    validationRecordId: validationId,
    fileSha256: parsed.fileSha256,
    stagedImageCount: parsed.imageCount,
  };
}

export function configurationHash(
  fileSha256: string,
  configuration: StoredImportConfiguration,
): string {
  return sha256(
    JSON.stringify({
      fileSha256,
      categoryId: configuration.settings.categoryId,
      publishStatus: configuration.settings.publishStatus,
      lifecycleStatus: configuration.settings.lifecycleStatus,
      tagIds: [...configuration.settings.tagIds].sort(),
      templateVersion: configuration.settings.templateVersion,
      lifecycleStatusItemId: configuration.lifecycleStatusItemId,
      publishStatusItemId: configuration.publishStatusItemId,
      tagCodes: [...configuration.tagCodes].sort(),
    }),
  );
}

export async function validateProductImportConfiguration(
  prisma: PrismaClient,
  settings: ProductImportSettings,
): Promise<ValidatedImportConfiguration> {
  const issues: ProductImportIssue[] = [];
  const category = await prisma.category.findUnique({
    where: { id: settings.categoryId },
    select: { enabled: true },
  });
  if (!category?.enabled) {
    issues.push(
      issue(
        null,
        null,
        'categoryId',
        ERROR_CODES.importCategoryInvalid,
        'products.import.errors.category',
      ),
    );
  }

  const lifecycle = await resolveDictionaryItem(
    prisma,
    DICTIONARY_TYPES.lifecycle,
    settings.lifecycleStatus,
  );
  if (!lifecycle?.enabled) {
    issues.push(
      issue(
        null,
        null,
        'lifecycleStatus',
        ERROR_CODES.importLifecycleInvalid,
        'products.import.errors.lifecycle',
      ),
    );
  }
  const publish = await resolveDictionaryItem(
    prisma,
    DICTIONARY_TYPES.publish,
    settings.publishStatus,
  );
  if (!publish?.enabled) {
    issues.push(
      issue(
        null,
        null,
        'publishStatus',
        ERROR_CODES.importStatusInvalid,
        'products.import.errors.status',
      ),
    );
  }

  const uniqueTagIds = [...new Set(settings.tagIds)];
  const tags =
    uniqueTagIds.length > 0
      ? await prisma.tag.findMany({
          where: { id: { in: uniqueTagIds }, enabled: true },
          select: { id: true, code: true },
        })
      : [];
  if (tags.length !== uniqueTagIds.length) {
    issues.push(
      issue(null, null, 'tagIds', ERROR_CODES.importTagInvalid, 'products.import.errors.tags'),
    );
  }

  return {
    settings: { ...settings, tagIds: uniqueTagIds },
    lifecycleStatusItemId: lifecycle?.id ?? '',
    publishStatusItemId: publish?.id ?? '',
    tagCodes: tags.map((tag) => tag.code),
    issues,
  };
}

async function resolveDictionaryItem(
  prisma: PrismaClient,
  typeCode: string,
  code: string,
): Promise<{ id: string; code: string; enabled: boolean } | null> {
  return prisma.dictionaryItem.findFirst({
    where: { type: { code: typeCode }, code },
    select: { id: true, code: true, enabled: true },
  });
}

async function validateProductRows(
  prisma: PrismaClient,
  rows: ParsedProductRow[],
  publishStatus: ProductImportSettings['publishStatus'],
  pushError: (rowNumber: number, issue: ProductImportIssue) => void,
): Promise<void> {
  for (const row of rows) {
    if (row.slug) row.slug = row.slug.toLowerCase();
  }
  const skuValues = [...new Set(rows.map((row) => row.sku).filter(Boolean))];
  const explicitSlugs = [
    ...new Set(rows.map((row) => row.slug).filter((slug): slug is string => Boolean(slug))),
  ];
  const [existingSkus, existingSlugs] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: skuValues } }, select: { sku: true } }),
    explicitSlugs.length > 0
      ? prisma.product.findMany({
          where: { slug: { in: explicitSlugs } },
          select: { slug: true },
        })
      : Promise.resolve([]),
  ]);
  const usedSkus = new Set(existingSkus.map((row) => row.sku));
  const usedSlugs = new Set(existingSlugs.map((row) => row.slug));

  for (const row of rows) {
    if (row.sku && usedSkus.has(row.sku)) {
      pushError(
        row.rowNumber,
        issue(
          row.rowNumber,
          row.sku,
          'sku',
          ERROR_CODES.importSkuAlreadyExists,
          'products.import.errors.skuExists',
        ),
      );
    }
    if (row.slug && (!SLUG_PATTERN.test(row.slug) || row.slug.length > 180)) {
      pushError(
        row.rowNumber,
        issue(
          row.rowNumber,
          row.sku || null,
          'slug',
          ERROR_CODES.importFieldInvalid,
          'products.import.errors.slug',
        ),
      );
    } else if (row.slug && usedSlugs.has(row.slug)) {
      pushError(
        row.rowNumber,
        issue(
          row.rowNumber,
          row.sku || null,
          'slug',
          ERROR_CODES.importSlugDuplicate,
          'products.import.errors.slugExists',
        ),
      );
    }
    if (publishStatus === 'published' && row.images.length === 0) {
      pushError(
        row.rowNumber,
        issue(
          row.rowNumber,
          row.sku || null,
          'publishStatus',
          ERROR_CODES.importPublishReadinessFailed,
          'products.import.errors.publishImage',
        ),
      );
    }
  }
}

async function resolveSlugs(
  prisma: PrismaClient,
  rows: ParsedProductRow[],
  pushError: (rowNumber: number, issue: ProductImportIssue) => void,
): Promise<void> {
  const reserved = new Set(
    rows.map((row) => row.slug).filter((slug): slug is string => Boolean(slug)),
  );
  for (const row of rows) {
    if (row.slug) continue;
    let candidate: string | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const generated = randomSlug(row.nameEn || row.sku);
      if (reserved.has(generated)) continue;
      const exists = await prisma.product.findUnique({
        where: { slug: generated },
        select: { id: true },
      });
      if (!exists) {
        candidate = generated;
        break;
      }
    }
    if (!candidate) {
      pushError(
        row.rowNumber,
        issue(
          row.rowNumber,
          row.sku || null,
          'slug',
          ERROR_CODES.importSlugDuplicate,
          'products.import.errors.slugGeneration',
        ),
      );
      continue;
    }
    row.slug = candidate;
    reserved.add(candidate);
  }
}

function buildProductImageKey(mimeType: string): string {
  const now = new Date();
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `product-image/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${extension}`;
}

function randomSlug(name: string): string {
  const suffix = String(randomInt(100_000, 1_000_000));
  return productSlugCandidate(name, 'name-random', suffix);
}

function invalidResult(
  templateVersion: ProductImportSettings['templateVersion'],
  errors: ProductImportIssue[],
): ProductImportValidationResult {
  const invalidRows = new Set(
    errors.map((error) => error.rowNumber).filter((row): row is number => typeof row === 'number'),
  ).size;
  return {
    validationId: null,
    templateVersion,
    summary: {
      totalRows: invalidRows,
      validRows: 0,
      invalidRows,
      warningCount: 0,
      imageCount: 0,
    },
    errors,
    warnings: [],
    expiresAt: null,
  };
}

function summarize(
  rows: ParsedProductRow[],
  issues: ProductImportIssue[],
  imageCount: number,
): ProductImportSummary {
  const invalidRows = new Set(
    issues
      .filter((entry) => entry.severity === 'error' && entry.rowNumber !== null)
      .map((entry) => entry.rowNumber as number),
  );
  return {
    totalRows: rows.length,
    validRows: rows.length - invalidRows.size,
    invalidRows: invalidRows.size,
    warningCount: issues.filter((entry) => entry.severity === 'warning').length,
    imageCount,
  };
}

function dedupeIssues(issues: ProductImportIssue[]): ProductImportIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.rowNumber}:${entry.field}:${entry.code}:${entry.messageKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function issue(
  rowNumber: number | null,
  sku: string | null,
  field: string,
  code: string,
  messageKey: string,
): ProductImportIssue {
  return { rowNumber, sku, field, code, messageKey, severity: 'error' };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
