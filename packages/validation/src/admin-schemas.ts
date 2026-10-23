import {
  AD_PLACEMENTS,
  CONTENT_PAGE_TYPES,
  CREDENTIAL_PLACEMENTS,
  CREDENTIAL_VALIDITY_TYPES,
  DEFAULT_ADMIN_LOCALE,
  FACTORY_MEDIA_PLACEMENTS,
  FAQ_CATEGORY_CODES,
  HOME_SECTION_CODES,
  MENU_ICON_NAMES,
  PI_STATUSES,
  PRODUCT_IMAGE_LIMITS,
  PRODUCT_LIFECYCLE_STATUSES,
  PRODUCT_SLUG_STRATEGIES,
  PUBLISH_STATUSES,
  PUBLIC_LOCALE,
  QUOTE_TEMPLATE_TYPES,
  SETTING_GROUPS,
  SETTING_VALUE_TYPES,
  SUPPORTED_LOCALES,
  TAG_COLOR_TOKENS,
} from '@b2b/contracts';
import { z } from 'zod';
import {
  codeSchema,
  countryCodeSchema,
  decimalStringSchema,
  emailSchema,
  internalRouteSchema,
  isoDateTimeSchema,
  localeSchema,
  nonEmptyText,
  optionalSafeUrlSchema,
  optionalText,
  paginationQuerySchema,
  phoneInputSchema,
  positiveIntSchema,
  safeUrlSchema,
  skuListSchema,
  skuSchema,
  slugSchema,
  uuidSchema,
} from './primitives';

// ------------------------------------------------------------------- auth

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(10).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(10).max(200),
  newPassword: z.string().min(12).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ------------------------------------------------------------------ users

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  /** Filter by role id; the UI resolves the code to an id through the roles API. */
  roleId: uuidSchema.optional(),
});

/**
 * User create/update contracts (docs/17 §5.3-§5.4).
 *
 * Roles are always submitted as ids; the API re-validates existence,
 * de-duplicates and checks the actor's authority to grant each role.
 */
export const createAdminUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9._-]+$/, 'validation.username.invalid'),
  displayName: nonEmptyText(120),
  password: z.string().min(12).max(200).optional(),
  roleIds: z.array(uuidSchema).min(1).max(20),
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z.object({
  displayName: nonEmptyText(120).optional(),
  roleIds: z.array(uuidSchema).min(1).max(20).optional(),
  /** Optimistic concurrency guard; a mismatch is reported as USER_MODIFIED. */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(12).max(200).optional(),
  mustChangePassword: z.boolean().default(true),
});

// ------------------------------------------------------------------- RBAC

/**
 * Role code: a stable machine identifier that never changes after creation and
 * is never translated (docs/18 §5.1).
 */
export const roleCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, 'validation.roleCode.invalid');

/** Both admin locales must resolve a name so a role never renders as a raw code. */
export const createRoleNamesSchema = z.object({
  'zh-CN': nonEmptyText(160),
  'en-US': nonEmptyText(160),
});

export const updateRoleNamesSchema = z
  .object({
    'zh-CN': nonEmptyText(160).optional(),
    'en-US': nonEmptyText(160).optional(),
  })
  .refine((value) => Object.values(value).some((name) => typeof name === 'string'), {
    message: 'validation.required',
  });

export const roleListQuerySchema = paginationQuerySchema.extend({
  /** Fuzzy match over code, localized name and description. */
  keyword: z.string().trim().max(80).optional(),
  type: z.enum(['all', 'system', 'custom']).default('all'),
});
export type RoleListQueryInput = z.infer<typeof roleListQuerySchema>;

/**
 * Create/update contracts (docs/18 §4).
 *
 * `isSystem`, `userCount` and `permissionCount` are server-computed and are not
 * part of any payload; the service always creates custom roles.
 */
