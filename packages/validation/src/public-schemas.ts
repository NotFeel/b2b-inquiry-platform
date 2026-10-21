import { ANALYTICS_EVENTS, MAX_PAGE_SIZE, PRODUCT_LIFECYCLE_STATUSES } from '@b2b/contracts';
import { z } from 'zod';
import { paginationQuerySchema, skuListSchema } from './primitives';

export const publicProductSortFields = ['featured', 'newest', 'name', 'sku', 'sort_order'] as const;

export const publicProductListQuerySchema = paginationQuerySchema.extend({
  locale: z.enum(['en-US', 'zh-CN']).default('en-US'),
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(200).optional(),
  includeDescendants: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  featured: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  isNew: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  /**
   * Home-page pre-order rail selection (`isPreOrder`), not the lifecycle
   * facet. The catalogue's `lifecycle=preorder` filter still lists every
   * pre-order product; this flag only curates the home page.
   */
  isPreOrder: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  lifecycle: z.enum(PRODUCT_LIFECYCLE_STATUSES).optional(),
  tag: z.string().trim().max(80).optional(),
  sortBy: z.enum(publicProductSortFields).default('sort_order'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type PublicProductListQuery = z.infer<typeof publicProductListQuerySchema>;

export const publicLocaleQuerySchema = z.object({
  locale: z.enum(['en-US', 'zh-CN']).default('en-US'),
});

export const publicAdQuerySchema = z.object({
  placement: z.string().trim().min(1).max(100),
  locale: z.enum(['en-US', 'zh-CN']).default('en-US'),
});

export const analyticsEventSchema = z.object({
  eventName: z.enum(ANALYTICS_EVENTS),
  path: z.string().trim().max(1000).optional(),
  sessionId: z
    .string()
    .trim()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'validation.sessionId.invalid'),
  referrerHost: z
    .string()
    .trim()
    .max(255)
    .regex(/^[A-Za-z0-9.-]*$/, 'validation.referrerHost.invalid')
    .optional(),
  // Whitelisted, non-PII extras only: SKU codes, placement codes, locale.
  context: z
    .object({
      skus: z.array(z.string().trim().max(64)).max(MAX_PAGE_SIZE).optional(),
      placement: z.string().trim().max(60).optional(),
      locale: z.enum(['en-US', 'zh-CN']).optional(),
      template: z.string().trim().max(120).optional(),
    })
    .optional(),
});

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

export const inquiryIntentSchema = z.object({
  skus: skuListSchema,
  /**
   * Optional target quantities keyed by SKU. The API still uses `skus` as the
   * selection list so older clients remain compatible; quantities only enrich
   * the prefilled WhatsApp message.
   */
  quantities: z
    .record(z.string().trim().max(64), z.number().int().min(1).max(999_999))
    .optional(),
  sourcePath: z.string().trim().max(1000).optional(),
  /** Absolute public product/catalogue URL shown to the sales team. */
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    }, 'validation.url.protocol')
    .optional(),
  locale: z.enum(['en-US', 'zh-CN']).default('en-US'),
});

export type InquiryIntentInput = z.infer<typeof inquiryIntentSchema>;

export const customerLookupQuerySchema = z.object({
  phone: z.string().trim().min(3).max(32),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
