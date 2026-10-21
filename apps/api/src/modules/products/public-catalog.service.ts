import { Injectable } from '@nestjs/common';
import { PUBLIC_LOCALE, imageAssetVersion, imageVariantStorageKey } from '@b2b/contracts';
import type {
  PublicCategoryRef,
  PublicImageVariant,
  PublicProductCard,
  PublicProductDetail,
  PublicProductImage,
  PublicProductSpecs,
} from '@b2b/contracts';
import type { PublicProductListQuery } from '@b2b/validation';
import type { Prisma } from '@b2b/database';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { allowedTagColorToken, publicTagLabel } from '../tags/tag-policy';
import { readStoredImageVariants } from '../files/image-variant-policy';

// Explicit field whitelist for the public catalogue.
//
// `priceCny` is deliberately absent and must stay absent: the storefront reads
// only these projections, so no internal price can reach public JSON, SSR props
// or cached payloads (docs/04 §6, docs/13 §2).
export const PUBLIC_PRODUCT_SELECT = {
  id: true,
  sku: true,
  slug: true,
  lifecycleStatus: true,
  sortOrder: true,
  packaging: true,
  lengthMm: true,
  widthMm: true,
  heightMm: true,
  weightGrams: true,
  cartonLengthCm: true,
  cartonWidthCm: true,
  cartonHeightCm: true,
  cartonWeightKg: true,
  cartonQuantity: true,
  createdAt: true,
  updatedAt: true,
  translations: { select: { locale: true, name: true, description: true } },
  images: {
    // Only images whose stored object still exists are publicly addressable.
    // A row that is pending (or failed) a physical delete is not "hidden with
    // CSS": it is filtered at the query, so no public DTO can mention it and the
    // storefront cannot render a URL whose object is about to disappear
    // (docs/24 §4.4, §10).
    where: {
      deleteState: 'READY',
      OR: [{ fileAssetId: null }, { asset: { is: { isPublic: true } } }],
    },
    select: {
      storageKey: true,
      altText: true,
      sortOrder: true,
      isCover: true,
      width: true,
      height: true,
      asset: {
        select: {
          id: true,
          sha256: true,
          status: true,
          derivatives: true,
        },
      },
    },
    orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
  },
  category: {
    select: { id: true, slug: true, translations: { select: { locale: true, name: true } } },
  },
  tags: {
    // Disabled tags never reach the storefront (docs/23 §8.2): the badge is
    // filtered at the query so no downstream DTO has to remember to drop it.
    where: { tag: { enabled: true } },
    select: {
      tag: {
        select: {
          code: true,
          colorToken: true,
          translations: { select: { locale: true, label: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

// Row shape produced by the whitelist above. Note there is no `priceCny` member:
// TypeScript fails the build if a price field is added to the projection.
export type PublicProductRow = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_SELECT }>;
type PublicImageRow = PublicProductRow['images'][number];

const PUBLIC_WHERE = {
  publishStatus: 'PUBLISHED' as const,
  lifecycleStatus: { not: 'DISCONTINUED' as const },
};

const SORT_MAP = {
  featured: [{ sortOrder: 'asc' }, { sku: 'asc' }],
  newest: [{ createdAt: 'desc' }, { sku: 'asc' }],
  name: [{ sortOrder: 'asc' }, { sku: 'asc' }],
  sku: [{ sku: 'asc' }],
  sort_order: [{ sortOrder: 'asc' }, { sku: 'asc' }],
} as const;

@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly categories: CategoriesService,
  ) {}

  async list(query: PublicProductListQuery) {
    const where = {
      ...PUBLIC_WHERE,
      // A requested category resolves to the node plus its publicly reachable
      // descendants. An unknown or hidden slug yields an empty id list - never
      // "no filter" - so a hidden branch cannot widen the query to the whole
      // catalogue (docs/22 §7.1-§7.2).
      ...(query.category
        ? {
            categoryId: {
              in:
                (await this.categories.resolvePublicCategoryScope(
                  { categorySlug: query.category },
                  { includeDescendants: query.includeDescendants !== false },
                )) ?? [],
            },
          }
        : {}),
      // Marketing display is read from tags, not the legacy booleans. A tag
      // that is disabled is hidden from visitors and therefore cannot act as a
      // collection facet either.
      ...(query.featured ? { tags: { some: { tag: { code: 'featured', enabled: true } } } } : {}),
      ...(query.isNew ? { tags: { some: { tag: { code: 'new-arrival', enabled: true } } } } : {}),
      ...(query.isPreOrder ? { tags: { some: { tag: { code: 'preorder', enabled: true } } } } : {}),
      ...(query.lifecycle ? { lifecycleStatus: uppercaseLifecycle(query.lifecycle) } : {}),
      // A disabled tag is hidden from visitors, so it cannot be used as a
      // browse facet either (docs/23 §8.2).
      ...(query.tag ? { tags: { some: { tag: { code: query.tag, enabled: true } } } } : {}),
      ...(query.q
        ? {
            OR: [
              { sku: { contains: query.q, mode: 'insensitive' as const } },
              {
                translations: {
                  some: { name: { contains: query.q, mode: 'insensitive' as const } },
                },
              },
              {
                translations: {
                  some: { description: { contains: query.q, mode: 'insensitive' as const } },
                },
              },
            ],
          }
        : {}),
    };

    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [...SORT_MAP[query.sortBy]],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: PUBLIC_PRODUCT_SELECT,
      }),
    ]);

    return {
      data: products.map((product) => this.toPublicCard(product, query.locale ?? PUBLIC_LOCALE)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detailBySlug(slug: string, locale = PUBLIC_LOCALE): Promise<PublicProductDetail | null> {
    const product = await this.prisma.product.findFirst({
      where: { slug, ...PUBLIC_WHERE },
      select: { ...PUBLIC_PRODUCT_SELECT, categoryId: true },
    });
    if (!product) return null;

    const card = this.toPublicCard(product);
    const breadcrumb: PublicCategoryRef[] = product.categoryId
      ? await this.categories
          .getAncestors(product.categoryId)
          .then((chain) => chain.map((item) => ({ id: item.id, slug: item.slug, name: item.name })))
      : [];
    const english = product.translations.find((translation) => translation.locale === locale);

    return {
      ...card,
      description: english?.description ?? product.translations[0]?.description ?? null,
      images: product.images.map((image) => this.toPublicImage(image)),
      specs: this.toSpecs(product),
      categories: card.category ? [card.category] : [],
      breadcrumb,
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  /** Resolves SKUs that are publicly visible; used to validate inquiry intents. */
  async findPublicSkus(skus: string[]) {
    if (skus.length === 0) return [];
    return this.prisma.product.findMany({
      where: { sku: { in: skus }, ...PUBLIC_WHERE },
      select: { sku: true, slug: true, translations: { select: { locale: true, name: true } } },
    });
  }

  async featured(limit: number, locale: string = PUBLIC_LOCALE) {
    return this.collectionList(
      { tags: { some: { tag: { code: 'featured', enabled: true } } } },
      limit,
      locale,
    );
  }

  async newArrivals(limit: number, locale: string = PUBLIC_LOCALE) {
    return this.collectionList(
      { tags: { some: { tag: { code: 'new-arrival', enabled: true } } } },
      limit,
      locale,
    );
  }

  async preorder(limit: number, locale: string = PUBLIC_LOCALE) {
    return this.collectionList(
      {
        lifecycleStatus: 'PREORDER' as const,
        tags: { some: { tag: { code: 'preorder', enabled: true } } },
      },
      limit,
      locale,
    );
  }

  private async collectionList(
    extraWhere: Record<string, unknown>,
    limit: number,
    locale: string,
  ): Promise<PublicProductCard[]> {
    const products = await this.prisma.product.findMany({
      where: { ...PUBLIC_WHERE, ...extraWhere },
      orderBy: [{ sortOrder: 'asc' }, { sku: 'asc' }],
      take: Math.min(Math.max(limit, 1), 24),
      select: PUBLIC_PRODUCT_SELECT,
    });
    return products.map((product) => this.toPublicCard(product, locale));
  }

  private toPublicCard(
    product: PublicProductRow,
    locale: string = PUBLIC_LOCALE,
  ): PublicProductCard {
    const english = product.translations.find((translation) => translation.locale === locale);
    const images = product.images.map((image) => this.toPublicImage(image));
    const tagCodes = new Set(product.tags.map((productTag) => productTag.tag.code));
    return {
      sku: product.sku,
      slug: product.slug,
      name: english?.name ?? product.translations[0]?.name ?? product.sku,
      summary: summarise(english?.description ?? product.translations[0]?.description ?? null),
      lifecycleStatus:
        product.lifecycleStatus.toLowerCase() as PublicProductCard['lifecycleStatus'],
      // Display flags are read from tags: the legacy booleans are a derived,
      // read-only mirror and must not contradict an operator's tag choice.
      isNew: tagCodes.has('new-arrival'),
      isFeatured: tagCodes.has('featured'),
      isPreOrder: tagCodes.has('preorder'),
      category: product.category
        ? {
            id: product.category.id,
            slug: product.category.slug,
            name: this.pickName(product.category.translations, locale),
          }
        : null,
      coverImage: images[0] ?? null,
      tags: product.tags.map((productTag) => ({
        code: productTag.tag.code,
        // English-first, then the code: never another language on the English
        // storefront (docs/23 §5). An empty label would render a blank badge.
        label:
          publicTagLabel(this.labelsOfTag(productTag.tag.translations), locale) ||
          productTag.tag.code,
        // Whitelisted token only; the UI maps it to a badge tone (docs/23 §4.2).
        colorToken: allowedTagColorToken(productTag.tag.colorToken),
      })),
    };
  }

  private toPublicImage(image: PublicImageRow): PublicProductImage {
    const asset = image.asset;
    const version = asset ? imageAssetVersion(asset.id, asset.sha256) : null;
    const variants: PublicImageVariant[] =
      asset && version && asset.status === 'ready'
        ? readStoredImageVariants(asset.derivatives)
            .filter(
              (variant) =>
                variant.format === 'webp' &&
                variant.key === imageVariantStorageKey(asset.id, version, variant.width),
            )
            .sort((left, right) => left.width - right.width)
            .map((variant) => ({
              width: variant.width,
              format: 'webp',
              url: this.storage.publicProductImageUrl(asset.id, version, `${variant.width}.webp`),
            }))
        : [];
    const canonicalUrl =
      variants.at(-1)?.url ??
      (asset && version
        ? this.storage.publicProductImageUrl(asset.id, version, 'source')
        : this.storage.publicUrl(image.storageKey));
    return {
      url: canonicalUrl,
      alt: image.altText ?? '',
      width: image.width,
      height: image.height,
      isCover: image.isCover,
      sortOrder: image.sortOrder,
      variants,
    };
  }

  private toSpecs(product: {
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    weightGrams: number | null;
    packaging: string | null;
    cartonLengthCm: number | null;
    cartonWidthCm: number | null;
    cartonHeightCm: number | null;
    cartonWeightKg: unknown;
    cartonQuantity: number | null;
  }): PublicProductSpecs {
    return {
      lengthMm: product.lengthMm,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      weightGrams: product.weightGrams,
      packaging: product.packaging,
      cartonLengthCm: product.cartonLengthCm,
      cartonWidthCm: product.cartonWidthCm,
      cartonHeightCm: product.cartonHeightCm,
      cartonWeightKg: product.cartonWeightKg === null ? null : String(product.cartonWeightKg),
      cartonQuantity: product.cartonQuantity,
    };
  }

  private pickName(
    translations: { locale: string; name: string }[],
    locale: string = PUBLIC_LOCALE,
  ): string {
    return (
      translations.find((translation) => translation.locale === locale)?.name ??
      translations.find((translation) => translation.locale === PUBLIC_LOCALE)?.name ??
      translations[0]?.name ??
      ''
    );
  }

  private labelsOfTag(translations: { locale: string; label: string }[]): Record<string, string> {
    return Object.fromEntries(
      translations.map((translation) => [translation.locale, translation.label]),
    );
  }
}

function uppercaseLifecycle(value: string): 'AVAILABLE' | 'PREORDER' | 'DISCONTINUED' {
  return value.toUpperCase() as 'AVAILABLE' | 'PREORDER' | 'DISCONTINUED';
}

function summarise(description: string | null, max = 160): string | null {
  if (!description) return null;
  const text = description
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
