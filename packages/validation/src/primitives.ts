import { ALLOWED_LINK_PROTOCOLS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@b2b/contracts';
import { z } from 'zod';

// Reusable input primitives.
//
// Every externally supplied value passes through one of these before it reaches
// a service (docs/07 section 3). Unknown object keys are stripped by Zod, so a
// client cannot smuggle `createdBy`, `priceCny` or `publishStatus` into a payload
// that does not declare them.

export const uuidSchema = z.string().uuid();

export const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'validation.slug.invalid');

export const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'validation.code.invalid');

export const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'validation.sku.invalid');

export const skuListSchema = z.array(skuSchema).min(1).max(200);

export const localeSchema = z.enum(['en-US', 'zh-CN']);

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'validation.countryCode.invalid');

export const isoDateTimeSchema = z
  .string()
  .trim()
  .min(10)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'validation.datetime.invalid')
  .transform((value) => new Date(value).toISOString());

export const optionalIsoDateTimeSchema = isoDateTimeSchema.nullable().optional();

// Currency amounts travel as decimal strings so no float rounding is introduced.
export const decimalStringSchema = (options?: { allowNegative?: boolean }) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? value.toString() : value.trim()))
    .refine((value) => /^-?\d{1,15}(\.\d{1,6})?$/.test(value), 'validation.decimal.invalid')
    .refine(
      (value) => (options?.allowNegative ? true : !value.startsWith('-')),
      'validation.decimal.negative',
    )
    .refine((value) => Number(value) <= 1_000_000_000, 'validation.decimal.tooLarge');

export const positiveIntSchema = (max = 1_000_000) =>
  z.coerce.number().int().min(0).max(max).transform((value) => Math.trunc(value));

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .regex(/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/, 'validation.email.invalid');

// E.164-ish input: the service normalises it with libphonenumber afterwards.
export const phoneInputSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[+()\d\s.-]+$/, 'validation.phone.characters');

// Restrict outbound links to safe protocols; `javascript:` and `data:` URLs are
// rejected outright (docs/01 section 3.6, docs/13 section 1).
export const safeUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(url.protocol);
    } catch {
      return false;
    }
  }, 'validation.url.protocol');

export const optionalSafeUrlSchema = z
  .union([safeUrlSchema, z.literal(''), z.null()])
  .transform((value) => (value ? value : null))
  .optional();

// Internal (relative) route such as `/products` - never a protocol-relative URL.
export const internalRouteSchema = z
  .string()
  .trim()
  .max(240)
  .regex(/^\/[A-Za-z0-9/_[\]{}.-]*$/, 'validation.route.invalid');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export function sortedQuerySchema<TField extends string>(
  fields: readonly TField[],
  defaultField: TField,
  defaultOrder: 'asc' | 'desc' = 'desc',
) {
  return paginationQuerySchema.extend({
    sortBy: z.enum(fields as unknown as [TField, ...TField[]]).default(defaultField),
    sortOrder: z.enum(['asc', 'desc']).default(defaultOrder),
  });
}

export const storageKeySchema = z
  .string()
  .trim()
  .min(4)
  .max(500)
  .regex(/^[A-Za-z0-9/_\-.]{4,500}$/, 'validation.storageKey.invalid')
  .refine((value) => !value.includes('..'), 'validation.storageKey.traversal');

// Strip control characters that would break logs, Excel cells or HTML.
export function stripControlCharacters(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

const PII_KEYS = new Set([
  'phone',
  'telephone',
  'mobile',
  'email',
  'customerphone',
  'fullname',
  'firstname',
  'lastname',
  'address',
]);

// Analytics endpoints must not accept arbitrary PII (docs/09 section 4). Zod
// strips unknown keys, so this check runs against the raw body before parsing.
export function findPiiFields(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[_-]/g, '').toLowerCase();
      const nextPath = path ? `${path}.${key}` : key;
      if (PII_KEYS.has(normalized)) found.push(nextPath);
      walk(child, nextPath);
    }
  };
  walk(payload, '');
  return found;
}
