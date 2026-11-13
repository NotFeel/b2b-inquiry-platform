import { DATABASE_INTEGER_MAX, DEFAULT_ADMIN_LOCALE, SUPPORTED_LOCALES } from '@b2b/contracts';
import { z } from 'zod';
import { isoDateTimeSchema, nonEmptyText, optionalText, uuidSchema } from './primitives';

/**
 * PostgreSQL INTEGER is the only technical ceiling for configured display
 * totals. In particular, 24 is the Storefront batch size and 36 is legacy UI
 * data; neither belongs in this validation contract (docs/45 §3.1, §4.4).
 *
 * JSON numbers are used rather than coercion so decimal, string and trailing
 * garbage inputs fail instead of being silently truncated.
 */
export { DATABASE_INTEGER_MAX };

export const homepageDisplayTotalSchema = z
  .number()
  .int('validation.homepage.limit.integer')
  .min(1, 'validation.homepage.limit.positive')
  .max(DATABASE_INTEGER_MAX, 'validation.homepage.limit.databaseRange')
  .refine((value) => value % 6 === 0, 'validation.homepage.limit.multipleOfSix');

export const updateHomepageDisplayConfigSchema = z.object({
  newArrivalsLimit: homepageDisplayTotalSchema,
  enabled: z.boolean().optional(),
  /** Optimistic concurrency token; omitted by callers that explicitly overwrite. */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateHomepageDisplayConfigInput = z.infer<typeof updateHomepageDisplayConfigSchema>;

/** Path identifier used by every collection detail/mutation endpoint. */
export const homepageCollectionIdSchema = uuidSchema;

export const homepageCollectionListQuerySchema = z.object({
  locale: z.enum(['en-US', 'zh-CN']).default(DEFAULT_ADMIN_LOCALE),
});
export type HomepageCollectionListQueryInput = z.infer<typeof homepageCollectionListQuerySchema>;

export const homepageCollectionDetailQuerySchema = homepageCollectionListQuerySchema;
export type HomepageCollectionDetailQueryInput = z.infer<
  typeof homepageCollectionDetailQuerySchema
>;

export const homepageCollectionTranslationSchema = z.object({
  locale: z.enum(['en-US', 'zh-CN']),
  title: nonEmptyText(240),
  subtitle: optionalText(500),
});

const homepageCollectionTranslationsSchema = z
  .array(homepageCollectionTranslationSchema)
  .min(1)
  .max(SUPPORTED_LOCALES.length)
  .superRefine((translations, context) => {
    const locales = translations.map((translation) => translation.locale);
    if (new Set(locales).size !== locales.length) {
      context.addIssue({
        code: 'custom',
        path: ['translations'],
        message: 'validation.homepage.translation.localeDuplicate',
      });
    }
    if (!locales.includes('en-US')) {
      context.addIssue({
        code: 'custom',
        path: ['translations'],
        message: 'validation.homepage.translation.englishRequired',
      });
    }
  });

export const createHomepageCollectionSchema = z.object({
  categoryId: uuidSchema,
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(DATABASE_INTEGER_MAX).optional(),
  productLimit: homepageDisplayTotalSchema.default(6),
  translations: homepageCollectionTranslationsSchema,
});
export type CreateHomepageCollectionInput = z.infer<typeof createHomepageCollectionSchema>;

export const updateHomepageCollectionSchema = z.object({
  categoryId: uuidSchema.optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(DATABASE_INTEGER_MAX).optional(),
  productLimit: homepageDisplayTotalSchema.optional(),
  translations: homepageCollectionTranslationsSchema.optional(),
  /** Optimistic concurrency token; a stale value returns a 409. */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateHomepageCollectionInput = z.infer<typeof updateHomepageCollectionSchema>;

/**
 * Full replacement of the collection order. IDs must match every current
 * collection exactly once; the Service runs it in a retryable serializable
 * transaction so readers never observe a partial order.
 */
export const sortHomepageCollectionsSchema = z.object({
  orderedIds: z.array(uuidSchema),
});
export type SortHomepageCollectionsInput = z.infer<typeof sortHomepageCollectionsSchema>;

export const homepageCollectionProductInputSchema = z.object({
  productId: uuidSchema,
  sortOrder: z.number().int().min(0).max(DATABASE_INTEGER_MAX).optional(),
});

const homepageCollectionProductsSchema = z
  .array(homepageCollectionProductInputSchema)
  .superRefine((products, context) => {
    const ids = products.map((product) => product.productId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['products'],
        message: 'validation.homepage.product.duplicate',
      });
    }
  });

/** Full replacement of selected products and their display order. */
export const updateHomepageCollectionProductsSchema = z.object({
  products: homepageCollectionProductsSchema,
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateHomepageCollectionProductsInput = z.infer<
  typeof updateHomepageCollectionProductsSchema
>;
