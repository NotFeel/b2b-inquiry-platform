import { Inject, Injectable } from '@nestjs/common';
import {
  DICTIONARY_TYPES,
  ERROR_CODES,
  FACTORY_MEDIA_PLACEMENTS,
  HOME_SECTION_CODES,
  PUBLIC_LOCALE,
} from '@b2b/contracts';
import type {
  CredentialAdminDetail,
  CredentialAdminSummary,
  FactoryMediaAdminDetail,
  FactoryMediaAdminSummary,
  FactoryProcessStepAdminDetail,
  FactoryProcessStepAdminSummary,
  HomeSectionAdminDetail,
  PublicCredential,
  PublicFactoryContent,
  PublicFactoryMedia,
  PublicFactoryProcessStep,
  PublicHomeSection,
  PublicQualityContent,
} from '@b2b/contracts';
import type {
  CreateCredentialInput,
  CreateFactoryMediaInput,
  CreateFactoryProcessStepInput,
  CredentialListQueryInput,
  FactoryMediaListQueryInput,
  FactoryProcessListQueryInput,
  UpdateCredentialInput,
  UpdateFactoryMediaInput,
  UpdateFactoryProcessStepInput,
  UpdateHomeSectionInput,
} from '@b2b/validation';
import type {
  Credential,
  CredentialTranslation,
  FactoryMedia,
  FactoryMediaTranslation,
  FactoryProcessStep,
  FactoryProcessStepTranslation,
  FileAsset,
  HomeSection,
  HomeSectionTranslation,
  Prisma,
} from '@b2b/database';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { FilesService } from '../files/files.service';
import { JsonLogger } from '../../common/logger.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';
import {
  homeSectionItemKind,
  isCredentialExpired,
  isValidityOrderValid,
} from './content-operations-policy';

type PublishStatusValue = 'draft' | 'published' | 'unpublished';
type FactoryMediaRow = FactoryMedia & {
  translations: FactoryMediaTranslation[];
  asset: FileAsset | null;
  coverAsset: FileAsset | null;
};
type FactoryProcessRow = FactoryProcessStep & {
  translations: FactoryProcessStepTranslation[];
  asset: FileAsset | null;
};
type CredentialRow = Credential & {
  translations: CredentialTranslation[];
  primaryAsset: FileAsset | null;
};
type HomeSectionRow = HomeSection & { translations: HomeSectionTranslation[] };

const STATUS_MAP: Record<PublishStatusValue, 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'> = {
  draft: 'DRAFT',
  published: 'PUBLISHED',
  unpublished: 'UNPUBLISHED',
};

const FACTORY_IMAGE_PURPOSE = 'factory-media-image';
const FACTORY_VIDEO_PURPOSE = 'factory-media-video';
const PROCESS_IMAGE_PURPOSE = 'factory-process-image';
const CREDENTIAL_DOCUMENT_PURPOSE = 'credential-document';
const ASSET_IMAGE_PURPOSES = [
  FACTORY_IMAGE_PURPOSE,
  PROCESS_IMAGE_PURPOSE,
  CREDENTIAL_DOCUMENT_PURPOSE,
];

