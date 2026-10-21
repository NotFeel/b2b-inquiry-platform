import type {
  AnalyticsEventName,
  CredentialValidityType,
  FileOperationStatus,
  HomeSectionCode,
  JobStatus,
  PermissionCode,
  PiStatus,
  ProductLifecycleStatus,
  ProductImageState,
  PublishStatus,
  QuoteTemplateType,
  SupportedLocale,
} from './constants';

export interface AdminUserSummary {
  id: string;
  username: string;
  displayName: string;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: { id: string; code: string; nameKey: string; names: RoleNames }[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedAdminUser {
  id: string;
  username: string;
  displayName: string;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

export interface LoginResponse {
  user: AuthenticatedAdminUser;
  expiresAt: string;
}

/**
 * Locale -> display name, maintained by administrators for custom roles.
 *
 * It is a display-only structure: authorization always uses `Role.code` and
 * `Permission.code` (docs/18 §7).
 */
export type RoleNames = Record<string, string>;

export interface RoleSummary {
  id: string;
  code: string;
  /** Translation key used by seeded roles (`role.sales`). Never a display name. */
  nameKey: string;
  /** Administrator-maintained names per locale; empty for seeded roles. */
  names: RoleNames;
  description: string | null;
  isSystem: boolean;
  /** Granted permission codes. Stable machine identifiers, never translated. */
  permissions: string[];
  permissionCount: number;
  userCount: number;
  updatedAt: string;
}

/**
 * Role option for the user form's multi-select.
 *
 * `assignable` reflects the current actor's authority and is a UI hint only:
 * the API re-checks every submitted role id (docs/17 §5.1, §7).
 */
export interface AssignableRoleSummary {
  id: string;
  code: string;
  nameKey: string;
  names: RoleNames;
  description: string | null;
  isSystem: boolean;
  assignable: boolean;
}

export interface PermissionSummary {
  code: PermissionCode | string;
  nameKey: string;
  module: string;
}

/** Current permission grant of one role, used to seed the permission editor. */
export interface RolePermissionGrant {
  roleId: string;
  code: string;
  nameKey: string;
  names: RoleNames;
  isSystem: boolean;
  permissionCodes: string[];
  updatedAt: string;
}

/**
 * One node of the configurable permission tree.
 *
 * Menu nodes carry the page-access permission declared by `Menu.permissionCode`;
 * their `permissions` list holds the action permissions of the owning module.
 * Module groups exist for permissions that no menu references (docs/18 §2.5).
 */
export interface PermissionTreeNode {
  /** Stable React key; unique across the whole tree. */
  key: string;
  kind: 'menu' | 'module';
  /** Menu code, or module name for a synthesized module group. */
  code: string;
  /** Locale -> label from `MenuTranslation`; empty for module groups. */
  labels: Record<string, string>;
  /** Translation key to fall back on when `labels` has no entry for the locale. */
  labelKey: string;
  accessPermission: PermissionTreePermission | null;
  permissions: PermissionTreePermission[];
  children: PermissionTreeNode[];
}

export interface PermissionTreePermission {
  code: string;
  nameKey: string;
  module: string;
}

export interface PermissionTree {
  items: PermissionTreeNode[];
  /** Every assignable code, so a client can detect a stale saved selection. */
  allPermissionCodes: string[];
}

/** Minimal user row returned by `GET /admin/roles/:id/users` (docs/18 §2.2). */
export interface RoleUserSummary {
  id: string;
  username: string;
  displayName: string;
  status: 'active' | 'disabled';
}

export interface MenuNode {
  id: string;
  code: string;
  /** Label resolved for the requested locale; falls back to en-US, then the code. */
  label: string;
  /** Every stored translation keyed by locale, used to seed the edit form. */
  labels: Record<string, string>;
  parentId: string | null;
  route: string | null;
  icon: string | null;
  permissionCode: string | null;
  sortOrder: number;
  visible: boolean;
  enabled: boolean;
  external: boolean;
  updatedAt: string;
  children: MenuNode[];
}

/** Result of the server-side product slug candidate generator (docs/26 §3.4). */
export interface ProductSlugSuggestion {
  slug: string;
  strategy: 'name' | 'name-random';
  available: boolean;
}

export interface DictionaryItemSummary {
  id: string;
  /** Type the item belongs to; stable one-level query key. */
  typeCode: string;
  code: string;
  value: string | null;
  sortOrder: number;
  enabled: boolean;
  systemLocked: boolean;
  labels: Record<string, string>;
  /** Used as the optimistic-concurrency token when editing the item. */
  updatedAt: string;
  /** Business rows referencing this item, when the caller asked for usage. */
  usageCount?: number;
}

export interface DictionaryTypeSummary {
  id: string;
  code: string;
  nameKey: string;
  description: string | null;
  systemLocked: boolean;
  enabled: boolean;
  itemCount: number;
  enabledItemCount: number;
  updatedAt: string;
  /** Present on the detail endpoint (and on the list when `includeItems=true`). */
  items?: DictionaryItemSummary[];
}

/**
 * One selectable option for a business form (docs/20 §3.3).
 *
 * `code` is the stable value submitted to APIs and used for filtering; `label`
 * is display-only and never parsed back into business logic.
 */
export interface DictionaryOption {
  id: string;
  code: string;
  label: string;
  /**
   * Optional extra payload of the item (for example the payment-terms clause
   * text). Selects still submit `code`; this exists for forms that need the
   * business text as well (docs/20 §3.2, §7.5).
   */
  value: string | null;
  sortOrder: number;
  enabled: boolean;
}

export interface DictionaryOptionSet {
  /** Type label comes from the i18n resource keyed by `nameKey` (docs/20 §3.2). */
  type: { code: string; nameKey: string };
  locale: string;
  items: DictionaryOption[];
}

export interface GlobalSettingSummary {
  key: string;
  /** Never contains a secret value: secrets report `hasValue` only. */
  value: unknown;
  hasValue: boolean;
  isPublic: boolean;
  isSecret: boolean;
  /** True when a secret value is stored; the raw value is never returned. */
  configured: boolean;
  groupCode: string;
  valueType: string;
  label: string;
  description: string;
  isSystem: boolean;
  isEditable: boolean;
  isDeletable: boolean;
  isRequired: boolean;
  sortOrder: number;
  revision: number;
  /** Short, safe rendering of the current value for the list view. */
  valuePreview: string | null;
  /** True when the value keeps working without an explicit row (registry/env default). */
  usingDefault: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

export interface GlobalSettingGroupSummary {
  code: string;
  /** i18n key resolved by the client (`settings.groups.<code>`). */
  labelKey: string;
  count: number;
  publicCount: number;
  secretCount: number;
  customCount: number;
}

/**
 * One node of the admin category tree (docs/22 §5.2).
 *
 * `productCount` counts products linked directly to this node; `totalProductCount`
 * adds every descendant branch. The two are never merged into one field: the
 * workbench shows both and a shared name would make one of them wrong.
 */
export interface CategoryNode {
  id: string;
  code: string;
  slug: string;
  /** Name resolved for the requested locale (falls back to en-US, then code). */
  name: string;
  parentId: string | null;
  sortOrder: number;
  enabled: boolean;
  visible: boolean;
  coverImageId: string | null;
  names: Record<string, string>;
  descriptions: Record<string, string | null>;
  productCount: number;
  totalProductCount: number;
  updatedAt: string;
  children: CategoryNode[];
}

/** Breadcrumb entry for a category path; `name` is resolved for the request locale. */
export interface CategoryPathEntry {
  id: string;
  slug: string;
  name: string;
}

/**
 * Category detail for the workbench detail panel (docs/22 §2.5).
 *
 * `path` runs root → self, `parentName` is the resolved parent label (never a raw
 * UUID) and `children` carries the direct children with their own counts.
 */
export interface CategoryDetail {
  id: string;
  code: string;
  slug: string;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  enabled: boolean;
  visible: boolean;
  coverImageId: string | null;
  names: Record<string, string>;
  descriptions: Record<string, string | null>;
  productCount: number;
  totalProductCount: number;
  updatedAt: string;
  createdAt: string;
  path: CategoryPathEntry[];
  children: CategoryNode[];
}

/** Flat row for the paginated category list/search view (docs/22 §2.6). */
export interface CategoryListItem {
  id: string;
  code: string;
  slug: string;
  /** Name resolved for the requested locale (falls back to en-US, then code). */
  name: string;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  enabled: boolean;
  visible: boolean;
  productCount: number;
  totalProductCount: number;
  updatedAt: string;
  /** Root → self, so the row can render its hierarchy without a second request. */
  path: CategoryPathEntry[];
  /** Depth starting at 1 for a root category. */
  depth: number;
}

export interface TagSummary {
  id: string;
  code: string;
  colorToken: string | null;
  enabled: boolean;
  /**
   * Display label resolved server-side for the requested locale
   * (locale → English → `code`), so admin and pickers never disagree on what
   * "the" name of a tag is.
   */
  label: string;
  /** Every translation currently stored, keyed by locale (never assumed complete). */
  labels: Record<string, string>;
  /** Service-side aggregate; never accepted from a client (docs/23 §6.1). */
  productCount: number;
  updatedAt: string;
  /**
   * Admin locales with no label yet (docs/23 §11).
   *
   * Surfaced so the back office can flag a half-translated tag rather than
   * silently rendering a fallback the administrator cannot see.
   */
  missingLocales: string[];
}

/**
 * Tag option for pickers (docs/23 §8.1).
 *
 * The product editor asks for enabled tags only; a product that already carries
 * a now-disabled tag keeps showing it through the saved product payload rather
 * than through this list, so a save never silently drops the association.
 */
export interface TagOption {
  id: string;
  code: string;
  label: string;
  colorToken: string | null;
  enabled: boolean;
}

/**
 * A tag as seen from a product (docs/23 §8.1).
 *
 * Deliberately smaller than `TagSummary`: the product editor needs the code, the
 * display labels and whether the tag is still enabled, not catalogue-wide
 * aggregates such as `productCount`.
 */
export interface ProductTagRef {
  id: string;
  code: string;
  colorToken: string | null;
  enabled: boolean;
  labels: Record<string, string>;
}

export interface ProductImageSummary {
  id: string;
  fileAssetId: string | null;
  /** Preview URL resolved by the server; never a client-supplied path. */
  url: string;
  originalName: string | null;
  alt: string | null;
  sortOrder: number;
  isCover: boolean;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  mimeType: string | null;
  /**
   * Backend-owned lifecycle of the stored object (docs/24 §4.4). The editor
   * must render `DELETE_PENDING`/`DELETE_FAILED` instead of assuming the file
   * is still there, and must never offer "set as cover" for those rows.
   */
  state: ProductImageState;
  /** Queued/running physical-delete operation, when one exists. */
  deleteOperationId: string | null;
}

export interface ProductAdminSummary {
  id: string;
  sku: string;
  slug: string;
  name: string;
  /** Chinese secondary name, shown under the English name in the list. */
  nameZh: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Full `Parent / Child` path so the list never shows a bare UUID. */
  categoryPath: string | null;
  publishStatus: PublishStatus;
  lifecycleStatus: ProductLifecycleStatus;
  isNew: boolean;
  isFeatured: boolean;
  /**
   * Show in the storefront home page's pre-order rail.
   *
   * Independent from `lifecycleStatus`: the lifecycle says the product is a
   * pre-order item, this flag says the operator curated it for the home page
   * (business decision 2026-10-17; only valid for a PREORDER product).
   */
  isPreOrder: boolean;
  sortOrder: number;
  /** Number of usable images; pending/failed deletes are excluded. */
  imageCount: number;
  /** `true` when a usable cover image exists, so the row needs no extra request. */
  hasCover: boolean;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  /** Images waiting for (or blocked on) a physical delete. */
  pendingImageDeletes: number;
  tagCodes: string[];
  tagIds: string[];
  /**
   * Internal quotation price (CNY). Present only when the caller holds
   * `product.cost.read`; `priceVisible` states which case applies so the list
   * can render "not set" instead of a price it is not allowed to see.
   */
  priceCny: string | null;
  priceVisible: boolean;
  updatedAt: string;
}

export interface ProductAdminDetail extends ProductAdminSummary {
  /**
   * Dictionary item backing each status (docs/20 §8).
   *
   * The enum column is still authoritative for reads; these ids are kept in
   * parity by every write so the switch release has a verified mapping.
   */
  lifecycleStatusItemId: string | null;
  publishStatusItemId: string | null;
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
  translations: Record<
    string,
    {
      name: string;
      description: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
    }
  >;
  images: ProductImageSummary[];
  tags: ProductTagRef[];
  /** Cosmetic gallery note: every product must have at most one cover. */
  coverImageId: string | null;
  createdAt: string;
}

export interface FactoryMediaAdminSummary {
  id: string;
  mediaType: 'image' | 'video';
  title: string;
  status: PublishStatus;
  placements: string[];
  sortOrder: number;
  thumbnailUrl: string | null;
  updatedAt: string;
}

export interface FactoryMediaAdminDetail extends FactoryMediaAdminSummary {
  assetId: string | null;
  assetUrl: string | null;
  coverAssetId: string | null;
  coverAssetUrl: string | null;
  videoSourceType: 'upload' | 'external' | null;
  videoUrl: string | null;
  sourceNote: string | null;
  adminNote: string | null;
  translations: Record<
    string,
    { title: string; description: string | null; altText: string | null }
  >;
}

export interface FactoryProcessStepAdminSummary {
  id: string;
  title: string;
  status: PublishStatus;
  sortOrder: number;
  thumbnailUrl: string | null;
  updatedAt: string;
}

export interface FactoryProcessStepAdminDetail extends FactoryProcessStepAdminSummary {
  assetId: string | null;
  assetUrl: string | null;
  adminNote: string | null;
  translations: Record<string, { title: string; description: string | null }>;
}

export interface CredentialAdminSummary {
  id: string;
  name: string;
  credentialTypeCode: string;
  issuer: string | null;
  credentialNumber: string | null;
  validFrom: string | null;
  validUntil: string | null;
  validityType: CredentialValidityType;
  status: PublishStatus;
  placements: string[];
  sortOrder: number;
  thumbnailUrl: string | null;
  updatedAt: string;
}

export interface CredentialAdminDetail extends CredentialAdminSummary {
  issuedAt: string | null;
  showExpiredBadge: boolean;
  primaryAssetId: string | null;
  primaryAssetUrl: string | null;
  additionalAssetIds: string[];
  verificationUrl: string | null;
  adminNote: string | null;
  translations: Record<
    string,
    { name: string; description: string | null; verificationLabel: string | null }
  >;
}

export interface HomeSectionAdminDetail {
  id: string;
  code: HomeSectionCode;
  enabled: boolean;
  displayLimit: number;
  sortOrder: number;
  itemIds: string[];
  ctaUrl: string | null;
  adminNote: string | null;
  translations: Record<
    string,
    { title: string; description: string | null; ctaLabel: string | null }
  >;
  updatedAt: string;
}

/** Result of a validated staging upload (docs/24 §6.2). */
export interface MediaStagingResult {
  fileAssetId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: 'ready';
  /** Preview URL for the gallery before the asset is attached to a product. */
  url: string;
}

export interface ProductImageAttachResult {
  images: ProductImageSummary[];
  coverImageId: string | null;
}

export interface FileOperationSummary {
  id: string;
  /** Machine task type, for example `product_image`. */
  entityType: string | null;
  entityId: string | null;
  productId: string | null;
  productImageId: string | null;
  status: FileOperationStatus;
  attempts: number;
  lastErrorCode: string | null;
  /** Whether the UI should offer a manual retry. */
  retryable: boolean;
  /** The storage key is shown only to authenticated operators, never publicly. */
  storageKey: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface FileAssetSummary {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: string;
  url: string | null;
  createdAt: string;
}

export interface AdAdminSummary {
  id: string;
  code: string;
  placement: string;
  targetUrl: string | null;
  desktopAssetId: string | null;
  mobileAssetId: string | null;
  activeFrom: string | null;
  activeTo: string | null;
  sortOrder: number;
  enabled: boolean;
  translations: Record<string, { title: string | null; description: string | null }>;
  updatedAt: string;
}

export interface ContentPageSummary {
  id: string;
  slug: string;
  pageType: string;
  status: PublishStatus;
  sortOrder: number;
  translations: Record<
    string,
    {
      title: string;
      bodyHtml: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
    }
  >;
  updatedAt: string;
}

export interface FaqSummary {
  id: string;
  sortOrder: number;
  enabled: boolean;
  translations: Record<string, { question: string; answerHtml: string }>;
  updatedAt: string;
}

export interface QuoteTemplateSummary {
  id: string;
  name: string;
  templateType: QuoteTemplateType;
  version: number;
  status: string;
  sheetName: string | null;
  fieldMapping: Record<string, unknown>;
  validationReport: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteExportJobSummary {
  id: string;
  templateId: string;
  templateName: string | null;
  templateVersion: number;
  requestedBy: string | null;
  productCount: number;
  filterSnapshot: Record<string, unknown>;
  status: JobStatus;
  errorCode: string | null;
  fileUrl: string | null;
  fileSizeBytes: number | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PdfConversionJobSummary {
  id: string;
  sourceFileName: string;
  status: JobStatus;
  errorCode: string | null;
  outputUrl: string | null;
  pageCount: number | null;
  outputSizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PiItemSummary {
  id: string;
  lineNo: number;
  sku: string;
  productName: string;
  description: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  lineAmount: string;
  packaging: Record<string, unknown> | null;
}

export interface PiDocumentSummary {
  id: string;
  piNo: string;
  revisionNo: number;
  status: PiStatus;
  currency: string;
  issuedAt: string | null;
  validUntil: string | null;
  buyer: Record<string, unknown>;
  seller: Record<string, unknown>;
  terms: Record<string, unknown> | null;
  subtotal: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherCharges: string;
  totalAmount: string;
  notes: string | null;
  items?: PiItemSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSummary {
  id: string;
  phoneE164: string;
  /** Masked for roles without full customer visibility (docs/13 §3). */
  phoneDisplay: string;
  countryCode: string | null;
  displayName: string | null;
  note: string | null;
  activityCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface InquiryActivitySummary {
  id: string;
  customerId: string;
  customerPhoneDisplay: string;
  salespersonName: string;
  salespersonPhone: string | null;
  occurredAt: string;
  productSkus: string[];
  note: string | null;
  source: string;
  createdBy: string | null;
  createdAt: string;
}

export interface CustomerLookupResult {
  query: string;
  normalizedPhone: string | null;
  countryRequired: boolean;
  exactMatch: CustomerSummary | null;
  fuzzyMatches: CustomerSummary[];
  activities: InquiryActivitySummary[];
}

export interface AnalyticsOverview {
  rangeStart: string;
  rangeEnd: string;
  timezone: string;
  pageViews: number;
  uniqueVisitors: number;
  activeSessions: number;
  whatsappClicks: number;
  productSelects: number;
  unknownCountryPageViews: number;
  lastEventAt: string | null;
}

export interface AnalyticsTimeseriesPoint {
  bucket: string;
  pageViews: number;
  uniqueVisitors: number;
}

export interface AnalyticsCountryRow {
  countryCode: string | null;
  pageViews: number;
  uniqueVisitors: number;
  activeSessions: number;
}

export interface AnalyticsRealtime {
  windowSeconds: number;
  activeSessions: number;
  activeCountries: AnalyticsCountryRow[];
  lastEventAt: string | null;
  generatedAt: string;
}

export interface AnalyticsEventBreakdownRow {
  eventName: AnalyticsEventName | string;
  count: number;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface JobStatusResult {
  id: string;
  status: JobStatus;
  errorCode: string | null;
  progress: number | null;
  result: Record<string, unknown> | null;
  updatedAt: string;
}

export interface AdminLocaleDictionary {
  locale: SupportedLocale;
  messages: Record<string, unknown>;
}
