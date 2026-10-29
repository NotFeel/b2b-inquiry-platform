import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  PRODUCT_IMPORT_LIMITS,
  type ProductImportCommitResult,
  type ProductImportIssue,
  type ProductImportSettings,
  type ProductImportValidationResult,
} from '@b2b/contracts';
import type { Prisma } from '@b2b/database';
import {
  ProductImportProcessingError,
  configurationHash,
  validateAndStageProductImport,
  type StoredImportConfiguration,
  type StoredImportPayload,
  type StoredProductImage,
} from '@b2b/product-import';
import ExcelJS from 'exceljs';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import type { AuthenticatedActor } from '../../common/request-context';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import { FilesService } from '../files/files.service';

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

interface ValidatedConfiguration extends StoredImportConfiguration {
  issues: ProductImportIssue[];
}

interface StagedAsset extends StoredProductImage {
  rowIndex: number;
  imageIndex: number;
}

@Injectable()
export class ProductBulkImportService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly dictionary: DictionaryService,
    private readonly files: FilesService,
    private readonly storage: StorageService,
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
      ['Images', 'Standard floating images and WPS DISPIMG cell images are supported.'],
    ]);
    readMe.getColumn(1).width = 28;
    readMe.getColumn(2).width = 78;

    const mapping = workbook.addWorksheet('Field Mapping');
    mapping.addRows([
      ['Optimized column', 'Legacy Price List column'],
      ['SKU*', 'Product Code'],
      ['Product Name (English)*', 'Product Name'],
      ['Unit Price (CNY) [internal]', 'Price per Unit (CNY)'],
      ['Image URL(s) or Asset ID(s)', 'Product Image'],
      ['Carton Quantity (pcs)', 'Packing Quantity (PCS)'],
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
    try {
      const outcome = await validateAndStageProductImport(
        {
          buffer: file.buffer,
          settings,
          actor: {
            id: actor.id,
            canUpdateCost: this.has(actor, 'product.cost.update'),
            canPublish: this.has(actor, 'product.publish'),
          },
          maxImageBytes: Math.min(PRODUCT_IMPORT_LIMITS.maxImageBytes, this.env.UPLOAD_MAX_BYTES),
          maxPixels: this.env.UPLOAD_MAX_PIXELS,
        },
        {
          prisma: this.prisma,
          storage: this.storage,
        },
      );
      await this.auditValidation(actor.id, requestId, outcome.result, outcome.fileSha256);
      return outcome.result;
    } catch (error) {
      if (error instanceof ProductImportProcessingError) {
        throw new ApiError(error.code, error.message);
      }
      throw error;
    }
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
      validation.configHash !== configurationHash(validation.fileSha256, payload.configuration)
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

    // Images were written to object storage during validation. Commit only
    // verifies ownership/metadata; it never decodes Base64 or writes bytes to PG.
    const staged = await this.resolveStagedAssets(payload, actor.id);
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
          for (const asset of rowAssets) {
            await transaction.outboxEvent.create({
              data: {
                eventType: 'image-derivatives',
                payload: {
                  fileAssetId: asset.fileAssetId,
                  storageKey: asset.storageKey,
                  widths: this.env.imageDerivativeWidths,
                } as Prisma.InputJsonValue,
                status: 'QUEUED',
                idempotencyKey: `image-derivatives:${asset.fileAssetId}`,
              },
            });
          }
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

  private async resolveStagedAssets(
    payload: StoredImportPayload,
    actorId: string,
  ): Promise<StagedAsset[]> {
    const imageRows = payload.rows.flatMap((row, rowIndex) =>
      row.images.map((image, imageIndex) => ({ image, rowIndex, imageIndex })),
    );
    if (imageRows.length === 0) return [];
    const assets = await this.prisma.fileAsset.findMany({
      where: { id: { in: [...new Set(imageRows.map((row) => row.image.fileAssetId))] } },
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return imageRows.map(({ image, rowIndex, imageIndex }) => {
      const asset = byId.get(image.fileAssetId);
      if (
        !asset ||
        asset.uploadedById !== actorId ||
        asset.purpose !== 'product-image' ||
        asset.storageKey !== image.storageKey ||
        !asset.isPublic ||
        !['processing', 'ready'].includes(asset.status) ||
        Number(asset.sizeBytes) !== image.sizeBytes ||
        (image.sha256 !== null && asset.sha256 !== null && asset.sha256 !== image.sha256)
      ) {
        throw new ApiError(
          ERROR_CODES.importProcessingFailed,
          'A staged product image is missing or no longer belongs to this validation.',
        );
      }
      return {
        ...image,
        rowIndex,
        imageIndex,
        width: asset.width ?? image.width,
        height: asset.height ?? image.height,
        sizeBytes: Number(asset.sizeBytes),
        sha256: asset.sha256 ?? image.sha256,
      };
    });
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

  private async assertRowsStillUnique(rows: StoredImportPayload['rows']): Promise<void> {
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
      entityId: result.validationId ?? undefined,
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