export const createRoleSchema = z.object({
  code: roleCodeSchema,
  names: createRoleNamesSchema,
  description: optionalText(500),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  names: updateRoleNamesSchema.optional(),
  description: optionalText(500),
  /** Optimistic concurrency guard; a mismatch is reported as CONCURRENT_ROLE_UPDATE. */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** Full replacement of a role's permission set (docs/18 §4.3). */
export const replaceRolePermissionsSchema = z.object({
  permissionCodes: z.array(codeSchema).max(200),
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type ReplaceRolePermissionsInput = z.infer<typeof replaceRolePermissionsSchema>;

// ------------------------------------------------------------------ menus

/** Icons the back office can render; the API rejects anything else (docs/19 §3.1). */
export const menuIconSchema = z.enum(MENU_ICON_NAMES);

/**
 * Menu permission codes are references into the permission dictionary. The
 * shape is validated here and existence is re-checked in the service against the
 * database; the API never grants a permission by binding it to a menu
 * (docs/19 §3.3).
 */
export const permissionCodeRefSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z][a-z0-9._-]*$/, 'validation.code.invalid');

/** Internal path or an absolute https/mailto URL; protocols like `javascript:` are rejected. */
const menuRouteSchema = z.union([internalRouteSchema, safeUrlSchema]).nullable().optional();

/** A menu needs at least one label; missing locales fall back at render time. */
const menuLabelsSchema = z
  .record(localeSchema, nonEmptyText(160))
  .refine(
    (value) => Object.values(value).some((label) => typeof label === 'string' && label.length > 0),
    {
      message: 'validation.required',
    },
  );

export const createMenuSchema = z.object({
  code: codeSchema,
  parentId: uuidSchema.nullable().optional(),
  route: menuRouteSchema,
  icon: menuIconSchema.nullable().optional(),
  permissionCode: permissionCodeRefSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  visible: z.boolean().default(true),
  enabled: z.boolean().default(true),
  external: z.boolean().default(false),
  labels: menuLabelsSchema,
});
export type CreateMenuInput = z.infer<typeof createMenuSchema>;

// Explicit update shape: see the note on updateCategorySchema below.
export const updateMenuSchema = z.object({
  parentId: uuidSchema.nullable().optional(),
  route: menuRouteSchema,
  icon: menuIconSchema.nullable().optional(),
  permissionCode: permissionCodeRefSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
  external: z.boolean().optional(),
  labels: menuLabelsSchema.optional(),
  /** Optimistic concurrency guard; a mismatch is reported as MENU_MODIFIED. */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;

/**
 * Admin menu tree query (docs/19 §2.2).
 *
 * Filters are applied server-side and the response keeps matching nodes together
 * with their ancestor path, so the tree never flattens a child away from its
 * parent.
 */
export const menuListQuerySchema = z.object({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  /** Case-insensitive match over code, route, permission code and every locale label. */
  q: z.string().trim().max(80).optional(),
  type: z.enum(['all', 'group', 'page', 'external']).default('all'),
  status: z.enum(['all', 'enabled', 'disabled']).default('all'),
  visibility: z.enum(['all', 'visible', 'hidden']).default('all'),
  rootOnly: z.coerce.boolean().default(false),
});
export type MenuListQueryInput = z.infer<typeof menuListQuerySchema>;

/**
 * Sibling reorder (docs/19 §4.4).
 *
 * `orderedIds` must be the complete set of children of `parentId`, so a partial
 * submission can never leave siblings in an undefined order.
 */
export const reorderMenusSchema = z.object({
  parentId: uuidSchema.nullable(),
  orderedIds: z.array(uuidSchema).min(1).max(200),
});
export type ReorderMenusInput = z.infer<typeof reorderMenusSchema>;

// ------------------------------------------------------------- dictionary

/**
 * Two-level dictionary contracts (docs/20 §5.4-§5.5).
 *
 * `typeCode` / item `code` are stable machine keys; labels are display-only and
 * validated per locale. `systemLocked` is never accepted from the client - it is
 * controlled by the seed and by controlled maintenance flows.
 */
export const createDictionaryTypeSchema = z.object({
  code: codeSchema,
  nameKey: nonEmptyText(180),
  description: optionalText(500),
  enabled: z.boolean().default(true),
});
export type CreateDictionaryTypeInput = z.infer<typeof createDictionaryTypeSchema>;

export const updateDictionaryTypeSchema = z.object({
  nameKey: nonEmptyText(180).optional(),
  description: optionalText(500),
  enabled: z.boolean().optional(),
});
export type UpdateDictionaryTypeInput = z.infer<typeof updateDictionaryTypeSchema>;

export const dictionaryTypeListQuerySchema = paginationQuerySchema.extend({
  /** Case-insensitive match over code, nameKey and description. */
  keyword: z.string().trim().max(80).optional(),
  enabled: z.enum(['all', 'true', 'false']).default('all'),
  includeItems: z.coerce.boolean().default(false),
});
export type DictionaryTypeListQueryInput = z.infer<typeof dictionaryTypeListQuerySchema>;

/** Admin item list: enabled filter plus optional usage counts (docs/20 §6.2). */
export const dictionaryItemListQuerySchema = z.object({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  enabled: z.enum(['all', 'true', 'false']).default('all'),
  keyword: z.string().trim().max(80).optional(),
  includeUsageCount: z.coerce.boolean().default(true),
});
export type DictionaryItemListQueryInput = z.infer<typeof dictionaryItemListQuerySchema>;

/**
 * Business option endpoint query (docs/20 §6.3).
 *
 * Defaults to enabled items only; `includeDisabled=true` exists so editing a
 * record whose option was disabled can still resolve its current label.
 */
export const dictionaryOptionQuerySchema = z.object({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  includeDisabled: z.coerce.boolean().default(false),
});
export type DictionaryOptionQueryInput = z.infer<typeof dictionaryOptionQuerySchema>;

/**
 * Item labels per locale.
 *
 * Declared as an explicit object (not `z.record`) so an incomplete payload still
 * type-checks while unknown locales are stripped and the known ones validated.
 */
export const dictionaryLabelsSchema = z.object({
  'zh-CN': nonEmptyText(160).optional(),
  'en-US': nonEmptyText(160).optional(),
});
export type DictionaryLabelsInput = z.infer<typeof dictionaryLabelsSchema>;

/**
 * A new item needs at least one translated label; otherwise the option would
 * only ever render as its machine code (docs/20 §5.5, §9.3).
 */
const dictionaryCreateLabelsSchema = dictionaryLabelsSchema.refine(
  (value) => Object.values(value).some((label) => typeof label === 'string' && label.length > 0),
  { message: 'validation.required' },
);

export const createDictionaryItemSchema = z.object({
  /** The owning type, addressed by its stable typeCode rather than an id. */
  typeCode: codeSchema,
  code: codeSchema,
  value: optionalText(240),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  enabled: z.boolean().default(true),
  labels: dictionaryCreateLabelsSchema,
});
export type CreateDictionaryItemInput = z.infer<typeof createDictionaryItemSchema>;

export const updateDictionaryItemSchema = z.object({
  value: optionalText(240),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  labels: dictionaryLabelsSchema.optional(),
  /** Optimistic concurrency guard; a mismatch is reported as DICTIONARY_MODIFIED-ish conflict. */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateDictionaryItemInput = z.infer<typeof updateDictionaryItemSchema>;

/** Same-type reorder: the complete sibling set, in the desired order. */
export const reorderDictionaryItemsSchema = z.object({
  orderedIds: z.array(uuidSchema).min(1).max(200),
});
export type ReorderDictionaryItemsInput = z.infer<typeof reorderDictionaryItemsSchema>;

// --------------------------------------------------------------- settings

/**
 * Settings key: stable, dot separated, each segment starting with a lowercase
 * letter (docs/21 §7.2). The project's built-in keys use camelCase after the
 * dot (`site.companyName`), so mixed case is allowed inside a segment while the
 * shape stays machine-safe. Renaming an existing key is a migration, not an edit.
 */
export const settingKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .regex(/^[a-z][a-zA-Z0-9_-]*(?:\.[a-z][a-zA-Z0-9_-]*)*$/, 'validation.settingKey.invalid');

export const settingTranslationSchema = z.object({
  locale: localeSchema,
  label: nonEmptyText(180),
  description: optionalText(500),
});

export const settingListQuerySchema = paginationQuerySchema.extend({
  /** Locale used to resolve custom-setting labels and descriptions. */
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  /** Matches key, i18n key, description or custom label. */
  keyword: z.string().trim().max(120).optional(),
  groupCode: z.union([z.enum(SETTING_GROUPS), z.literal('all')]).default('all'),
  valueType: z.union([z.enum(SETTING_VALUE_TYPES), z.literal('all')]).default('all'),
  visibility: z.enum(['all', 'public', 'private', 'secret']).default('all'),
  source: z.enum(['all', 'system', 'custom']).default('all'),
});
export type SettingListQueryInput = z.infer<typeof settingListQuerySchema>;

/** Locale-only query used when resolving a custom setting's label (docs/21 §6.1). */
export const settingLocaleQuerySchema = z.object({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
});

/**
 * Custom settings are created through this contract; `isSystem`, `isEditable`
 * and `isDeletable` are server-controlled and deliberately absent.
 */
export const createSettingSchema = z.object({
  key: settingKeySchema,
  groupCode: z.enum(SETTING_GROUPS).default('custom'),
  valueType: z.enum(SETTING_VALUE_TYPES).default('string'),
  value: z.unknown().optional(),
  isPublic: z.boolean().default(false),
  isSecret: z.boolean().default(false),
  isRequired: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  validation: z.unknown().optional(),
  options: z.unknown().optional(),
  translations: z.array(settingTranslationSchema).min(1).max(SUPPORTED_LOCALES.length),
  /** Locale the response should resolve labels in. */
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
});
export type CreateSettingInput = z.infer<typeof createSettingSchema>;

/**
 * Update contract (docs/21 §6.3).
 *
 * `value: undefined` means "keep the stored value", which is what makes secret
 * replacement safe: an empty form never clears a secret by accident.
 */
export const updateSettingSchema = z.object({
  value: z.unknown().optional(),
  isPublic: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  groupCode: z.enum(SETTING_GROUPS).optional(),
  valueType: z.enum(SETTING_VALUE_TYPES).optional(),
  validation: z.unknown().optional(),
  options: z.unknown().optional(),
  translations: z.array(settingTranslationSchema).max(SUPPORTED_LOCALES.length).optional(),
  /** Optimistic concurrency guard; a mismatch is SETTING_REVISION_CONFLICT. */
  expectedRevision: z.coerce.number().int().min(1).optional(),
  /** Explicit, separately-audited operation to clear a stored secret. */
  clearSecret: z.boolean().optional(),
  /** Locale the response should resolve labels in. */
  locale: localeSchema.optional(),
});
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

/** Legacy bulk upsert kept for backward compatibility with older clients. */
export const upsertSettingsSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .min(2)
          .max(160)
          .regex(/^[a-z0-9][a-z0-9._-]*$/, 'validation.settingKey.invalid'),
        value: z.unknown().optional(),
        isPublic: z.boolean().optional(),
        isSecret: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type UpsertSettingsInput = z.infer<typeof upsertSettingsSchema>;

// ------------------------------------------------------------- categories

export const categoryTranslationInputSchema = z.object({
  locale: localeSchema,
  name: nonEmptyText(240),
  description: optionalText(2000),
});

export const createCategorySchema = z.object({
  code: codeSchema,
  slug: slugSchema,
  parentId: uuidSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  enabled: z.boolean().default(true),
  visible: z.boolean().default(true),
  coverFileAssetId: uuidSchema.nullable().optional(),
  translations: z.array(categoryTranslationInputSchema).min(1).max(SUPPORTED_LOCALES.length),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// Explicit update shape: a PATCH must never re-apply creation defaults such as
// `enabled: true` or `publishStatus: draft` just because a field was omitted.
export const updateCategorySchema = z.object({
  slug: slugSchema.optional(),
  parentId: uuidSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  visible: z.boolean().optional(),
  coverFileAssetId: uuidSchema.nullable().optional(),
  translations: z
    .array(categoryTranslationInputSchema)
    .min(1)
    .max(SUPPORTED_LOCALES.length)
    .optional(),
  /**
   * Optimistic concurrency token: the `updatedAt` the administrator actually
   * saw. A mismatch is answered with `CATEGORY_CONCURRENT_UPDATE` instead of
   * silently overwriting a concurrent edit (docs/22 §11.7).
   */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const moveCategorySchema = z.object({
  parentId: uuidSchema.nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
});
export type MoveCategoryInput = z.infer<typeof moveCategorySchema>;

/**
 * Category tree filters (docs/22 §2.3, §5.2).
 *
 * `locale` only selects which translation is used for the resolved name; every
 * locale is still returned in `names` so the drawer can edit both.
 */
export const categoryTreeQuerySchema = z.object({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  /** Case-insensitive match over code, slug and every locale name. */
  q: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'enabled', 'disabled']).default('all'),
  visibility: z.enum(['all', 'visible', 'hidden']).default('all'),
  hasProducts: z.enum(['all', 'with', 'without']).default('all'),
  rootOnly: z.coerce.boolean().default(false),
});
export type CategoryTreeQueryInput = z.infer<typeof categoryTreeQuerySchema>;

/** Paginated flat list/search view over the same tree (docs/22 §2.6). */
export const categoryListQuerySchema = paginationQuerySchema.extend({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  q: z.string().trim().max(120).optional(),
  parentId: uuidSchema.optional(),
  /** Restrict to one root's branch (the root itself included). */
  rootId: uuidSchema.optional(),
  status: z.enum(['all', 'enabled', 'disabled']).default('all'),
  visibility: z.enum(['all', 'visible', 'hidden']).default('all'),
  hasProducts: z.enum(['all', 'with', 'without']).default('all'),
  sortBy: z.enum(['path', 'updatedAt', 'sortOrder']).default('path'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type CategoryListQueryInput = z.infer<typeof categoryListQuerySchema>;

/**
 * Sibling reorder (docs/22 §5.1), mirroring the menu reorder contract: the
 * submitted ids must be exactly the children of `parentId`, so a partial
 * submission cannot leave undefined gaps in the order.
 */
export const reorderCategoriesSchema = z.object({
  parentId: uuidSchema.nullable(),
  orderedIds: z.array(uuidSchema).min(1).max(500),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;

// --------------------------------------------------------------- products

export const productListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  categoryId: uuidSchema.optional(),
  categorySlug: z.string().trim().max(180).optional(),
  includeDescendants: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  publishStatus: z.enum(PUBLISH_STATUSES).optional(),
  lifecycleStatus: z.enum(PRODUCT_LIFECYCLE_STATUSES).optional(),
  isFeatured: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  isNew: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  /** Tag filter by stable code (existing behaviour) or by id (editor deep link). */
  tag: z.string().trim().max(80).optional(),
  tagId: uuidSchema.optional(),
  /**
   * Cover/image filter (docs/24 §3.1). `without` finds the products that need
   * gallery work; it counts usable images only, so an image waiting for a
   * physical delete does not make a product look complete.
   */
  hasImages: z.enum(['all', 'with', 'without']).default('all'),
  sortBy: z.enum(['updated_at', 'created_at', 'sku', 'name', 'sort_order']).default('updated_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type ProductListQueryInput = z.infer<typeof productListQuerySchema>;

export const productTranslationInputSchema = z.object({
  locale: localeSchema,
  name: nonEmptyText(240),
  description: optionalText(8000),
  seoTitle: optionalText(240),
  seoDescription: optionalText(400),
});

export const productImageInputSchema = z.object({
  fileAssetId: uuidSchema,
  altText: optionalText(PRODUCT_IMAGE_LIMITS.maxAltTextLength),
  /** Only honoured for a single staged asset; further covers are demoted server-side. */
  isCover: z.boolean().default(false),
});

/**
 * Attach one or more already-staged assets to a product (docs/24 §6.2).
 *
 * The client sends staging ids it received from `POST /admin/media/staging`;
 * the server re-reads every asset, proves it is a ready image owned by this
 * catalogue, and derives the storage key from the database - never from the
 * request. Ordering and the cover are normalised in the same transaction.
 */
export const productImageAttachSchema = z.object({
  assets: z.array(productImageInputSchema).min(1).max(PRODUCT_IMAGE_LIMITS.maxPerProduct),
});
export type ProductImageAttachInput = z.infer<typeof productImageAttachSchema>;

/** Submit the complete ordered image list; positions become `sortOrder`. */
export const productImageOrderSchema = z.object({
  imageIds: z.array(uuidSchema).min(1).max(PRODUCT_IMAGE_LIMITS.maxPerProduct),
});
export type ProductImageOrderInput = z.infer<typeof productImageOrderSchema>;

export const productImageUpdateSchema = z.object({
  altText: optionalText(PRODUCT_IMAGE_LIMITS.maxAltTextLength),
});
export type ProductImageUpdateInput = z.infer<typeof productImageUpdateSchema>;

/**
 * Product master data (docs/24 §3.3 A-C).
 *
 * `categoryId` is required: the editor uses a real category tree and the API
 * re-validates that the node exists and is enabled, so a product can never be
 * filed against a hand-typed UUID or a disabled branch. Images are deliberately
 * absent - they are attached, ordered and deleted through their own endpoints so
 * a form save can never replace a gallery (and never lose a storage key).
 */
export const createProductSchema = z.object({
  sku: skuSchema,
  slug: slugSchema,
  categoryId: uuidSchema,
  priceCny: decimalStringSchema().nullable().optional(),
  lifecycleStatus: z.enum(PRODUCT_LIFECYCLE_STATUSES).default('available'),
  publishStatus: z.enum(PUBLISH_STATUSES).default('draft'),
  isNew: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  /**
   * Home-page pre-order curation. Only valid together with
   * `lifecycleStatus: 'preorder'`; the service rejects any other combination
   * instead of silently ignoring the flag.
   */
  isPreOrder: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  lengthMm: positiveIntSchema(1_000_000).nullable().optional(),
  widthMm: positiveIntSchema(1_000_000).nullable().optional(),
  heightMm: positiveIntSchema(1_000_000).nullable().optional(),
  weightGrams: positiveIntSchema(100_000_000).nullable().optional(),
  packaging: optionalText(500),
  cartonLengthCm: positiveIntSchema(100_000).nullable().optional(),
  cartonWidthCm: positiveIntSchema(100_000).nullable().optional(),
  cartonHeightCm: positiveIntSchema(100_000).nullable().optional(),
  cartonWeightKg: decimalStringSchema().nullable().optional(),
  cartonQuantity: positiveIntSchema(1_000_000).nullable().optional(),
  /** Structured tag references; the legacy code array is still accepted. */
  tagIds: z.array(uuidSchema).max(30).default([]),
  tagCodes: z.array(codeSchema).max(30).optional(),
  translations: z.array(productTranslationInputSchema).min(1).max(SUPPORTED_LOCALES.length),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

// Explicit update shape (see note on updateCategorySchema above).
export const updateProductSchema = z.object({
  slug: slugSchema.optional(),
  categoryId: uuidSchema.optional(),
  priceCny: decimalStringSchema().nullable().optional(),
  lifecycleStatus: z.enum(PRODUCT_LIFECYCLE_STATUSES).optional(),
  publishStatus: z.enum(PUBLISH_STATUSES).optional(),
  isNew: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPreOrder: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  lengthMm: positiveIntSchema(1_000_000).nullable().optional(),
  widthMm: positiveIntSchema(1_000_000).nullable().optional(),
  heightMm: positiveIntSchema(1_000_000).nullable().optional(),
  weightGrams: positiveIntSchema(100_000_000).nullable().optional(),
  packaging: optionalText(500),
  cartonLengthCm: positiveIntSchema(100_000).nullable().optional(),
  cartonWidthCm: positiveIntSchema(100_000).nullable().optional(),
  cartonHeightCm: positiveIntSchema(100_000).nullable().optional(),
  cartonWeightKg: decimalStringSchema().nullable().optional(),
  cartonQuantity: positiveIntSchema(1_000_000).nullable().optional(),
  tagIds: z.array(uuidSchema).max(30).optional(),
  tagCodes: z.array(codeSchema).max(30).optional(),
  translations: z
    .array(productTranslationInputSchema)
    .min(1)
    .max(SUPPORTED_LOCALES.length)
    .optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/**
 * Server-side slug candidate generator (docs/26 §3.4).
 *
 * A missing/empty name is allowed and falls back to `product`; the strategy is
 * explicit so a caller can never silently get a random suffix it did not ask
 * for.
 */
export const productSlugSuggestionSchema = z.object({
  name: z.string().trim().max(240).default(''),
  strategy: z.enum(PRODUCT_SLUG_STRATEGIES).default('name-random'),
  excludeProductId: uuidSchema.nullable().optional(),
});
export type ProductSlugSuggestionInput = z.infer<typeof productSlugSuggestionSchema>;

export const publishProductSchema = z.object({
  publishStatus: z.enum(PUBLISH_STATUSES),
});
export type PublishProductInput = z.infer<typeof publishProductSchema>;

// ------------------------------------------------------------------- tags

/**
 * Tag style tokens are a closed set (docs/23 §3.1): the API refuses anything
 * that is not in the shared whitelist, so no database value can become CSS.
 */
const tagColorTokenSchema = z.enum(TAG_COLOR_TOKENS).nullable();

export const tagTranslationInputSchema = z.object({
  locale: localeSchema,
  label: nonEmptyText(100),
});

/**
 * Create requires the English label: the storefront is English by default
 * (docs/23 §5). `code` is the stable business key and is not editable later.
 */
export const createTagSchema = z.object({
  code: codeSchema,
  colorToken: tagColorTokenSchema.optional(),
  enabled: z.boolean().default(true),
  translations: z
    .array(tagTranslationInputSchema)
    .min(1)
    .max(SUPPORTED_LOCALES.length)
    .refine((items) => items.some((item) => item.locale === PUBLIC_LOCALE), {
      message: 'validation.tag.englishRequired',
    })
    .refine((items) => new Set(items.map((item) => item.locale)).size === items.length, {
      message: 'validation.tag.duplicateLocale',
    }),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

// Explicit update shape (same rationale as categories): a PATCH must never
// re-apply creation defaults such as `enabled: true` because a field was omitted.
export const updateTagSchema = z.object({
  colorToken: tagColorTokenSchema.optional(),
  enabled: z.boolean().optional(),
  translations: z.array(tagTranslationInputSchema).min(1).max(SUPPORTED_LOCALES.length).optional(),
  /** Optimistic concurrency: the `updatedAt` the administrator actually saw. */
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const updateTagStatusSchema = z.object({ enabled: z.boolean() });
export type UpdateTagStatusInput = z.infer<typeof updateTagStatusSchema>;

export const tagListQuerySchema = paginationQuerySchema.extend({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  /** Case-insensitive match over code and every locale label. */
  q: z.string().trim().max(80).optional(),
  status: z.enum(['all', 'enabled', 'disabled']).default('all'),
  usage: z.enum(['all', 'used', 'unused']).default('all'),
});
export type TagListQueryInput = z.infer<typeof tagListQuerySchema>;

// -------------------------------------------------------------------- ads

export const upsertAdSchema = z.object({
  code: codeSchema,
  placement: z.enum(AD_PLACEMENTS),
  desktopAssetId: uuidSchema.nullable().optional(),
  mobileAssetId: uuidSchema.nullable().optional(),
  targetUrl: optionalSafeUrlSchema,
  activeFrom: z.string().trim().max(40).nullable().optional(),
  activeTo: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(false),
  translations: z
    .array(
      z.object({
        locale: localeSchema,
        title: optionalText(240),
        description: optionalText(2000),
      }),
    )
    .default([]),
});
export type UpsertAdInput = z.infer<typeof upsertAdSchema>;

// --------------------------------------------------------- content pages

export const upsertContentPageSchema = z.object({
  slug: slugSchema,
  pageType: z.enum(CONTENT_PAGE_TYPES),
  status: z.enum(PUBLISH_STATUSES).default('draft'),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  translations: z
    .array(
      z.object({
        locale: localeSchema,
        title: nonEmptyText(240),
        bodyHtml: optionalText(50_000),
        seoTitle: optionalText(240),
        seoDescription: optionalText(400),
      }),
    )
    .min(1),
});
export type UpsertContentPageInput = z.infer<typeof upsertContentPageSchema>;

// ------------------------------------------- structured content operations

const httpsUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'validation.url.https');

const optionalHttpsUrlSchema = z
  .union([httpsUrlSchema, z.literal(''), z.null()])
  .transform((value) => (value ? value : null))
  .optional();

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date.format')
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)),
    'validation.date.invalid',
  );

const optionalDateOnlySchema = z
  .union([dateOnlySchema, z.literal(''), z.null()])
  .transform((value) => (value ? value : null))
  .optional();

export const contentStatusSchema = z.object({
  status: z.enum(PUBLISH_STATUSES),
});
export type ContentStatusInput = z.infer<typeof contentStatusSchema>;

const factoryMediaTranslationSchema = z.object({
  locale: localeSchema,
  title: nonEmptyText(240),
  description: optionalText(5000),
  altText: optionalText(240),
});

const factoryMediaBaseSchema = z.object({
  mediaType: z.enum(['image', 'video']),
  assetId: uuidSchema.nullable().optional(),
  coverAssetId: uuidSchema.nullable().optional(),
  videoSourceType: z.enum(['upload', 'external']).nullable().optional(),
  videoUrl: optionalHttpsUrlSchema,
  sourceNote: optionalText(2000),
  adminNote: optionalText(2000),
  placements: z.array(z.enum(FACTORY_MEDIA_PLACEMENTS)).max(10).default([]),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  status: z.enum(PUBLISH_STATUSES).default('draft'),
  translations: z.array(factoryMediaTranslationSchema).min(1).max(SUPPORTED_LOCALES.length),
});

export const createFactoryMediaSchema = factoryMediaBaseSchema;
export type CreateFactoryMediaInput = z.infer<typeof createFactoryMediaSchema>;

export const updateFactoryMediaSchema = factoryMediaBaseSchema.partial();
export type UpdateFactoryMediaInput = z.infer<typeof updateFactoryMediaSchema>;

export const factoryMediaListQuerySchema = paginationQuerySchema.extend({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  q: z.string().trim().max(120).optional(),
  mediaType: z.union([z.literal('all'), z.literal('image'), z.literal('video')]).default('all'),
  placement: z.union([z.literal('all'), z.enum(FACTORY_MEDIA_PLACEMENTS)]).default('all'),
  publishStatus: z.union([z.literal('all'), z.enum(PUBLISH_STATUSES)]).default('all'),
});
export type FactoryMediaListQueryInput = z.infer<typeof factoryMediaListQuerySchema>;

const factoryProcessTranslationSchema = z.object({
  locale: localeSchema,
  title: nonEmptyText(240),
  description: optionalText(5000),
});

const factoryProcessBaseSchema = z.object({
  assetId: uuidSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  status: z.enum(PUBLISH_STATUSES).default('draft'),
  adminNote: optionalText(2000),
  translations: z.array(factoryProcessTranslationSchema).min(1).max(SUPPORTED_LOCALES.length),
});

export const createFactoryProcessStepSchema = factoryProcessBaseSchema;
export type CreateFactoryProcessStepInput = z.infer<typeof createFactoryProcessStepSchema>;
export const updateFactoryProcessStepSchema = factoryProcessBaseSchema.partial();
export type UpdateFactoryProcessStepInput = z.infer<typeof updateFactoryProcessStepSchema>;

export const factoryProcessListQuerySchema = paginationQuerySchema.extend({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  q: z.string().trim().max(120).optional(),
  publishStatus: z.union([z.literal('all'), z.enum(PUBLISH_STATUSES)]).default('all'),
});
export type FactoryProcessListQueryInput = z.infer<typeof factoryProcessListQuerySchema>;

const credentialTranslationSchema = z.object({
  locale: localeSchema,
  name: nonEmptyText(240),
  description: optionalText(5000),
  verificationLabel: optionalText(120),
});

const credentialBaseSchema = z.object({
  credentialTypeCode: codeSchema,
  issuer: optionalText(240),
  credentialNumber: optionalText(160),
  issuedAt: optionalDateOnlySchema,
  validFrom: optionalDateOnlySchema,
  validUntil: optionalDateOnlySchema,
  validityType: z.enum(CREDENTIAL_VALIDITY_TYPES).default('not_specified'),
  showExpiredBadge: z.boolean().default(true),
  primaryAssetId: uuidSchema.nullable().optional(),
  additionalAssetIds: z.array(uuidSchema).max(10).default([]),
  verificationUrl: optionalHttpsUrlSchema,
  placements: z.array(z.enum(CREDENTIAL_PLACEMENTS)).max(10).default([]),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  status: z.enum(PUBLISH_STATUSES).default('draft'),
  adminNote: optionalText(2000),
  translations: z.array(credentialTranslationSchema).min(1).max(SUPPORTED_LOCALES.length),
});

export const createCredentialSchema = credentialBaseSchema;
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export const updateCredentialSchema = credentialBaseSchema.partial();
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;

export const credentialListQuerySchema = paginationQuerySchema.extend({
  locale: localeSchema.default(DEFAULT_ADMIN_LOCALE),
  q: z.string().trim().max(120).optional(),
  credentialType: z.union([z.literal('all'), codeSchema]).default('all'),
  validityStatus: z
    .union([
      z.literal('all'),
      z.literal('valid'),
      z.literal('expiring'),
      z.literal('expired'),
      z.literal('no_expiry'),
    ])
    .default('all'),
  publishStatus: z.union([z.literal('all'), z.enum(PUBLISH_STATUSES)]).default('all'),
});
export type CredentialListQueryInput = z.infer<typeof credentialListQuerySchema>;

const homeSectionTranslationSchema = z.object({
  locale: localeSchema,
  title: nonEmptyText(240),
  description: optionalText(5000),
  ctaLabel: optionalText(120),
});

export const updateHomeSectionSchema = z.object({
  enabled: z.boolean().optional(),
  displayLimit: z.coerce.number().int().min(1).max(24).optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  itemIds: z.array(uuidSchema).max(24).optional(),
  ctaUrl: z.union([internalRouteSchema, httpsUrlSchema, z.literal(''), z.null()]).optional(),
  adminNote: optionalText(2000),
  translations: z
    .array(homeSectionTranslationSchema)
    .min(1)
    .max(SUPPORTED_LOCALES.length)
    .optional(),
});
export type UpdateHomeSectionInput = z.infer<typeof updateHomeSectionSchema>;

export const homeSectionCodeSchema = z.enum(HOME_SECTION_CODES);

export const upsertFaqSchema = z.object({
  code: codeSchema,
  category: z.enum(FAQ_CATEGORY_CODES),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(true),
  translations: z
    .array(
      z.object({
        locale: localeSchema,
        question: nonEmptyText(500),
        answerHtml: nonEmptyText(20_000),
      }),
    )
    .min(1),
});
export type UpsertFaqInput = z.infer<typeof upsertFaqSchema>;

// ------------------------------------------------------------------ files

export const FILE_UPLOAD_PURPOSES = [
  'product-image',
  'category-cover',
  'ad-image',
  'quote-template',
  'logo',
  'content',
  'factory-media-image',
  'factory-media-video',
  'factory-process-image',
  'credential-document',
] as const;

export const fileUploadQuerySchema = z.object({
  purpose: z.enum(FILE_UPLOAD_PURPOSES),
});
export type FileUploadPurpose = z.infer<typeof fileUploadQuerySchema>['purpose'];

export const directUploadInitSchema = z.object({
  purpose: z.enum(FILE_UPLOAD_PURPOSES),
  originalName: z.string().trim().min(1).max(255),
  declaredMime: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().min(1).max(104_857_600),
});
export type DirectUploadInitInput = z.infer<typeof directUploadInitSchema>;

export const productImageDirectUploadInitSchema = directUploadInitSchema.pick({
  originalName: true,
  declaredMime: true,
  sizeBytes: true,
});
export type ProductImageDirectUploadInitInput = z.infer<typeof productImageDirectUploadInitSchema>;

export const fileUploadMetaSchema = z.object({
  purpose: z.enum(FILE_UPLOAD_PURPOSES),
  altText: optionalText(240),
});

export const fileListQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().max(32).optional(),
  purpose: z.string().trim().max(40).optional(),
});

export const fileDeleteSchema = z.object({
  confirm: z.literal(true),
});

// ------------------------------------------------------------ quote / pdf

export const quoteTemplateUploadSchema = z.object({
  name: nonEmptyText(180),
  templateType: z.enum(QUOTE_TEMPLATE_TYPES),
  fileAssetId: uuidSchema,
  sheetName: z.string().trim().max(120).nullable().optional(),
  headerRow: z.coerce.number().int().min(1).max(200).default(1),
  itemStartRow: z.coerce.number().int().min(1).max(500).default(2),
  fieldMapping: z.record(z.string(), z.string().max(200)).default({}),
});
export type QuoteTemplateUploadInput = z.infer<typeof quoteTemplateUploadSchema>;

export const quoteExportCreateSchema = z.object({
  templateId: uuidSchema,
  categoryId: uuidSchema.nullable().optional(),
  includeDescendants: z.boolean().default(true),
  publishStatus: z.enum(PUBLISH_STATUSES).optional(),
  lifecycleStatus: z.enum(PRODUCT_LIFECYCLE_STATUSES).optional(),
  tag: z.string().trim().max(80).optional(),
  search: z.string().trim().max(120).optional(),
  locale: localeSchema.default('en-US'),
});
export type QuoteExportCreateInput = z.infer<typeof quoteExportCreateSchema>;

export const quoteExportPreviewSchema = quoteExportCreateSchema.omit({ templateId: true }).extend({
  templateId: uuidSchema.optional(),
});
export type QuoteExportPreviewInput = z.infer<typeof quoteExportPreviewSchema>;

// --------------------------------------------------------------------- PI

export const piPartySchema = z.object({
  companyName: nonEmptyText(240),
  contactName: optionalText(160),
  email: z
    .union([emailSchema, z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
});

export const piPartyFullSchema = piPartySchema.extend({
  phone: optionalText(40),
  address: optionalText(1000),
  countryCode: countryCodeSchema.nullable().optional(),
});

export const piItemInputSchema = z.object({
  lineNo: z.coerce.number().int().min(1).max(500).optional(),
  sku: skuSchema,
  productName: nonEmptyText(240),
  description: optionalText(2000),
  quantity: decimalStringSchema(),
  unit: z.string().trim().min(1).max(24).default('pcs'),
  unitPrice: decimalStringSchema(),
  discountAmount: decimalStringSchema().default('0'),
  packaging: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type PiItemInput = z.infer<typeof piItemInputSchema>;

export const piTermsSchema = z
  .object({
    incoterms: optionalText(40),
    incotermsLocation: optionalText(120),
    paymentTerms: optionalText(500),
    deliveryTime: optionalText(240),
    shippingMethod: optionalText(120),
    portOfLoading: optionalText(120),
    portOfDestination: optionalText(120),
    bankInformation: optionalText(2000),
  })
  .partial();

export const createPiDocumentSchema = z.object({
  piNo: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'validation.piNo.invalid')
    .optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'validation.currency.invalid'),
  issuedAt: z.string().trim().max(40).nullable().optional(),
  validUntil: z.string().trim().max(40).nullable().optional(),
  seller: piPartyFullSchema,
  buyer: piPartyFullSchema,
  terms: piTermsSchema.optional(),
  discountAmount: decimalStringSchema().default('0'),
  freightAmount: decimalStringSchema().default('0'),
  insuranceAmount: decimalStringSchema().default('0'),
  otherCharges: decimalStringSchema().default('0'),
  notes: optionalText(4000),
  items: z.array(piItemInputSchema).min(1).max(500),
});
export type CreatePiDocumentInput = z.infer<typeof createPiDocumentSchema>;

// Explicit update shape: see the note on updateCategorySchema below.
export const updatePiDocumentSchema = z.object({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'validation.currency.invalid')
    .optional(),
  issuedAt: z.string().trim().max(40).nullable().optional(),
  validUntil: z.string().trim().max(40).nullable().optional(),
  seller: piPartyFullSchema.optional(),
  buyer: piPartyFullSchema.optional(),
  terms: piTermsSchema.optional(),
  discountAmount: decimalStringSchema().optional(),
  freightAmount: decimalStringSchema().optional(),
  insuranceAmount: decimalStringSchema().optional(),
  otherCharges: decimalStringSchema().optional(),
  notes: optionalText(4000),
  items: z.array(piItemInputSchema).min(1).max(500).optional(),
});
export type UpdatePiDocumentInput = z.infer<typeof updatePiDocumentSchema>;

export const piStatusSchema = z.object({
  status: z.enum(PI_STATUSES),
});

export const piListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PI_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
});

// ------------------------------------------------------------------ leads

export const createCustomerSchema = z.object({
  phone: phoneInputSchema,
  countryCode: countryCodeSchema.optional(),
  displayName: optionalText(180),
  note: optionalText(2000),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const customerListQuerySchema = paginationQuerySchema.extend({
  phone: z.string().trim().max(32).optional(),
  countryCode: countryCodeSchema.optional(),
  q: z.string().trim().max(120).optional(),
});

export const createInquiryActivitySchema = z.object({
  customerId: uuidSchema.optional(),
  phone: phoneInputSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  salespersonName: nonEmptyText(160),
  salespersonPhone: phoneInputSchema.optional(),
  occurredAt: z.string().trim().max(40),
  productSkus: skuListSchema.default([]),
  note: optionalText(4000),
  source: z.enum(['manual', 'website_click', 'whatsapp_webhook']).default('manual'),
});
export type CreateInquiryActivityInput = z.infer<typeof createInquiryActivitySchema>;

export const inquiryActivityListQuerySchema = paginationQuerySchema.extend({
  customerId: uuidSchema.optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});

// -------------------------------------------------------------- analytics

export const analyticsRangeQuerySchema = z.object({
  range: z.enum(['realtime', 'today', '7d', '30d', 'custom']).default('today'),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  timezone: z.string().trim().max(60).default('UTC'),
  granularity: z.enum(['hour', 'day']).default('day'),
  countryCode: countryCodeSchema.optional(),
});
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

// ------------------------------------------------------------------ audit

export const auditLogQuerySchema = paginationQuerySchema.extend({
  actorId: uuidSchema.optional(),
  entityType: z.string().trim().max(100).optional(),
  entityId: z.string().trim().max(120).optional(),
  action: z.string().trim().max(120).optional(),
  /** Exact request id filter (docs/16 §5.1 requires it next to the copy action). */
  requestId: z.string().trim().max(120).optional(),
  /** Free-text search across action, entity and ids. */
  q: z.string().trim().max(120).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const idParamSchema = z.object({ id: uuidSchema });

export const signedDownloadQuerySchema = z.object({
  expiresInSeconds: z.coerce.number().int().min(30).max(3600).default(300),
});

export const defaultAdminLocale = DEFAULT_ADMIN_LOCALE;