@Injectable()
export class ContentOperationsService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
  ) {}

  // ------------------------------------------------------------ factory media

  async listFactoryMedia(query: FactoryMediaListQueryInput) {
    const where: Prisma.FactoryMediaWhereInput = {
      ...(query.mediaType !== 'all' ? { mediaType: query.mediaType } : {}),
      ...(query.placement !== 'all' ? { placements: { has: query.placement } } : {}),
      ...(query.publishStatus !== 'all' ? { status: STATUS_MAP[query.publishStatus] } : {}),
      ...(query.q
        ? {
            OR: [
              { translations: { some: { title: { contains: query.q, mode: 'insensitive' } } } },
              {
                translations: {
                  some: { description: { contains: query.q, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.factoryMedia.count({ where }),
      this.prisma.factoryMedia.findMany({
        where,
        include: { translations: true, asset: true, coverAsset: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((row) => this.toFactoryMediaSummary(row, query.locale)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getFactoryMedia(id: string, locale: string): Promise<FactoryMediaAdminDetail> {
    const row = await this.prisma.factoryMedia.findUnique({
      where: { id },
      include: { translations: true, asset: true, coverAsset: true },
    });
    if (!row) throw ApiError.notFound('Factory media not found.');
    return this.toFactoryMediaDetail(row, locale);
  }

  async createFactoryMedia(
    input: CreateFactoryMediaInput,
    actorId: string,
    requestId: string,
  ): Promise<FactoryMediaAdminDetail> {
    await this.validateFactoryMediaInput(input);
    this.translationFlags(input.translations, true);
    if (input.status === 'published') {
      await this.assertFactoryMediaPublishable(input);
    }
    const created = await this.prisma.factoryMedia.create({
      data: {
        mediaType: input.mediaType,
        assetId: input.assetId ?? null,
        coverAssetId: input.coverAssetId ?? null,
        videoSourceType: input.videoSourceType ?? null,
        videoUrl: input.videoUrl ?? null,
        sourceNote: input.sourceNote ?? null,
        adminNote: input.adminNote ?? null,
        placements: input.placements,
        sortOrder: input.sortOrder,
        status: STATUS_MAP[input.status],
        publishedAt: input.status === 'published' ? new Date() : null,
        createdById: actorId,
        translations: {
          create: input.translations.map((translation) =>
            this.factoryMediaTranslation(translation),
          ),
        },
      },
      include: { translations: true, asset: true, coverAsset: true },
    });
    await this.audit.record({
      actorId,
      action: 'content.factory_media.created',
      entityType: 'factory_media',
      entityId: created.id,
      requestId,
      metadata: { mediaType: created.mediaType, placements: created.placements },
    });
    await this.revalidateContent('factory_media_created');
    return this.toFactoryMediaDetail(created, PUBLIC_LOCALE);
  }

  async updateFactoryMedia(
    id: string,
    input: UpdateFactoryMediaInput,
    actorId: string,
    requestId: string,
    canDeleteFile: boolean,
  ): Promise<FactoryMediaAdminDetail> {
    const current = await this.prisma.factoryMedia.findUnique({
      where: { id },
      include: { translations: true, asset: true, coverAsset: true },
    });
    if (!current) throw ApiError.notFound('Factory media not found.');
    if (input.translations) this.translationFlags(input.translations, true);
    await this.validateFactoryMediaInput({
      ...input,
      mediaType: input.mediaType ?? (current.mediaType as 'image' | 'video'),
    });
    const next = {
      mediaType: input.mediaType ?? current.mediaType,
      assetId: input.assetId !== undefined ? input.assetId : current.assetId,
      coverAssetId: input.coverAssetId !== undefined ? input.coverAssetId : current.coverAssetId,
      videoSourceType:
        input.videoSourceType !== undefined ? input.videoSourceType : current.videoSourceType,
      videoUrl: input.videoUrl !== undefined ? input.videoUrl : current.videoUrl,
      placements: input.placements ?? current.placements,
      status: input.status ?? this.statusValue(current.status),
      translations:
        input.translations ??
        current.translations.map((translation) => ({
          locale: translation.locale,
          title: translation.title,
          description: translation.description,
          altText: translation.altText,
        })),
    };
    if (next.status === 'published') {
      await this.assertFactoryMediaPublishable(next);
    }
    const oldAssets = [current.assetId, current.coverAssetId].filter((value): value is string =>
      Boolean(value),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.translations) {
        await tx.factoryMediaTranslation.deleteMany({ where: { mediaId: id } });
        await tx.factoryMediaTranslation.createMany({
          data: input.translations.map((translation) => ({
            mediaId: id,
            ...this.factoryMediaTranslation(translation),
          })),
        });
      }
      return tx.factoryMedia.update({
        where: { id },
        data: {
          ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
          ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
          ...(input.coverAssetId !== undefined ? { coverAssetId: input.coverAssetId } : {}),
          ...(input.videoSourceType !== undefined
            ? { videoSourceType: input.videoSourceType }
            : {}),
          ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
          ...(input.sourceNote !== undefined ? { sourceNote: input.sourceNote } : {}),
          ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
          ...(input.placements !== undefined ? { placements: input.placements } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.status !== undefined
            ? {
                status: STATUS_MAP[input.status],
                ...(input.status === 'published' && !current.publishedAt
                  ? { publishedAt: new Date() }
                  : {}),
              }
            : {}),
        },
        include: { translations: true, asset: true, coverAsset: true },
      });
    });
    if (canDeleteFile) {
      await this.disposeUnusedAssets(oldAssets, actorId, requestId);
    }
    await this.audit.record({
      actorId,
      action: 'content.factory_media.updated',
      entityType: 'factory_media',
      entityId: id,
      requestId,
      metadata: { fields: Object.keys(input).filter((field) => field !== 'adminNote') },
    });
    await this.revalidateContent('factory_media_updated');
    return this.toFactoryMediaDetail(updated, PUBLIC_LOCALE);
  }

  async setFactoryMediaStatus(
    id: string,
    status: PublishStatusValue,
    actorId: string,
    requestId: string,
  ) {
    const current = await this.prisma.factoryMedia.findUnique({
      where: { id },
      include: { translations: true, asset: true, coverAsset: true },
    });
    if (!current) throw ApiError.notFound('Factory media not found.');
    if (status === 'published') {
      await this.assertFactoryMediaPublishable({
        mediaType: current.mediaType,
        assetId: current.assetId,
        videoSourceType: current.videoSourceType,
        videoUrl: current.videoUrl,
        placements: current.placements,
        status,
        translations: current.translations,
      });
    }
    const updated = await this.prisma.factoryMedia.update({
      where: { id },
      data: {
        status: STATUS_MAP[status],
        ...(status === 'published' && !current.publishedAt ? { publishedAt: new Date() } : {}),
      },
      include: { translations: true, asset: true, coverAsset: true },
    });
    await this.audit.record({
      actorId,
      action:
        status === 'published'
          ? 'content.factory_media.published'
          : 'content.factory_media.unpublished',
      entityType: 'factory_media',
      entityId: id,
      requestId,
      metadata: { status },
    });
    await this.revalidateContent('factory_media_status');
    return this.toFactoryMediaDetail(updated, PUBLIC_LOCALE);
  }

  async deleteFactoryMedia(id: string, actorId: string, requestId: string, canDeleteFile: boolean) {
    const current = await this.prisma.factoryMedia.findUnique({ where: { id } });
    if (!current) throw ApiError.notFound('Factory media not found.');
    const references = await this.prisma.homeSection.count({ where: { itemIds: { has: id } } });
    if (references > 0) {
      throw new ApiError(ERROR_CODES.conflict, 'This media is referenced by a homepage section.', {
        status: 409,
        details: { references: 'home_section' },
      });
    }
    await this.prisma.factoryMedia.delete({ where: { id } });
    if (canDeleteFile) {
      await this.disposeUnusedAssets(
        [current.assetId, current.coverAssetId].filter((value): value is string => Boolean(value)),
        actorId,
        requestId,
      );
    }
    await this.audit.record({
      actorId,
      action: 'content.factory_media.deleted',
      entityType: 'factory_media',
      entityId: id,
      requestId,
      metadata: { mediaType: current.mediaType },
    });
    await this.revalidateContent('factory_media_deleted');
    return { deleted: true };
  }

  // ---------------------------------------------------------- factory process

  async listFactoryProcess(query: FactoryProcessListQueryInput) {
    const where: Prisma.FactoryProcessStepWhereInput = {
      ...(query.publishStatus !== 'all' ? { status: STATUS_MAP[query.publishStatus] } : {}),
      ...(query.q
        ? {
            translations: {
              some: {
                OR: [
                  { title: { contains: query.q, mode: 'insensitive' } },
                  { description: { contains: query.q, mode: 'insensitive' } },
                ],
              },
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.factoryProcessStep.count({ where }),
      this.prisma.factoryProcessStep.findMany({
        where,
        include: { translations: true, asset: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((row) => this.toFactoryProcessSummary(row, query.locale)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getFactoryProcessStep(id: string, locale: string): Promise<FactoryProcessStepAdminDetail> {
    const row = await this.prisma.factoryProcessStep.findUnique({
      where: { id },
      include: { translations: true, asset: true },
    });
    if (!row) throw ApiError.notFound('Factory process step not found.');
    return this.toFactoryProcessDetail(row, locale);
  }

  async createFactoryProcessStep(
    input: CreateFactoryProcessStepInput,
    actorId: string,
    requestId: string,
  ): Promise<FactoryProcessStepAdminDetail> {
    await this.validateProcessAsset(input.assetId);
    this.translationFlags(input.translations, true);
    if (input.status === 'published') this.assertProcessPublishable(input);
    const created = await this.prisma.factoryProcessStep.create({
      data: {
        assetId: input.assetId ?? null,
        sortOrder: input.sortOrder,
        status: STATUS_MAP[input.status],
        publishedAt: input.status === 'published' ? new Date() : null,
        adminNote: input.adminNote ?? null,
        createdById: actorId,
        translations: {
          create: input.translations.map((translation) => this.processTranslation(translation)),
        },
      },
      include: { translations: true, asset: true },
    });
    await this.audit.record({
      actorId,
      action: 'content.factory_process.created',
      entityType: 'factory_process_step',
      entityId: created.id,
      requestId,
    });
    await this.revalidateContent('factory_process_created');
    return this.toFactoryProcessDetail(created, PUBLIC_LOCALE);
  }

  async updateFactoryProcessStep(
    id: string,
    input: UpdateFactoryProcessStepInput,
    actorId: string,
    requestId: string,
    canDeleteFile: boolean,
  ): Promise<FactoryProcessStepAdminDetail> {
    const current = await this.prisma.factoryProcessStep.findUnique({
      where: { id },
      include: { translations: true, asset: true },
    });
    if (!current) throw ApiError.notFound('Factory process step not found.');
    if (input.translations) this.translationFlags(input.translations, true);
    await this.validateProcessAsset(input.assetId);
    const nextTranslations =
      input.translations ??
      current.translations.map((translation) => ({
        locale: translation.locale,
        title: translation.title,
        description: translation.description,
      }));
    if (input.status === 'published') {
      this.assertProcessPublishable({ ...input, translations: nextTranslations });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.translations) {
        await tx.factoryProcessStepTranslation.deleteMany({ where: { stepId: id } });
        await tx.factoryProcessStepTranslation.createMany({
          data: input.translations.map((translation) => ({
            stepId: id,
            ...this.processTranslation(translation),
          })),
        });
      }
      return tx.factoryProcessStep.update({
        where: { id },
        data: {
          ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.status !== undefined
            ? {
                status: STATUS_MAP[input.status],
                ...(input.status === 'published' && !current.publishedAt
                  ? { publishedAt: new Date() }
                  : {}),
              }
            : {}),
          ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
        },
        include: { translations: true, asset: true },
      });
    });
    if (canDeleteFile && current.assetId && current.assetId !== updated.assetId) {
      await this.disposeUnusedAssets([current.assetId], actorId, requestId);
    }
    await this.audit.record({
      actorId,
      action: 'content.factory_process.updated',
      entityType: 'factory_process_step',
      entityId: id,
      requestId,
    });
    await this.revalidateContent('factory_process_updated');
    return this.toFactoryProcessDetail(updated, PUBLIC_LOCALE);
  }

  async setFactoryProcessStatus(
    id: string,
    status: PublishStatusValue,
    actorId: string,
    requestId: string,
  ) {
    const current = await this.prisma.factoryProcessStep.findUnique({
      where: { id },
      include: { translations: true, asset: true },
    });
    if (!current) throw ApiError.notFound('Factory process step not found.');
    if (status === 'published') {
      this.assertProcessPublishable({
        status,
        translations: current.translations,
      });
    }
    const updated = await this.prisma.factoryProcessStep.update({
      where: { id },
      data: {
        status: STATUS_MAP[status],
        ...(status === 'published' && !current.publishedAt ? { publishedAt: new Date() } : {}),
      },
      include: { translations: true, asset: true },
    });
    await this.audit.record({
      actorId,
      action:
        status === 'published'
          ? 'content.factory_process.published'
          : 'content.factory_process.unpublished',
      entityType: 'factory_process_step',
      entityId: id,
      requestId,
    });
    await this.revalidateContent('factory_process_status');
    return this.toFactoryProcessDetail(updated, PUBLIC_LOCALE);
  }

  async deleteFactoryProcessStep(
    id: string,
    actorId: string,
    requestId: string,
    canDeleteFile: boolean,
  ) {
    const current = await this.prisma.factoryProcessStep.findUnique({ where: { id } });
    if (!current) throw ApiError.notFound('Factory process step not found.');
    await this.prisma.factoryProcessStep.delete({ where: { id } });
    if (canDeleteFile && current.assetId) {
      await this.disposeUnusedAssets([current.assetId], actorId, requestId);
    }
    await this.audit.record({
      actorId,
      action: 'content.factory_process.deleted',
      entityType: 'factory_process_step',
      entityId: id,
      requestId,
    });
    await this.revalidateContent('factory_process_deleted');
    return { deleted: true };
  }

  // -------------------------------------------------------------- credentials

  async listCredentials(query: CredentialListQueryInput) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const expiringUntil = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
    const where: Prisma.CredentialWhereInput = {
      ...(query.credentialType !== 'all' ? { credentialTypeCode: query.credentialType } : {}),
      ...(query.publishStatus !== 'all' ? { status: STATUS_MAP[query.publishStatus] } : {}),
      ...(query.q
        ? {
            OR: [
              { issuer: { contains: query.q, mode: 'insensitive' } },
              { credentialNumber: { contains: query.q, mode: 'insensitive' } },
              { translations: { some: { name: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(query.validityStatus === 'expired'
        ? { validityType: 'dated', validUntil: { lt: today } }
        : query.validityStatus === 'expiring'
          ? {
              validityType: 'dated',
              validUntil: { gte: today, lte: expiringUntil },
            }
          : query.validityStatus === 'valid'
            ? {
                OR: [
                  { validityType: { not: 'dated' } },
                  { validUntil: null },
                  { validUntil: { gte: today } },
                ],
              }
            : query.validityStatus === 'no_expiry'
              ? { OR: [{ validityType: { not: 'dated' } }, { validUntil: null }] }
              : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.credential.count({ where }),
      this.prisma.credential.findMany({
        where,
        include: { translations: true, primaryAsset: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((row) => this.toCredentialSummary(row, query.locale)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getCredential(id: string, locale: string): Promise<CredentialAdminDetail> {
    const row = await this.prisma.credential.findUnique({
      where: { id },
      include: { translations: true, primaryAsset: true },
    });
    if (!row) throw ApiError.notFound('Credential not found.');
    return this.toCredentialDetail(row, locale);
  }

  async createCredential(
    input: CreateCredentialInput,
    actorId: string,
    requestId: string,
  ): Promise<CredentialAdminDetail> {
    await this.validateCredentialInput(input);
    this.translationFlags(input.translations, true);
    if (input.status === 'published') await this.assertCredentialPublishable(input);
    const created = await this.prisma.credential.create({
      data: {
        credentialTypeCode: input.credentialTypeCode,
        issuer: input.issuer ?? null,
        credentialNumber: input.credentialNumber ?? null,
        issuedAt: this.dateValue(input.issuedAt),
        validFrom: this.dateValue(input.validFrom),
        validUntil: this.dateValue(input.validUntil),
        validityType: input.validityType,
        showExpiredBadge: input.showExpiredBadge,
        primaryAssetId: input.primaryAssetId ?? null,
        additionalAssetIds: input.additionalAssetIds,
        verificationUrl: input.verificationUrl ?? null,
        placements: input.placements,
        sortOrder: input.sortOrder,
        status: STATUS_MAP[input.status],
        publishedAt: input.status === 'published' ? new Date() : null,
        adminNote: input.adminNote ?? null,
        createdById: actorId,
        translations: {
          create: input.translations.map((translation) => this.credentialTranslation(translation)),
        },
      },
      include: { translations: true, primaryAsset: true },
    });
    await this.audit.record({
      actorId,
      action: 'content.credential.created',
      entityType: 'credential',
      entityId: created.id,
      requestId,
      metadata: { credentialTypeCode: created.credentialTypeCode },
    });
    await this.revalidateContent('credential_created');
    return this.toCredentialDetail(created, PUBLIC_LOCALE);
  }

  async updateCredential(
    id: string,
    input: UpdateCredentialInput,
    actorId: string,
    requestId: string,
    canDeleteFile: boolean,
  ): Promise<CredentialAdminDetail> {
    const current = await this.prisma.credential.findUnique({
      where: { id },
      include: { translations: true, primaryAsset: true },
    });
    if (!current) throw ApiError.notFound('Credential not found.');
    if (input.translations) this.translationFlags(input.translations, true);
    await this.validateCredentialInput(input);
    const nextTranslations =
      input.translations ??
      current.translations.map((translation) => ({
        locale: translation.locale,
        name: translation.name,
        description: translation.description,
        verificationLabel: translation.verificationLabel,
      }));
    if (input.status === 'published') {
      await this.assertCredentialPublishable({
        ...current,
        ...input,
        translations: nextTranslations,
      });
    }
    const oldAssets = [current.primaryAssetId, ...current.additionalAssetIds].filter(
      (value): value is string => Boolean(value),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.translations) {
        await tx.credentialTranslation.deleteMany({ where: { credentialId: id } });
        await tx.credentialTranslation.createMany({
          data: input.translations.map((translation) => ({
            credentialId: id,
            ...this.credentialTranslation(translation),
          })),
        });
      }
      return tx.credential.update({
        where: { id },
        data: {
          ...(input.credentialTypeCode !== undefined
            ? { credentialTypeCode: input.credentialTypeCode }
            : {}),
          ...(input.issuer !== undefined ? { issuer: input.issuer } : {}),
          ...(input.credentialNumber !== undefined
            ? { credentialNumber: input.credentialNumber }
            : {}),
          ...(input.issuedAt !== undefined ? { issuedAt: this.dateValue(input.issuedAt) } : {}),
          ...(input.validFrom !== undefined ? { validFrom: this.dateValue(input.validFrom) } : {}),
          ...(input.validUntil !== undefined
            ? { validUntil: this.dateValue(input.validUntil) }
            : {}),
          ...(input.validityType !== undefined ? { validityType: input.validityType } : {}),
          ...(input.showExpiredBadge !== undefined
            ? { showExpiredBadge: input.showExpiredBadge }
            : {}),
          ...(input.primaryAssetId !== undefined ? { primaryAssetId: input.primaryAssetId } : {}),
          ...(input.additionalAssetIds !== undefined
            ? { additionalAssetIds: input.additionalAssetIds }
            : {}),
          ...(input.verificationUrl !== undefined
            ? { verificationUrl: input.verificationUrl }
            : {}),
          ...(input.placements !== undefined ? { placements: input.placements } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.status !== undefined
            ? {
                status: STATUS_MAP[input.status],
                ...(input.status === 'published' && !current.publishedAt
                  ? { publishedAt: new Date() }
                  : {}),
              }
            : {}),
          ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
        },
        include: { translations: true, primaryAsset: true },
      });
    });
    if (canDeleteFile) {
      const nextAssetIds = new Set([updated.primaryAssetId, ...updated.additionalAssetIds]);
      await this.disposeUnusedAssets(
        oldAssets.filter((assetId) => !nextAssetIds.has(assetId)),
        actorId,
        requestId,
      );
    }
    await this.audit.record({
      actorId,
      action: 'content.credential.updated',
      entityType: 'credential',
      entityId: id,
      requestId,
    });
    await this.revalidateContent('credential_updated');
    return this.toCredentialDetail(updated, PUBLIC_LOCALE);
  }

  async setCredentialStatus(
    id: string,
    status: PublishStatusValue,
    actorId: string,
    requestId: string,
  ) {
    const current = await this.prisma.credential.findUnique({
      where: { id },
      include: { translations: true, primaryAsset: true },
    });
    if (!current) throw ApiError.notFound('Credential not found.');
    if (status === 'published') {
      await this.assertCredentialPublishable({
        ...current,
        status,
        translations: current.translations,
      });
    }
    const updated = await this.prisma.credential.update({
      where: { id },
      data: {
        status: STATUS_MAP[status],
        ...(status === 'published' && !current.publishedAt ? { publishedAt: new Date() } : {}),
      },
      include: { translations: true, primaryAsset: true },
    });
    await this.audit.record({
      actorId,
      action:
        status === 'published' ? 'content.credential.published' : 'content.credential.unpublished',
      entityType: 'credential',
      entityId: id,
      requestId,
    });
    await this.revalidateContent('credential_status');
    return this.toCredentialDetail(updated, PUBLIC_LOCALE);
  }

  async deleteCredential(id: string, actorId: string, requestId: string, canDeleteFile: boolean) {
    const current = await this.prisma.credential.findUnique({ where: { id } });
    if (!current) throw ApiError.notFound('Credential not found.');
    const references = await this.prisma.homeSection.count({ where: { itemIds: { has: id } } });
    if (references > 0) {
      throw new ApiError(
        ERROR_CODES.conflict,
        'This credential is referenced by a homepage section.',
        {
          status: 409,
          details: { references: 'home_section' },
        },
      );
    }
    await this.prisma.credential.delete({ where: { id } });
    if (canDeleteFile) {
      await this.disposeUnusedAssets(
        [current.primaryAssetId, ...current.additionalAssetIds].filter((value): value is string =>
          Boolean(value),
        ),
        actorId,
        requestId,
      );
    }
    await this.audit.record({
      actorId,
      action: 'content.credential.deleted',
      entityType: 'credential',
      entityId: id,
      requestId,
    });
    await this.revalidateContent('credential_deleted');
    return { deleted: true };
  }

  // ------------------------------------------------------------ home sections

  async listHomeSections(): Promise<HomeSectionAdminDetail[]> {
    const rows = await this.prisma.homeSection.findMany({
      include: { translations: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((row) => this.toHomeSectionDetail(row));
  }

  async updateHomeSection(
    code: string,
    input: UpdateHomeSectionInput,
    actorId: string,
    requestId: string,
  ): Promise<HomeSectionAdminDetail> {
    if (!(HOME_SECTION_CODES as readonly string[]).includes(code)) {
      throw ApiError.notFound('Homepage section not found.');
    }
    const current = await this.prisma.homeSection.findUnique({
      where: { code },
      include: { translations: true },
    });
    if (!current) throw ApiError.notFound('Homepage section not found.');
    if (input.translations) this.translationFlags(input.translations, true);
    if (input.itemIds) {
      await this.validateHomeSectionItems(code, input.itemIds);
    }
    if (input.enabled) {
      const nextTranslations =
        input.translations ??
        current.translations.map((translation) => ({
          locale: translation.locale,
          title: translation.title,
          description: translation.description,
          ctaLabel: translation.ctaLabel,
        }));
      this.assertHomeSectionTranslations(nextTranslations);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.translations) {
        await tx.homeSectionTranslation.deleteMany({ where: { sectionId: current.id } });
        await tx.homeSectionTranslation.createMany({
          data: input.translations.map((translation) => ({
            sectionId: current.id,
            ...this.homeSectionTranslation(translation),
          })),
        });
      }
      return tx.homeSection.update({
        where: { code },
        data: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.displayLimit !== undefined ? { displayLimit: input.displayLimit } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.itemIds !== undefined ? { itemIds: input.itemIds } : {}),
          ...(input.ctaUrl !== undefined ? { ctaUrl: input.ctaUrl || null } : {}),
          ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
        },
        include: { translations: true },
      });
    });
    await this.audit.record({
      actorId,
      action: 'content.home_section.updated',
      entityType: 'home_section',
      entityId: current.id,
      requestId,
      metadata: { code, fields: Object.keys(input).filter((field) => field !== 'adminNote') },
    });
    await this.revalidateContent('home_section_updated');
    return this.toHomeSectionDetail(updated);
  }

  // ------------------------------------------------------------------ public

  async publicFactory(locale: string): Promise<PublicFactoryContent> {
    const [page, mediaRows, processRows] = await Promise.all([
      this.content.getPublicPage('factory', locale),
      this.prisma.factoryMedia.findMany({
        where: { status: 'PUBLISHED' },
        include: { translations: true, asset: true, coverAsset: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 24,
      }),
      this.prisma.factoryProcessStep.findMany({
        where: { status: 'PUBLISHED' },
        include: { translations: true, asset: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 24,
      }),
    ]);
    return {
      page,
      media: mediaRows.map((row) => this.toPublicFactoryMedia(row, locale)),
      process: processRows.map((row) => this.toPublicProcessStep(row, locale)),
    };
  }

  async publicQuality(locale: string): Promise<PublicQualityContent> {
    const [page, rows, type] = await Promise.all([
      this.content.getPublicPage('quality', locale),
      this.prisma.credential.findMany({
        where: { status: 'PUBLISHED' },
        include: { translations: true, primaryAsset: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 60,
      }),
      this.prisma.dictionaryType.findUnique({
        where: { code: DICTIONARY_TYPES.credentialType },
        include: { items: { include: { translations: true } } },
      }),
    ]);
    const labels = Object.fromEntries(
      (type?.items ?? []).map((item) => [
        item.code,
        this.pickLabel(item.translations, locale)?.label ?? item.code,
      ]),
    );
    return {
      page,
      credentials: rows.map((row) => this.toPublicCredential(row, locale, labels)),
    };
  }

  async publicHomeSections(locale: string): Promise<PublicHomeSection[]> {
    const sections = await this.prisma.homeSection.findMany({
      where: { enabled: true },
      include: { translations: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    const results: PublicHomeSection[] = [];
    for (const section of sections) {
      if (section.code === 'home.factory-preview') {
        const mediaRows = await this.prisma.factoryMedia.findMany({
          where: { id: { in: section.itemIds }, status: 'PUBLISHED' },
          include: { translations: true, asset: true, coverAsset: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 24,
        });
        const mediaById = new Map(mediaRows.map((row) => [row.id, row]));
        const media = section.itemIds
          .map((id) => mediaById.get(id))
          .filter((row): row is FactoryMediaRow => row !== undefined)
          .slice(0, section.displayLimit);
        if (media.length === 0) continue;
        results.push(
          this.toPublicHomeSection(
            section,
            locale,
            media.map((row) => {
              const item = this.toPublicFactoryMedia(row, locale);
              return {
                id: item.id,
                title: item.title,
                imageUrl: item.imageUrl ?? item.coverUrl,
                mediaType: item.mediaType,
              };
            }),
          ),
        );
      } else if (section.code === 'home.quality-preview') {
        const credentialRows = await this.prisma.credential.findMany({
          where: { id: { in: section.itemIds }, status: 'PUBLISHED' },
          include: { translations: true, primaryAsset: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 24,
        });
        const credentialById = new Map(credentialRows.map((row) => [row.id, row]));
        const credentials = section.itemIds
          .map((id) => credentialById.get(id))
          .filter((row): row is CredentialRow => row !== undefined)
          .slice(0, section.displayLimit);
        if (credentials.length === 0) continue;
        results.push(
          this.toPublicHomeSection(
            section,
            locale,
            credentials.map((row) => {
              const item = this.toPublicCredential(row, locale);
              return {
                id: item.id,
                title: item.name,
                imageUrl: item.imageUrl,
                mediaType: 'credential' as const,
              };
            }),
          ),
        );
      }
    }
    return results;
  }

  // ----------------------------------------------------------------- helpers

  private factoryMediaTranslation(input: {
    locale: string;
    title: string;
    description?: string | null;
    altText?: string | null;
  }): Omit<FactoryMediaTranslation, 'mediaId'> {
    return {
      locale: input.locale,
      title: input.title,
      description: input.description ?? null,
      altText: input.altText ?? null,
    };
  }

  private processTranslation(input: {
    locale: string;
    title: string;
    description?: string | null;
  }): Omit<FactoryProcessStepTranslation, 'stepId'> {
    return {
      locale: input.locale,
      title: input.title,
      description: input.description ?? null,
    };
  }

  private credentialTranslation(input: {
    locale: string;
    name: string;
    description?: string | null;
    verificationLabel?: string | null;
  }): Omit<CredentialTranslation, 'credentialId'> {
    return {
      locale: input.locale,
      name: input.name,
      description: input.description ?? null,
      verificationLabel: input.verificationLabel ?? null,
    };
  }

  private homeSectionTranslation(input: {
    locale: string;
    title: string;
    description?: string | null;
    ctaLabel?: string | null;
  }): Omit<HomeSectionTranslation, 'sectionId'> {
    return {
      locale: input.locale,
      title: input.title,
      description: input.description ?? null,
      ctaLabel: input.ctaLabel ?? null,
    };
  }

  private pickLabel<T extends { locale: string }>(
    translations: T[],
    locale: string,
  ): T | undefined {
    return (
      translations.find((translation) => translation.locale === locale) ??
      translations.find((translation) => translation.locale === PUBLIC_LOCALE) ??
      translations[0]
    );
  }

  private statusValue(status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'): PublishStatusValue {
    return status.toLowerCase() as PublishStatusValue;
  }

  private translationFlags(
    translations: { locale: string }[],
    requireEnglish: boolean,
  ): { hasEnglish: boolean } {
    const hasEnglish = translations.some((translation) => translation.locale === PUBLIC_LOCALE);
    if (requireEnglish && !hasEnglish) {
      throw ApiError.validation('English content is required.', {
        translations: 'content.englishRequired',
      });
    }
    return { hasEnglish };
  }

  private toFactoryMediaSummary(row: FactoryMediaRow, locale: string): FactoryMediaAdminSummary {
    const translation = this.pickLabel(row.translations, locale);
    return {
      id: row.id,
      mediaType: row.mediaType as 'image' | 'video',
      title: translation?.title ?? row.id,
      status: row.status.toLowerCase() as PublishStatusValue,
      placements: row.placements,
      sortOrder: row.sortOrder,
      thumbnailUrl: row.coverAsset
        ? this.storage.publicUrl(row.coverAsset.storageKey)
        : row.asset
          ? this.storage.publicUrl(row.asset.storageKey)
          : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toFactoryMediaDetail(row: FactoryMediaRow, locale: string): FactoryMediaAdminDetail {
    return {
      ...this.toFactoryMediaSummary(row, locale),
      assetId: row.assetId,
      assetUrl: row.asset ? this.storage.publicUrl(row.asset.storageKey) : null,
      coverAssetId: row.coverAssetId,
      coverAssetUrl: row.coverAsset ? this.storage.publicUrl(row.coverAsset.storageKey) : null,
      videoSourceType: row.videoSourceType as 'upload' | 'external' | null,
      videoUrl: row.videoUrl,
      sourceNote: row.sourceNote,
      adminNote: row.adminNote,
      translations: Object.fromEntries(
        row.translations.map((translation) => [
          translation.locale,
          {
            title: translation.title,
            description: translation.description,
            altText: translation.altText,
          },
        ]),
      ),
    };
  }

  private toFactoryProcessSummary(
    row: FactoryProcessRow,
    locale: string,
  ): FactoryProcessStepAdminSummary {
    const translation = this.pickLabel(row.translations, locale);
    return {
      id: row.id,
      title: translation?.title ?? row.id,
      status: row.status.toLowerCase() as PublishStatusValue,
      sortOrder: row.sortOrder,
      thumbnailUrl: row.asset ? this.storage.publicUrl(row.asset.storageKey) : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toFactoryProcessDetail(
    row: FactoryProcessRow,
    locale: string,
  ): FactoryProcessStepAdminDetail {
    return {
      ...this.toFactoryProcessSummary(row, locale),
      assetId: row.assetId,
      assetUrl: row.asset ? this.storage.publicUrl(row.asset.storageKey) : null,
      adminNote: row.adminNote,
      translations: Object.fromEntries(
        row.translations.map((translation) => [
          translation.locale,
          { title: translation.title, description: translation.description },
        ]),
      ),
    };
  }

  private toCredentialSummary(row: CredentialRow, locale: string): CredentialAdminSummary {
    const translation = this.pickLabel(row.translations, locale);
    return {
      id: row.id,
      name: translation?.name ?? row.id,
      credentialTypeCode: row.credentialTypeCode,
      issuer: row.issuer,
      credentialNumber: row.credentialNumber,
      validFrom: row.validFrom?.toISOString().slice(0, 10) ?? null,
      validUntil: row.validUntil?.toISOString().slice(0, 10) ?? null,
      validityType: row.validityType as CredentialAdminSummary['validityType'],
      status: row.status.toLowerCase() as PublishStatusValue,
      placements: row.placements,
      sortOrder: row.sortOrder,
      thumbnailUrl: row.primaryAsset ? this.storage.publicUrl(row.primaryAsset.storageKey) : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCredentialDetail(row: CredentialRow, locale: string): CredentialAdminDetail {
    return {
      ...this.toCredentialSummary(row, locale),
      issuedAt: row.issuedAt?.toISOString().slice(0, 10) ?? null,
      showExpiredBadge: row.showExpiredBadge,
      primaryAssetId: row.primaryAssetId,
      primaryAssetUrl: row.primaryAsset
        ? this.storage.publicUrl(row.primaryAsset.storageKey)
        : null,
      additionalAssetIds: row.additionalAssetIds,
      verificationUrl: row.verificationUrl,
      adminNote: row.adminNote,
      translations: Object.fromEntries(
        row.translations.map((translation) => [
          translation.locale,
          {
            name: translation.name,
            description: translation.description,
            verificationLabel: translation.verificationLabel,
          },
        ]),
      ),
    };
  }

  private toHomeSectionDetail(row: HomeSectionRow): HomeSectionAdminDetail {
    return {
      id: row.id,
      code: row.code as HomeSectionAdminDetail['code'],
      enabled: row.enabled,
      displayLimit: row.displayLimit,
      sortOrder: row.sortOrder,
      itemIds: row.itemIds,
      ctaUrl: row.ctaUrl,
      adminNote: row.adminNote,
      translations: Object.fromEntries(
        row.translations.map((translation) => [
          translation.locale,
          {
            title: translation.title,
            description: translation.description,
            ctaLabel: translation.ctaLabel,
          },
        ]),
      ),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toPublicFactoryMedia(row: FactoryMediaRow, locale: string): PublicFactoryMedia {
    const translation = this.pickLabel(row.translations, locale);
    const mediaUrl = row.asset ? this.storage.publicUrl(row.asset.storageKey) : null;
    return {
      id: row.id,
      mediaType: row.mediaType as 'image' | 'video',
      title: translation?.title ?? '',
      description: translation?.description ?? null,
      imageUrl: row.mediaType === 'image' ? mediaUrl : null,
      videoUrl:
        row.mediaType === 'video'
          ? row.videoSourceType === 'external'
            ? row.videoUrl
            : mediaUrl
          : null,
      coverUrl: row.coverAsset ? this.storage.publicUrl(row.coverAsset.storageKey) : null,
      altText: translation?.altText ?? translation?.title ?? null,
      placements: row.placements,
      sortOrder: row.sortOrder,
    };
  }

  private toPublicProcessStep(row: FactoryProcessRow, locale: string): PublicFactoryProcessStep {
    const translation = this.pickLabel(row.translations, locale);
    return {
      id: row.id,
      title: translation?.title ?? '',
      description: translation?.description ?? null,
      imageUrl: row.asset ? this.storage.publicUrl(row.asset.storageKey) : null,
      altText: translation?.title ?? null,
      sortOrder: row.sortOrder,
    };
  }

  private toPublicCredential(
    row: CredentialRow,
    locale: string,
    typeLabels: Record<string, string> = {},
  ): PublicCredential {
    const translation = this.pickLabel(row.translations, locale);
    const expired = isCredentialExpired(
      row.validityType as PublicCredential['validityType'],
      row.validUntil,
    );
    const primaryUrl = row.primaryAsset
      ? this.storage.publicUrl(row.primaryAsset.storageKey)
      : null;
    return {
      id: row.id,
      name: translation?.name ?? '',
      credentialTypeCode: row.credentialTypeCode,
      credentialTypeLabel: typeLabels[row.credentialTypeCode] ?? row.credentialTypeCode,
      issuer: row.issuer,
      description: translation?.description ?? null,
      issuedAt: row.issuedAt?.toISOString().slice(0, 10) ?? null,
      validFrom: row.validFrom?.toISOString().slice(0, 10) ?? null,
      validUntil: row.validUntil?.toISOString().slice(0, 10) ?? null,
      validityType: row.validityType as PublicCredential['validityType'],
      expired,
      imageUrl: row.primaryAsset?.mimeType.startsWith('image/') === true ? primaryUrl : null,
      documentUrl: primaryUrl,
      verificationUrl: row.verificationUrl,
      verificationLabel: translation?.verificationLabel ?? null,
      sortOrder: row.sortOrder,
    };
  }

  private toPublicHomeSection(
    row: HomeSectionRow,
    locale: string,
    items: PublicHomeSection['items'],
  ): PublicHomeSection {
    const translation = this.pickLabel(row.translations, locale);
    return {
      code: row.code,
      title: translation?.title ?? row.code,
      description: translation?.description ?? null,
      ctaLabel: translation?.ctaLabel ?? null,
      ctaUrl:
        row.ctaUrl ??
        (row.code === 'home.factory-preview' ? `/${locale}/factory` : `/${locale}/quality`),
      sortOrder: row.sortOrder,
      items,
    };
  }

  private async validateFactoryMediaInput(input: {
    mediaType?: 'image' | 'video';
    assetId?: string | null;
    coverAssetId?: string | null;
    videoSourceType?: 'upload' | 'external' | null;
    videoUrl?: string | null;
    placements?: string[];
  }): Promise<void> {
    if (input.assetId) {
      const purposes =
        input.mediaType === 'video' ? [FACTORY_VIDEO_PURPOSE] : [FACTORY_IMAGE_PURPOSE];
      await this.requireAsset(input.assetId, purposes, 'assetId');
    }
    if (input.coverAssetId) {
      await this.requireAsset(input.coverAssetId, ASSET_IMAGE_PURPOSES, 'coverAssetId');
    }
    if (input.videoSourceType === 'external' && !input.videoUrl) {
      throw ApiError.validation('An external video requires an HTTPS URL.', {
        videoUrl: 'content.videoUrl.required',
      });
    }
    if (input.placements) {
      for (const placement of input.placements) {
        if (!(FACTORY_MEDIA_PLACEMENTS as readonly string[]).includes(placement)) {
          throw ApiError.validation('Unknown media placement.', { placements: placement });
        }
      }
    }
  }

  private async assertFactoryMediaPublishable(input: {
    status?: string;
    mediaType: string;
    assetId?: string | null;
    videoSourceType?: string | null;
    videoUrl?: string | null;
    placements: string[];
    translations: { locale: string; title: string }[];
  }): Promise<void> {
    if (
      !input.translations.some(
        (translation) => translation.locale === PUBLIC_LOCALE && translation.title.trim(),
      )
    ) {
      throw ApiError.validation('English title is required before publication.', {
        translations: 'content.englishRequired',
      });
    }
    if (input.mediaType === 'image' && !input.assetId) {
      throw ApiError.validation('An image file is required before publication.', {
        assetId: 'content.asset.required',
      });
    }
    if (input.mediaType === 'video' && input.videoSourceType === 'external' && !input.videoUrl) {
      throw ApiError.validation('A video URL is required before publication.', {
        videoUrl: 'content.videoUrl.required',
      });
    }
    if (input.mediaType === 'video' && input.videoSourceType !== 'external' && !input.assetId) {
      throw ApiError.validation('A video file is required before publication.', {
        assetId: 'content.asset.required',
      });
    }
    if (input.placements.length === 0) {
      throw ApiError.validation('Select at least one placement before publication.', {
        placements: 'content.placements.required',
      });
    }
  }

  private async validateProcessAsset(assetId: string | null | undefined): Promise<void> {
    if (assetId) await this.requireAsset(assetId, [PROCESS_IMAGE_PURPOSE], 'assetId');
  }

  private assertProcessPublishable(input: {
    status?: string;
    translations: { locale: string; title: string }[];
  }): void {
    if (
      !input.translations.some(
        (translation) => translation.locale === PUBLIC_LOCALE && translation.title.trim(),
      )
    ) {
      throw ApiError.validation('English title is required before publication.', {
        translations: 'content.englishRequired',
      });
    }
  }

  private async validateCredentialInput(input: {
    credentialTypeCode?: string;
    primaryAssetId?: string | null;
    additionalAssetIds?: string[];
    validFrom?: string | null;
    validUntil?: string | null;
    verificationUrl?: string | null;
  }): Promise<void> {
    if (input.credentialTypeCode) {
      const type = await this.prisma.dictionaryType.findUnique({
        where: { code: DICTIONARY_TYPES.credentialType },
        include: { items: { where: { code: input.credentialTypeCode } } },
      });
      const item = type?.items[0];
      if (!type || !item || !item.enabled) {
        throw ApiError.validation('Unknown or disabled credential type.', {
          credentialTypeCode: 'content.credentialType.invalid',
        });
      }
    }
    if (input.primaryAssetId) {
      await this.requireAsset(
        input.primaryAssetId,
        [CREDENTIAL_DOCUMENT_PURPOSE],
        'primaryAssetId',
      );
    }
    for (const assetId of input.additionalAssetIds ?? []) {
      await this.requireAsset(assetId, [CREDENTIAL_DOCUMENT_PURPOSE], 'additionalAssetIds');
    }
    if (!isValidityOrderValid(input.validFrom, input.validUntil)) {
      throw ApiError.validation('The validity end date must not be earlier than the start date.', {
        validUntil: 'content.validity.order',
      });
    }
  }

  private async assertCredentialPublishable(input: {
    status?: string;
    credentialTypeCode?: string;
    credentialType?: string;
    primaryAssetId?: string | null;
    validFrom?: string | Date | null;
    validUntil?: string | Date | null;
    verificationUrl?: string | null;
    translations: { locale: string; name: string }[];
  }): Promise<void> {
    if (
      !input.translations.some(
        (translation) => translation.locale === PUBLIC_LOCALE && translation.name.trim(),
      )
    ) {
      throw ApiError.validation('English name is required before publication.', {
        translations: 'content.englishRequired',
      });
    }
    const typeCode = input.credentialTypeCode ?? input.credentialType;
    if (typeCode) await this.validateCredentialInput({ credentialTypeCode: typeCode });
    if (!isValidityOrderValid(input.validFrom, input.validUntil)) {
      throw ApiError.validation('The validity end date must not be earlier than the start date.', {
        validUntil: 'content.validity.order',
      });
    }
  }

  private assertHomeSectionTranslations(translations: { locale: string; title: string }[]): void {
    if (
      !translations.some(
        (translation) => translation.locale === PUBLIC_LOCALE && translation.title.trim(),
      )
    ) {
      throw ApiError.validation('English title is required when a section is enabled.', {
        translations: 'content.englishRequired',
      });
    }
  }

  private async validateHomeSectionItems(code: string, itemIds: string[]): Promise<void> {
    if (new Set(itemIds).size !== itemIds.length) {
      throw ApiError.validation('The same item was selected twice.', {
        itemIds: 'content.duplicate',
      });
    }
    const itemKind = homeSectionItemKind(code);
    if (itemKind === 'factory_media') {
      const count = await this.prisma.factoryMedia.count({
        where: { id: { in: itemIds }, status: 'PUBLISHED' },
      });
      if (count !== itemIds.length) {
        throw ApiError.validation('Only published factory media can be selected.', {
          itemIds: 'content.unpublished',
        });
      }
    } else if (itemKind === 'credential') {
      const count = await this.prisma.credential.count({
        where: { id: { in: itemIds }, status: 'PUBLISHED' },
      });
      if (count !== itemIds.length) {
        throw ApiError.validation('Only published credentials can be selected.', {
          itemIds: 'content.unpublished',
        });
      }
    }
  }

  private async requireAsset(id: string, purposes: string[], field: string): Promise<FileAsset> {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id } });
    if (!asset || asset.status !== 'ready' || !asset.isPublic) {
      throw ApiError.validation('The selected asset is unavailable.', {
        [field]: 'content.asset.invalid',
      });
    }
    if (!purposes.includes(asset.purpose)) {
      throw ApiError.validation('The selected asset has the wrong purpose.', {
        [field]: 'content.asset.purpose',
      });
    }
    return asset;
  }

  private dateValue(value: string | null | undefined): Date | null {
    return value ? new Date(`${value}T00:00:00.000Z`) : null;
  }

  private async disposeUnusedAssets(
    assetIds: string[],
    actorId: string,
    requestId: string,
  ): Promise<void> {
    for (const assetId of [...new Set(assetIds)]) {
      if (await this.assetIsReferenced(assetId)) continue;
      try {
        await this.files.remove(assetId, actorId, requestId);
      } catch (error) {
        this.logger.warn('content.asset_delete_skipped', {
          assetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async assetIsReferenced(assetId: string): Promise<boolean> {
    const [
      factoryMedia,
      processSteps,
      credentials,
      productImages,
      categoryCovers,
      ads,
      pdfSources,
    ] = await Promise.all([
      this.prisma.factoryMedia.count({
        where: { OR: [{ assetId }, { coverAssetId: assetId }] },
      }),
      this.prisma.factoryProcessStep.count({ where: { assetId } }),
      this.prisma.credential.count({
        where: { OR: [{ primaryAssetId: assetId }, { additionalAssetIds: { has: assetId } }] },
      }),
      this.prisma.productImage.count({ where: { fileAssetId: assetId } }),
      this.prisma.category.count({ where: { coverFileAssetId: assetId } }),
      this.prisma.ad.count({
        where: { OR: [{ desktopAssetId: assetId }, { mobileAssetId: assetId }] },
      }),
      this.prisma.pdfConversionJob.count({ where: { sourceAssetId: assetId } }),
    ]);
    return (
      factoryMedia +
        processSteps +
        credentials +
        productImages +
        categoryCovers +
        ads +
        pdfSources >
      0
    );
  }

  private async revalidateContent(reason: string): Promise<void> {
    const secret = this.env.REVALIDATE_SECRET;
    if (!secret) return;
    try {
      const response = await fetch(`${this.env.APP_BASE_URL}/api/revalidate?tag=content`, {
        method: 'POST',
        headers: { 'x-revalidate-secret': secret },
      });
      if (!response.ok) {
        this.logger.warn('content.revalidate_failed', { reason, status: response.status });
      }
    } catch (error) {
      this.logger.warn('content.revalidate_failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
