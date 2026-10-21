import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import type { PublicAd } from '@b2b/contracts';
import type { UpsertAdInput } from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list() {
    const ads = await this.prisma.ad.findMany({
      orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }],
      include: { translations: true },
    });
    return ads.map((ad) => ({
      id: ad.id,
      code: ad.code,
      placement: ad.placement,
      targetUrl: ad.targetUrl,
      desktopAssetId: ad.desktopAssetId,
      mobileAssetId: ad.mobileAssetId,
      activeFrom: ad.activeFrom?.toISOString() ?? null,
      activeTo: ad.activeTo?.toISOString() ?? null,
      sortOrder: ad.sortOrder,
      enabled: ad.enabled,
      translations: Object.fromEntries(
        ad.translations.map((translation) => [
          translation.locale,
          { title: translation.title, description: translation.description },
        ]),
      ),
      updatedAt: ad.updatedAt.toISOString(),
    }));
  }

  async upsert(input: UpsertAdInput) {
    const activeFrom = input.activeFrom ? new Date(input.activeFrom) : null;
    const activeTo = input.activeTo ? new Date(input.activeTo) : null;
    if (activeFrom && activeTo && activeFrom.getTime() > activeTo.getTime()) {
      throw ApiError.validation('The start date must be before the end date.', {
        activeFrom: 'validation.datetime.invalid',
      });
    }

    const existing = await this.prisma.ad.findUnique({ where: { code: input.code } });
    const ad = existing
      ? await this.prisma.ad.update({
          where: { code: input.code },
          data: {
            placement: input.placement,
            desktopAssetId: input.desktopAssetId ?? null,
            mobileAssetId: input.mobileAssetId ?? null,
            targetUrl: input.targetUrl ?? null,
            activeFrom,
            activeTo,
            sortOrder: input.sortOrder,
            enabled: input.enabled,
          },
        })
      : await this.prisma.ad.create({
          data: {
            code: input.code,
            placement: input.placement,
            desktopAssetId: input.desktopAssetId ?? null,
            mobileAssetId: input.mobileAssetId ?? null,
            targetUrl: input.targetUrl ?? null,
            activeFrom,
            activeTo,
            sortOrder: input.sortOrder,
            enabled: input.enabled,
          },
        });

    for (const translation of input.translations) {
      await this.prisma.adTranslation.upsert({
        where: { adId_locale: { adId: ad.id, locale: translation.locale } },
        create: {
          adId: ad.id,
          locale: translation.locale,
          title: translation.title ?? null,
          description: translation.description ?? null,
        },
        update: { title: translation.title ?? null, description: translation.description ?? null },
      });
    }
    return ad;
  }

  async remove(id: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id } });
    if (!ad) throw ApiError.notFound('Ad not found.');
    await this.prisma.ad.delete({ where: { id } });
    return { deleted: true };
  }

  // The storefront only ever sees ads that are enabled and inside their window.
  async listPublic(placement: string, locale: string): Promise<PublicAd[]> {
    const now = new Date();
    const ads = await this.prisma.ad.findMany({
      where: {
        placement,
        enabled: true,
        AND: [
          { OR: [{ activeFrom: null }, { activeFrom: { lte: now } }] },
          { OR: [{ activeTo: null }, { activeTo: { gte: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { translations: true },
    });
    return ads.map((ad) => {
      const translation =
        ad.translations.find((item) => item.locale === locale) ??
        ad.translations.find((item) => item.locale === 'en-US');
      return {
        id: ad.id,
        code: ad.code,
        placement: ad.placement as PublicAd['placement'],
        title: translation?.title ?? null,
        description: translation?.description ?? null,
        desktopImageUrl: ad.desktopAssetId ? null : null,
        mobileImageUrl: null,
        targetUrl: ad.targetUrl,
        sortOrder: ad.sortOrder,
      };
    });
  }

  /** Resolves asset ids to public URLs for the storefront payload. */
  async listPublicWithImages(placement: string, locale: string): Promise<PublicAd[]> {
    const ads = await this.listPublic(placement, locale);
    const ids = ads.map((ad) => ad.id);
    if (ids.length === 0) return ads;
    const rows = await this.prisma.ad.findMany({
      where: { id: { in: ids } },
      include: { desktopAsset: true, mobileAsset: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ads.map((ad) => {
      const row = byId.get(ad.id);
      return {
        ...ad,
        desktopImageUrl: row?.desktopAsset ? this.storage.publicUrl(row.desktopAsset.storageKey) : null,
        mobileImageUrl: row?.mobileAsset ? this.storage.publicUrl(row.mobileAsset.storageKey) : null,
      };
    });
  }

  async assertAssetsExist(ids: (string | null | undefined)[]): Promise<void> {
    const valid = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (valid.length === 0) return;
    const found = await this.prisma.fileAsset.count({ where: { id: { in: valid } } });
    if (found !== valid.length) {
      throw new ApiError(ERROR_CODES.validationFailed, 'One or more referenced images do not exist.');
    }
  }
}
