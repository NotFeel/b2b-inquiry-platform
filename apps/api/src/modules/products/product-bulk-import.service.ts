import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  PRODUCT_IMPORT_LIMITS,
  type ProductImportCommitResult,
  type ProductImportIssue,
  type ProductImportSettings,
  type ProductImportSummary,
  type ProductImportValidationResult,
} from '@b2b/contracts';
import type { Prisma } from '@b2b/database';
import ExcelJS from 'exceljs';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import type { AuthenticatedActor } from '../../common/request-context';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import { FilesService } from '../files/files.service';
import {
  ImportRowError,
  ProductBulkImportParser,
  type ParsedProductImage,
  type ParsedProductRow,
} from './product-bulk-import-parser';
import { buildProductSlugCandidate } from './product-slug';

const PRODUCT_STATUS_MAP = {
  draft: 'DRAFT',
  published: 'PUBLISHED',
  unpublished: 'UNPUBLISHED',
} as const;
const LIFECYCLE_MAP = {
  available: 'AVAILABLE',
  preorder: 'PREORDER',
  discontinued: 'DISCONTINUED',
} as const;
const DICTIONARY_TYPES = {
  lifecycle: 'product_lifecycle',
  publish: 'publish_status',
} as const;
const MARKETING_TAG_CODES = {
  featured: 'featured',
  newArrival: 'new-arrival',
  preorder: 'preorder',
} as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface StoredProductImage extends Omit<ParsedProductImage, 'bytes'> {
  bytesBase64: string;
}

interface StoredProductRow extends Omit<ParsedProductRow, 'images'> {
  images: StoredProductImage[];
}

interface StoredImportConfiguration {
  settings: ProductImportSettings;
  lifecycleStatusItemId: string;
  publishStatusItemId: string;
  tagCodes: string[];
}

interface StoredImportPayload {
  configuration: StoredImportConfiguration;
  rows: StoredProductRow[];
}

interface ValidatedConfiguration extends StoredImportConfiguration {
  issues: ProductImportIssue[];
}

interface StagedAsset {
  rowIndex: number;
  imageIndex: number;
  fileAssetId: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  sha256: string | null;
}

