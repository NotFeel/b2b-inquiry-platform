import type { AdPlacement, ProductLifecycleStatus, SupportedLocale } from './constants';
import type { PublicImageVariant } from './images';

/**
 * Public (storefront) DTOs.
 *
 * These types intentionally have **no price field** of any kind. The storefront
 * may only ever consume these shapes (docs/04 §6, docs/13 §2). Adding `price`,
 * `priceCny`, `unitPrice` or any derived price hint here is a defect.
 */

export interface PublicProductTag {
  code: string;
  label: string;
  colorToken: string | null;
}

export interface PublicTagFilter extends PublicProductTag {
  productCount: number;
}

export interface PublicProductImage {
  /** Canonical largest immutable URL, used for metadata and image fallback. */
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
  isCover: boolean;
  sortOrder: number;
  /** Responsive WebP variants; empty only for legacy assets awaiting reprocessing. */
  variants: PublicImageVariant[];
}

export interface PublicCategoryRef {
  id: string;
  slug: string;
  name: string;
}

export interface PublicProductCard {
  sku: string;
  slug: string;
  name: string;
  summary: string | null;
  lifecycleStatus: ProductLifecycleStatus;
  isNew: boolean;
  isFeatured: boolean;
  /** Operational pre-order tag; independent from the lifecycle facet. */
  isPreOrder: boolean;
  category: PublicCategoryRef | null;
  coverImage: PublicProductImage | null;
  tags: PublicProductTag[];
}

export interface PublicProductSpecs {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightGrams: number | null;
  packaging: string | null;
  cartonLengthCm: number | null;
  cartonWidthCm: number | null;
  cartonHeightCm: number | null;
  cartonWeightKg: string | null;
  cartonQuantity: number | null;
}

export interface PublicProductDetail extends PublicProductCard {
  description: string | null;
  images: PublicProductImage[];
  specs: PublicProductSpecs;
  categories: PublicCategoryRef[];
  breadcrumb: PublicCategoryRef[];
  updatedAt: string;
}

export interface PublicCategory {
  id: string;
  code: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  productCount: number;
}

export interface PublicCategoryTreeNode extends PublicCategory {
  children: PublicCategoryTreeNode[];
}

export interface PublicMenuItem {
  id: string;
  code: string;
  label: string;
  route: string | null;
  external: boolean;
  children: PublicMenuItem[];
}

export interface PublicSiteConfig {
  companyName: string;
  tagline: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  socialLinks: { label: string; url: string }[];
  /** International format, digits only, no `+` sign (docs/05 §6). */
  whatsappNumber: string | null;
  defaultLocale: SupportedLocale;
  seo: {
    title: string;
    description: string;
    keywords: string[];
  };
  legalLinks: { label: string; url: string }[];
  batchInquiryLimit: number;
  analyticsEnabled: boolean;
  updatedAt: string;
}

export interface PublicAd {
  id: string;
  code: string;
  placement: AdPlacement;
  title: string | null;
  description: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  targetUrl: string | null;
  sortOrder: number;
}

export interface PublicContentPage {
  slug: string;
  pageType: string;
  title: string;
  bodyHtml: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

/** Published content pages that may be exposed as storefront navigation. */
export interface PublicContentPageRef {
  slug: string;
  pageType: string;
}

export interface PublicFactoryMedia {
  id: string;
  mediaType: 'image' | 'video';
  title: string;
  description: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  coverUrl: string | null;
  altText: string | null;
  placements: string[];
  sortOrder: number;
}

export interface PublicFactoryProcessStep {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  altText: string | null;
  sortOrder: number;
}

export interface PublicCredential {
  id: string;
  name: string;
  credentialTypeCode: string;
  credentialTypeLabel: string;
  issuer: string | null;
  description: string | null;
  issuedAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  validityType: 'dated' | 'perpetual' | 'not_specified';
  expired: boolean;
  imageUrl: string | null;
  documentUrl: string | null;
  verificationUrl: string | null;
  verificationLabel: string | null;
  sortOrder: number;
}

export interface PublicHomeSectionItem {
  id: string;
  title: string;
  imageUrl: string | null;
  mediaType: 'image' | 'video' | 'credential';
}

export interface PublicHomeSection {
  code: string;
  title: string;
  description: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  sortOrder: number;
  items: PublicHomeSectionItem[];
}

export interface PublicFactoryContent {
  page: PublicContentPage | null;
  media: PublicFactoryMedia[];
  process: PublicFactoryProcessStep[];
}

export interface PublicQualityContent {
  page: PublicContentPage | null;
  credentials: PublicCredential[];
}

export const FAQ_CATEGORY_CODES = [
  'products',
  'wholesale',
  'orders',
  'shipping',
  'quality',
  'contact',
] as const;

export type FaqCategoryCode = (typeof FAQ_CATEGORY_CODES)[number];

export interface PublicFaqItem {
  id: string;
  category: FaqCategoryCode;
  sortOrder: number;
  question: string;
  answerHtml: string;
}

export interface PublicInquiryIntentResult {
  intentId: string;
  skus: string[];
  /** The message the storefront should prefill — never contains internal prices. */
  prefilledMessage: string;
  whatsappNumber: string | null;
}