@Injectable()
export class ProductBulkImportService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly dictionary: DictionaryService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async template(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'B2B Inquiry Platform';
    const products = workbook.addWorksheet('Products');
    products.addRow([
      'SKU*',
      'Slug (optional)',
      'Product Name (English)*',
      'Product Description (English)',
      'Product Name (Chinese)',
      'Product Description (Chinese)',
      'Unit Length (cm)',
      'Unit Width (cm)',
      'Unit Height (cm)',
      'Unit Weight (g)',
      'Packaging Type',
      'Carton Length (cm)',
      'Carton Width (cm)',
      'Carton Height (cm)',
      'Carton Gross Weight (kg)',
      'Carton Quantity (pcs)',
      'Unit Price (CNY) [internal]',
      'Image URL(s) or Asset ID(s)',
      'Sort Order',
    ]);
    products.getRow(1).font = { bold: true };
    products.views = [{ state: 'frozen', ySplit: 1 }];
    products.columns = [];
    products.getRow(1).eachCell((cell) => {
      products.getColumn(cell.col).width = Math.max(16, String(cell.value ?? '').length + 2);
    });
    products.autoFilter = { from: 'A1', to: 'S1' };

    const readMe = workbook.addWorksheet('Read Me');
    readMe.addRows([
      ['Bulk product import'],
      ['Template version', 'optimized-v1'],
      ['Only Products is read during import.'],
      ['Category, publish status, lifecycle and default tags are selected in Admin.'],
      ['Dimensions are centimetres and are converted to integer millimetres.'],
      ['Unit price accepts a number, or a safe arithmetic expression such as =4.7*1.15.'],
      ['Images may be standard floating pictures or WPS DISPIMG cell images.'],
      ['Any row error blocks the complete import.'],
    ]);
    readMe.getColumn(1).width = 28;
    readMe.getColumn(2).width = 80;

    const mapping = workbook.addWorksheet('Original Field Mapping');
    mapping.addRows([
      ['Original field', 'Import field'],
      ['Product Code', 'SKU*'],
      ['Product Image', 'Image URL(s) or Asset ID(s)'],
      ['Product Name', 'Product Name (English)*'],
      ['Price per Unit (CNY)', 'Unit Price (CNY) [internal]'],
      ['Packing Quantity (PCS)', 'Carton Quantity (pcs)'],
      ['Case Dimensions (L×W×H cm)', 'Carton Length / Width / Height'],
      ['Gross Weight (KG)', 'Carton Gross Weight (kg)'],
    ]);
    mapping.getRow(1).font = { bold: true };
    mapping.getColumn(1).width = 34;
    mapping.getColumn(2).width = 36;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async validate(
    file: { buffer: Buffer; originalName: string },
    settings: ProductImportSettings,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ProductImportValidationResult> {
    const parser = new ProductBulkImportParser({
      maxBytes: Math.min(PRODUCT_IMPORT_LIMITS.maxBytes, this.env.UPLOAD_MAX_BYTES),
      maxRows: PRODUCT_IMPORT_LIMITS.maxRows,
      maxImageBytes: this.env.UPLOAD_MAX_BYTES,
      maxPixels: this.env.UPLOAD_MAX_PIXELS,
      maxTotalUncompressedBytes: PRODUCT_IMPORT_LIMITS.maxTotalUncompressedBytes,
    });

    let parsed: Awaited<ReturnType<ProductBulkImportParser['parse']>>;
    try {
      parsed = await parser.parse(file.buffer);
    } catch (error) {
      if (!(error instanceof ImportRowError)) throw error;
      const result = this.invalidResult(parsedPlaceholder(settings.templateVersion), error.issues);
      await this.auditValidation(actor.id, requestId, result, null);
      return result;
    }

    const configuration = await this.validateConfiguration(settings);
    const errors = [...parsed.errors, ...configuration.issues];
    if (settings.templateVersion !== parsed.templateVersion) {
      errors.push(
        this.issue(
          1,
          null,
          'templateVersion',
          ERROR_CODES.importHeaderInvalid,
          `products.import.errors.headerInvalid.${settings.templateVersion}`,
        ),
      );
    }
    const rows = parsed.rows.map((row) => ({ ...row }));
    const rowErrors = new Map<number, ProductImportIssue[]>();
    const pushError = (rowNumber: number, issue: ProductImportIssue) => {
      const current = rowErrors.get(rowNumber) ?? [];
      current.push(issue);
      rowErrors.set(rowNumber, current);
      errors.push(issue);
    };

    if (rows.some((row) => row.priceCny !== null) && !this.has(actor, 'product.cost.update')) {
      for (const row of rows.filter((candidate) => candidate.priceCny !== null)) {
        pushError(
          row.rowNumber,
          this.issue(
            row.rowNumber,
            row.sku || null,
            'priceCny',
            ERROR_CODES.importPricePermissionDenied,
            'products.import.errors.pricePermission',
          ),
        );
      }
    }
    if (settings.publishStatus === 'published' && !this.has(actor, 'product.publish')) {
      for (const row of rows) {
        pushError(
          row.rowNumber,
          this.issue(
            row.rowNumber,
            row.sku || null,
            'publishStatus',
            ERROR_CODES.importPublishReadinessFailed,
            'products.import.errors.publishPermission',
          ),
        );
      }
    }

    await this.validateProductRows(rows, settings.publishStatus, pushError);
    await this.resolveSlugs(rows, pushError);
    const issues = dedupeIssues(errors);
    const summary = summarize(rows, issues, parsed.imageCount);
    if (issues.some((issue) => issue.severity === 'error')) {
      const result: ProductImportValidationResult = {
        validationId: null,
        templateVersion: parsed.templateVersion,
        summary,
        errors: issues.filter((issue) => issue.severity === 'error'),
        warnings: issues.filter((issue) => issue.severity === 'warning'),
        expiresAt: null,
      };
      await this.auditValidation(actor.id, requestId, result, parsed.fileSha256);
      return result;
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const configHash = this.configurationHash(parsed.fileSha256, configuration);
    const payload: StoredImportPayload = {
      configuration,
      rows: rows.map((row) => ({
        ...row,
        images: row.images.map(({ bytes, ...image }) => ({
          ...image,
          bytesBase64: bytes.toString('base64'),
        })),
      })),
    };
    const expiresAt = new Date(Date.now() + PRODUCT_IMPORT_LIMITS.validationTtlSeconds * 1000);
    await this.prisma.productImportValidation.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const validation = await this.prisma.productImportValidation.create({
      data: {
        tokenHash,
        actorId: actor.id,
        fileSha256: parsed.fileSha256,
        templateVersion: parsed.templateVersion,
        configHash,
        payload: payload as unknown as Prisma.InputJsonValue,
        rowCount: rows.length,
        imageCount: parsed.imageCount,
        expiresAt,
      },
      select: { id: true },
    });
    const result: ProductImportValidationResult = {
      validationId: token,
      templateVersion: parsed.templateVersion,
      summary,
      errors: [],
      warnings: [],
      expiresAt: expiresAt.toISOString(),
    };
    await this.audit.record({
      actorId: actor.id,
      action: 'product_import.validation_passed',
      entityType: 'product_import_validation',
      entityId: validation.id,
      requestId,
      metadata: {
        templateVersion: parsed.templateVersion,
        fileSha256: parsed.fileSha256,
        rowCount: rows.length,
        imageCount: parsed.imageCount,
      },
    });
    return result;
  }

  async commit(
    validationId: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ProductImportCommitResult> {
    const tokenHash = sha256(validationId);
    const validation = await this.prisma.productImportValidation.findUnique({
      where: { tokenHash },
    });
    if (!validation || validation.actorId !== actor.id) {
      throw new ApiError(
        ERROR_CODES.importValidationNotFound,
        'The import validation does not exist for this operator.',
        { status: 404 },
      );
    }
    if (validation.consumedAt) {
      throw new ApiError(
        ERROR_CODES.importAlreadyConsumed,
        'This import validation has already been consumed.',
        { status: 409 },
      );
    }
    if (validation.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        ERROR_CODES.importValidationExpired,
        'This import validation has expired.',
        { status: 409 },
      );
    }

    const payload = validation.payload as unknown as StoredImportPayload;
    if (
      !payload?.configuration?.settings ||
      !Array.isArray(payload.rows) ||
      validation.configHash !== this.configurationHash(validation.fileSha256, payload.configuration)
    ) {
      throw new ApiError(
        ERROR_CODES.importValidationConfigMismatch,
        'The validated import configuration no longer matches.',
        { status: 409 },
      );
    }
    const settings = payload.configuration.settings;
    if (
      payload.rows.some((row) => row.priceCny !== null) &&
      !this.has(actor, 'product.cost.update')
    ) {
      throw new ApiError(
        ERROR_CODES.importPricePermissionDenied,
        'The operator cannot import internal prices.',
        { status: 403 },
      );
    }
    if (settings.publishStatus === 'published' && !this.has(actor, 'product.publish')) {
      throw new ApiError(
        ERROR_CODES.importPublishReadinessFailed,
        'The operator cannot publish imported products.',
        { status: 403 },
      );
    }

    const freshConfiguration = await this.validateConfiguration(settings);
    if (freshConfiguration.issues.length > 0) {
      throw new ApiError(
        ERROR_CODES.importValidationConfigMismatch,
        'Category, status or tag configuration changed after validation.',
        {
          status: 409,
          details: { issues: freshConfiguration.issues },
        },
      );
    }
    await this.assertRowsStillUnique(payload.rows);

    const staged: StagedAsset[] = [];
    try {
      for (let rowIndex = 0; rowIndex < payload.rows.length; rowIndex += 1) {
        const row = payload.rows[rowIndex]!;
        for (let imageIndex = 0; imageIndex < row.images.length; imageIndex += 1) {
          const image = row.images[imageIndex]!;
          const uploaded = await this.files.upload(
            {
              purpose: 'product-image',
              originalName: image.mediaName,
              declaredMime: image.mimeType,
              buffer: Buffer.from(image.bytesBase64, 'base64'),
            },
            actor.id,
            requestId,
          );
          staged.push({
            rowIndex,
            imageIndex,
            fileAssetId: uploaded.id,
            storageKey: uploaded.storageKey,
            width: uploaded.width,
            height: uploaded.height,
            sizeBytes: uploaded.sizeBytes,
            sha256: image.sha256,
          });
        }
      }
    } catch (error) {
      await this.cleanupStaged(staged, actor.id, requestId);
      throw error;
    }

    let createdCount = 0;
    try {
      const completedAt = await this.prisma.$transaction(async (transaction) => {
        const consumed = await transaction.productImportValidation.updateMany({
          where: {
            id: validation.id,
            tokenHash,
            actorId: actor.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date(), payload: {} },
        });
        if (consumed.count !== 1) {
          throw new ApiError(
            ERROR_CODES.importAlreadyConsumed,
            'This import validation has already been consumed.',
            { status: 409 },
          );
        }

        for (let rowIndex = 0; rowIndex < payload.rows.length; rowIndex += 1) {
          const row = payload.rows[rowIndex]!;
          const rowAssets = staged.filter((asset) => asset.rowIndex === rowIndex);
          await transaction.product.create({
            data: {
              sku: row.sku,
              slug: row.slug!,
              categoryId: settings.categoryId,
              priceCny: row.priceCny,
              lifecycleStatus: LIFECYCLE_MAP[settings.lifecycleStatus],
              publishStatus: PRODUCT_STATUS_MAP[settings.publishStatus],
              lifecycleStatusItemId: payload.configuration.lifecycleStatusItemId,
              publishStatusItemId: payload.configuration.publishStatusItemId,
              isFeatured: payload.configuration.tagCodes.includes(MARKETING_TAG_CODES.featured),
              isNew: payload.configuration.tagCodes.includes(MARKETING_TAG_CODES.newArrival),
              isPreOrder:
                settings.lifecycleStatus === 'preorder' &&
                payload.configuration.tagCodes.includes(MARKETING_TAG_CODES.preorder),
              sortOrder: row.sortOrder,
              lengthMm: row.lengthMm,
              widthMm: row.widthMm,
              heightMm: row.heightMm,
              weightGrams: row.weightGrams,
              packaging: row.packaging,
              cartonLengthCm: row.cartonLengthCm,
              cartonWidthCm: row.cartonWidthCm,
              cartonHeightCm: row.cartonHeightCm,
              cartonWeightKg: row.cartonWeightKg,
              cartonQuantity: row.cartonQuantity,
              createdById: actor.id,
              translations: {
                create: [
                  {
                    locale: 'en-US',
                    name: row.nameEn,
                    description: row.descriptionEn,
                  },
                  ...(row.nameZh
                    ? [
                        {
                          locale: 'zh-CN',
                          name: row.nameZh,
                          description: row.descriptionZh,
                        },
                      ]
                    : []),
                ],
              },
              tags: {
                create: settings.tagIds.map((tagId) => ({ tagId })),
              },
              images: {
                create: rowAssets.map((asset, index) => ({
                  fileAssetId: asset.fileAssetId,
                  storageKey: asset.storageKey,
                  altText: (row.nameEn || row.sku).slice(0, 240),
                  sortOrder: index,
                  isCover: index === 0,
                  width: asset.width,
                  height: asset.height,
                  sizeBytes: BigInt(asset.sizeBytes),
                  sha256: asset.sha256,
                  deleteState: 'READY',
                })),
              },
            },
          });
          createdCount += 1;
        }

        const completedAt = new Date();
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'product_import.completed',
            entityType: 'product_import_validation',
            entityId: validation.id,
            requestId,
            metadata: {
              templateVersion: validation.templateVersion,
              fileSha256: validation.fileSha256,
              createdCount,
              imageCount: staged.length,
            },
          },
        });
        return completedAt;
      });
      return {
        batchId: validation.id,
        createdCount,
        completedAt: completedAt.toISOString(),
      };
    } catch (error) {
      await this.cleanupStaged(staged, actor.id, requestId);
      await this.audit.record({
        actorId: actor.id,
        action: 'product_import.failed',
        entityType: 'product_import_validation',
        entityId: validation.id,
        requestId,
        metadata: {
          templateVersion: validation.templateVersion,
          fileSha256: validation.fileSha256,
          code: error instanceof ApiError ? error.code : ERROR_CODES.importAtomicCommitFailed,
        },
      });
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        ERROR_CODES.importAtomicCommitFailed,
        'The complete import transaction failed and no products were created.',
        { status: 409 },
      );
    }
  }

  private async validateConfiguration(
    settings: ProductImportSettings,
  ): Promise<ValidatedConfiguration> {
    const issues: ProductImportIssue[] = [];
    const category = await this.prisma.category.findUnique({
      where: { id: settings.categoryId },
      select: { enabled: true },
    });
    if (!category?.enabled) {
      issues.push(
        this.issue(
          null,
          null,
          'categoryId',
          ERROR_CODES.importCategoryInvalid,
          'products.import.errors.category',
        ),
      );
    }

    const lifecycle = await this.dictionary.resolveItem(
      DICTIONARY_TYPES.lifecycle,
      settings.lifecycleStatus,
    );
    if (!lifecycle?.enabled) {
      issues.push(
        this.issue(
          null,
          null,
          'lifecycleStatus',
          ERROR_CODES.importLifecycleInvalid,
          'products.import.errors.lifecycle',
        ),
      );
    }
    const publish = await this.dictionary.resolveItem(
      DICTIONARY_TYPES.publish,
      settings.publishStatus,
    );
    if (!publish?.enabled) {
      issues.push(
        this.issue(
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
        ? await this.prisma.tag.findMany({
            where: { id: { in: uniqueTagIds }, enabled: true },
            select: { id: true, code: true },
          })
        : [];
    if (tags.length !== uniqueTagIds.length) {
      issues.push(
        this.issue(
          null,
          null,
          'tagIds',
          ERROR_CODES.importTagInvalid,
          'products.import.errors.tags',
        ),
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

  private async validateProductRows(
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
      this.prisma.product.findMany({
        where: { sku: { in: skuValues } },
        select: { sku: true },
      }),
      explicitSlugs.length > 0
        ? this.prisma.product.findMany({
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
          this.issue(
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
          this.issue(
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
          this.issue(
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
          this.issue(
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

  private async resolveSlugs(
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
        const generated = buildProductSlugCandidate(row.nameEn || row.sku, 'name-random');
        if (!reserved.has(generated)) {
          const exists = await this.prisma.product.findUnique({
            where: { slug: generated },
            select: { id: true },
          });
          if (!exists) {
            candidate = generated;
            break;
          }
        }
      }
      if (!candidate) {
        pushError(
          row.rowNumber,
          this.issue(
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

  private async assertRowsStillUnique(rows: StoredProductRow[]): Promise<void> {
    const skus = rows.map((row) => row.sku);
    const slugs = rows.map((row) => row.slug).filter((slug): slug is string => Boolean(slug));
    if (new Set(skus).size !== skus.length || new Set(slugs).size !== slugs.length) {
      throw new ApiError(
        ERROR_CODES.importDuplicateSkuInFile,
        'The validated workbook contains duplicate identifiers.',
        { status: 409 },
      );
    }
    const [skuRows, slugRows] = await Promise.all([
      this.prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true } }),
      this.prisma.product.findMany({ where: { slug: { in: slugs } }, select: { slug: true } }),
    ]);
    if (skuRows.length > 0 || slugRows.length > 0) {
      throw new ApiError(
        ERROR_CODES.importSkuAlreadyExists,
        'A product identifier was created after validation. Validate the workbook again.',
        { status: 409 },
      );
    }
  }

  private async cleanupStaged(
    staged: StagedAsset[],
    actorId: string,
    requestId: string,
  ): Promise<void> {
    await Promise.allSettled(
      staged.map((asset) => this.files.remove(asset.fileAssetId, actorId, requestId)),
    );
  }

  private configurationHash(fileSha256: string, configuration: StoredImportConfiguration): string {
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

  private invalidResult(
    templateVersion: ProductImportSettings['templateVersion'],
    errors: ProductImportIssue[],
  ): ProductImportValidationResult {
    const invalidRows = new Set(
      errors
        .map((issue) => issue.rowNumber)
        .filter((row): row is number => typeof row === 'number'),
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

  private async auditValidation(
    actorId: string,
    requestId: string,
    result: ProductImportValidationResult,
    fileSha256: string | null,
  ): Promise<void> {
    await this.audit.record({
      actorId,
      action:
        result.errors.length > 0
          ? 'product_import.validation_failed'
          : 'product_import.validation_passed',
      entityType: 'product_import_validation',
      requestId,
      metadata: {
        templateVersion: result.templateVersion,
        fileSha256,
        totalRows: result.summary.totalRows,
        invalidRows: result.summary.invalidRows,
        errorCount: result.errors.length,
        imageCount: result.summary.imageCount,
      },
    });
  }

  private has(actor: AuthenticatedActor, permission: string): boolean {
    return actor.roles.includes('super_admin') || actor.permissions.has(permission);
  }

  private issue(
    rowNumber: number | null,
    sku: string | null,
    field: string,
    code: string,
    messageKey: string,
  ): ProductImportIssue {
    return { rowNumber, sku, field, code, messageKey, severity: 'error' };
  }
}

function summarize(
  rows: ParsedProductRow[],
  issues: ProductImportIssue[],
  imageCount: number,
): ProductImportSummary {
  const invalidRows = new Set(
    issues
      .filter((issue) => issue.severity === 'error' && issue.rowNumber !== null)
      .map((issue) => issue.rowNumber as number),
  );
  return {
    totalRows: rows.length,
    validRows: rows.length - invalidRows.size,
    invalidRows: invalidRows.size,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    imageCount,
  };
}

function parsedPlaceholder(
  templateVersion: ProductImportSettings['templateVersion'],
): ProductImportSettings['templateVersion'] {
  return templateVersion;
}

function dedupeIssues(issues: ProductImportIssue[]): ProductImportIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.rowNumber}:${issue.field}:${issue.code}:${issue.messageKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
