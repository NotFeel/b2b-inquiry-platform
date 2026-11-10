/**
 * Cross-application constants. Keep machine codes stable: they appear in the
 * database, in API payloads and in translated UI messages.
 */

export const SUPPORTED_LOCALES = ['en-US', 'zh-CN'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Storefront first phase ships English only (docs/01, docs/14). */
export const PUBLIC_LOCALE: SupportedLocale = 'en-US';
export const DEFAULT_ADMIN_LOCALE: SupportedLocale = 'zh-CN';

/** URL/query locale is authoritative; unknown values use the admin default. */
export function resolveAdminLocale(value: string | null | undefined): SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '')
    ? (value as SupportedLocale)
    : DEFAULT_ADMIN_LOCALE;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Max SKUs accepted in one WhatsApp batch message; configurable per site (docs/01 §5). */
export const DEFAULT_WHATSAPP_SELECTION_LIMIT = 20;

export const PRODUCT_LIFECYCLE_STATUSES = ['available', 'preorder', 'discontinued'] as const;
export type ProductLifecycleStatus = (typeof PRODUCT_LIFECYCLE_STATUSES)[number];

export const PUBLISH_STATUSES = ['draft', 'published', 'unpublished'] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

export const JOB_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'failed',
  'cancel_requested',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Lifecycle of one product image (docs/24 §4.4).
 *
 * Stored on `ProductImage.deleteState`; the admin UI renders it and the public
 * projection filters on it, so a pending or failed physical delete can never be
 * shown as a valid picture.
 */
export const PRODUCT_IMAGE_STATES = ['READY', 'DELETE_PENDING', 'DELETE_FAILED'] as const;
export type ProductImageState = (typeof PRODUCT_IMAGE_STATES)[number];

/** Client-facing view of a queued permanent delete (docs/24 §6.2). */
export const FILE_OPERATION_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'] as const;
export type FileOperationStatus = (typeof FILE_OPERATION_STATUSES)[number];

/**
 * Gallery limits. The API enforces them; the UI only mirrors them so the reason
 * a file was refused is visible before the upload starts. Both are configurable
 * through the environment (`UPLOAD_MAX_BYTES`, `UPLOAD_MAX_PIXELS`) with these
 * values as the documented defaults.
 */
export const PRODUCT_IMAGE_LIMITS = {
  maxPerProduct: 20,
  maxBytes: 10 * 1024 * 1024,
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  /** Managed storage prefixes a product image object may live under. */
  managedKeyPrefixes: ['product-image/'],
  maxAltTextLength: 240,
} as const;

export const ANALYTICS_EVENTS = [
  'page_view',
  'session_start',
  'heartbeat',
  'whatsapp_click',
  'product_select',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Ad / link targets are restricted to safe protocols (docs/01 §3.6, docs/13 §1). */
export const ALLOWED_LINK_PROTOCOLS = ['https:', 'mailto:'] as const;

/**
 * Allowed tag style tokens (docs/23 §3.1, §4.2).
 *
 * A tag stores a token, never a CSS colour: the UI maps a token onto the design
 * system's badge tones, so a database value can never become arbitrary style.
 * `null` means "no token" and renders as the neutral badge.
 */
export const TAG_COLOR_TOKENS = [
  'tag.neutral',
  'tag.brand',
  'tag.success',
  'tag.warning',
  'tag.info',
  'tag.danger',
] as const;
export type TagColorToken = (typeof TAG_COLOR_TOKENS)[number];

export const PRODUCT_UNITS = {
  productDimension: 'mm',
  productWeight: 'g',
  cartonDimension: 'cm',
  cartonWeight: 'kg',
} as const;

export const DEFAULT_CURRENCY = 'USD';
export const INTERNAL_PRICE_CURRENCY = 'CNY';

/** Permission codes are stable machine codes (docs/01 §3.3). */
export const PERMISSIONS = {
  dashboardRead: 'dashboard.read',
  userRead: 'user.read',
  userCreate: 'user.create',
  userUpdate: 'user.update',
  userDelete: 'user.delete',
  /** Assigning/removing roles is a distinct capability from editing a profile. */
  userRoleAssign: 'user.role.assign',
  roleRead: 'role.read',
  roleCreate: 'role.create',
  roleUpdate: 'role.update',
  roleDelete: 'role.delete',
  /**
   * Reading and replacing a role's permission set is a distinct capability from
   * editing its basic information (docs/18 §2.2, §5.2).
   */
  rolePermissionsRead: 'role.permissions.read',
  rolePermissionsUpdate: 'role.permissions.update',
  menuRead: 'menu.read',
  menuCreate: 'menu.create',
  menuUpdate: 'menu.update',
  menuDelete: 'menu.delete',
  dictionaryRead: 'dictionary.read',
  /**
   * Reading selectable options for a business form (product status, payment
   * terms, ...) is a distinct capability from maintaining the dictionary: it is
   * granted to the operator roles that own those forms (docs/20 §10).
   */
  dictionaryOptionRead: 'dictionary.option.read',
  dictionaryUpdate: 'dictionary.update',
  settingRead: 'setting.read',
  settingCreate: 'setting.create',
  settingUpdate: 'setting.update',
  settingDelete: 'setting.delete',
  categoryRead: 'category.read',
  categoryCreate: 'category.create',
  categoryUpdate: 'category.update',
  categoryDelete: 'category.delete',
  productRead: 'product.read',
  productCreate: 'product.create',
  productUpdate: 'product.update',
  productDelete: 'product.delete',
  productPublish: 'product.publish',
  /** Validate and atomically import a complete Excel workbook. */
  productImport: 'product.import',
  productExport: 'product.export',
  /**
   * Gallery maintenance is a distinct capability from editing the master data
   * (docs/24 §9): uploading, re-ordering/alt text and permanently deleting an
   * image object are each protected on their own endpoint.
   */
  productImageUpload: 'product.image.upload',
  productImageUpdate: 'product.image.update',
  productImageDelete: 'product.image.delete',
  /**
   * The internal CNY price is quote/PI input only. Reading and writing it are
   * separated from `product.update` so a role can maintain the catalogue
   * without ever seeing the internal cost (docs/24 §3.3 D, §10).
   */
  productCostRead: 'product.cost.read',
  productCostUpdate: 'product.cost.update',
  /**
   * Dynamic quotation XLSX export (docs/36). Read and create are deliberately
   * separate: a reviewer can open the selection screen without being able to
   * generate a customer-facing price file.
   */
  quotationExportRead: 'quotation.export.read',
  quotationExportCreate: 'quotation.export.create',
  quotationExportUnpublished: 'quotation.export.unpublished',
  quotationRead: 'quotation.read',
  quotationCalculate: 'quotation.calculate',
  quotationCreate: 'quotation.create',
  quotationUpdate: 'quotation.update',
  quotationDelete: 'quotation.delete',
  quotationConvertToOrder: 'quotation.convert_to_order',
  quotationCostRead: 'quotation.cost.read',
  quotationCostUpdate: 'quotation.cost.update',
  orderRead: 'order.read',
  orderCreate: 'order.create',
  orderUpdate: 'order.update',
  orderCancel: 'order.cancel',
  orderCostRead: 'order.cost.read',
  /**
   * Correcting the buyer/consignee snapshot of one order is separate from
   * editing the customer master record (docs/41 §4.3).
   */
  orderCustomerSnapshotUpdate: 'order.customer_snapshot.update',
  orderCustomerProfileSync: 'order.customer_profile.sync',
  /**
   * Commercial documents (CI/PI) are separate entities from the legacy PI
   * module: read, create, update, render, issue, revision, cancel and download
   * are independently authorized (docs/41 §11).
   */
  commercialDocumentRead: 'commercial_document.read',
  commercialDocumentCreate: 'commercial_document.create',
  commercialDocumentUpdate: 'commercial_document.update',
  commercialDocumentPreview: 'commercial_document.preview',
  commercialDocumentIssue: 'commercial_document.issue',
  commercialDocumentRevisionCreate: 'commercial_document.revision.create',
  commercialDocumentCancel: 'commercial_document.cancel',
  commercialDocumentDownload: 'commercial_document.download',
  commercialDocumentDelete: 'commercial_document.delete',
  documentTemplateRead: 'document_template.read',
  documentTemplateCreate: 'document_template.create',
  documentTemplateUpdate: 'document_template.update',
  documentTemplateDelete: 'document_template.delete',
  documentTemplatePublish: 'document_template.publish',
  companyProfileManage: 'company_profile.manage',
  bankAccountManage: 'bank_account.manage',
  /** Private Excel-to-PDF conversion (docs/38). */
  excelPdfRead: 'excel_pdf.read',
  excelPdfCreate: 'excel_pdf.create',
  excelPdfDownload: 'excel_pdf.download',
  excelPdfRetry: 'excel_pdf.retry',
  excelPdfDelete: 'excel_pdf.delete',
  tagRead: 'tag.read',
  tagCreate: 'tag.create',
  tagUpdate: 'tag.update',
  tagDelete: 'tag.delete',
  adRead: 'ad.read',
  adUpdate: 'ad.update',
  contentRead: 'content.read',
  contentUpdate: 'content.update',
  factoryMediaRead: 'content.factory-media.read',
  factoryMediaCreate: 'content.factory-media.create',
  factoryMediaUpdate: 'content.factory-media.update',
  factoryMediaPublish: 'content.factory-media.publish',
  factoryMediaDelete: 'content.factory-media.delete',
  factoryProcessRead: 'content.factory-process.read',
  factoryProcessCreate: 'content.factory-process.create',
  factoryProcessUpdate: 'content.factory-process.update',
  factoryProcessPublish: 'content.factory-process.publish',
  factoryProcessDelete: 'content.factory-process.delete',
  credentialsRead: 'content.credentials.read',
  credentialsCreate: 'content.credentials.create',
  credentialsUpdate: 'content.credentials.update',
  credentialsPublish: 'content.credentials.publish',
  credentialsDelete: 'content.credentials.delete',
  homeSectionsRead: 'content.home-sections.read',
  homeSectionsCreate: 'content.home-sections.create',
  homeSectionsUpdate: 'content.home-sections.update',
  homeSectionsPublish: 'content.home-sections.publish',
  homeSectionsDelete: 'content.home-sections.delete',
  fileUpload: 'file.upload',
  fileRead: 'file.read',
  fileDelete: 'file.delete',
  quoteRead: 'quote.read',
  quoteExport: 'quote.export',
  quoteDelete: 'quote.delete',
  piRead: 'pi.read',
  piCreate: 'pi.create',
  piUpdate: 'pi.update',
  piExport: 'pi.export',
  leadRead: 'lead.read',
  leadCreate: 'lead.create',
  leadUpdate: 'lead.update',
  customerRead: 'customer.read',
  customerCreate: 'customer.create',
  customerUpdate: 'customer.update',
  customerExport: 'customer.export',
  analyticsRead: 'analytics.read',
  auditRead: 'audit.read',
  jobRead: 'job.read',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_CODES: string[] = Object.values(PERMISSIONS);

export const FACTORY_MEDIA_PLACEMENTS = [
  'factory-hero',
  'factory-gallery',
  'home-factory',
] as const;
export type FactoryMediaPlacement = (typeof FACTORY_MEDIA_PLACEMENTS)[number];

export const CREDENTIAL_PLACEMENTS = ['quality-page', 'home-quality'] as const;
export type CredentialPlacement = (typeof CREDENTIAL_PLACEMENTS)[number];

export const CREDENTIAL_VALIDITY_TYPES = ['dated', 'perpetual', 'not_specified'] as const;
export type CredentialValidityType = (typeof CREDENTIAL_VALIDITY_TYPES)[number];

export const HOME_SECTION_CODES = ['home.factory-preview', 'home.quality-preview'] as const;
export type HomeSectionCode = (typeof HOME_SECTION_CODES)[number];

export const SYSTEM_ROLE_SUPER_ADMIN = 'super_admin';
export const SUPER_ADMIN_USERNAME_ENV = 'BOOTSTRAP_ADMIN_USERNAME';

/** Stable error codes returned by the API (docs/07 §3). */
export const ERROR_CODES = {
  validationFailed: 'VALIDATION_FAILED',
  unauthorized: 'UNAUTHORIZED',
  authInvalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  authAccountDisabled: 'AUTH_ACCOUNT_DISABLED',
  authAccountLocked: 'AUTH_ACCOUNT_LOCKED',
  authSessionExpired: 'AUTH_SESSION_EXPIRED',
  authPasswordChangeRequired: 'AUTH_PASSWORD_CHANGE_REQUIRED',
  authCurrentPasswordInvalid: 'AUTH_CURRENT_PASSWORD_INVALID',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  rateLimited: 'RATE_LIMITED',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  requestAborted: 'REQUEST_ABORTED',
  categoryCycleDetected: 'CATEGORY_CYCLE_DETECTED',
  categoryHasChildren: 'CATEGORY_HAS_CHILDREN',
  categoryHasProducts: 'CATEGORY_HAS_PRODUCTS',
  categoryDepthExceeded: 'CATEGORY_DEPTH_EXCEEDED',
  categorySlugConflict: 'CATEGORY_SLUG_CONFLICT',
  categoryCodeConflict: 'CATEGORY_CODE_CONFLICT',
  categoryParentInvalid: 'CATEGORY_PARENT_INVALID',
  categoryConcurrentUpdate: 'CATEGORY_CONCURRENT_UPDATE',
  tagCodeConflict: 'TAG_CODE_CONFLICT',
  tagInUse: 'TAG_IN_USE',
  tagNotFound: 'TAG_NOT_FOUND',
  tagColorTokenInvalid: 'TAG_COLOR_TOKEN_INVALID',
  tagTranslationMissing: 'TAG_TRANSLATION_MISSING',
  tagConcurrentUpdate: 'TAG_CONCURRENT_UPDATE',
  productSkuConflict: 'PRODUCT_SKU_CONFLICT',
  productSlugConflict: 'PRODUCT_SLUG_CONFLICT',
  productSlugSuggestionConflict: 'PRODUCT_SLUG_SUGGESTION_CONFLICT',
  productSlugLocked: 'PRODUCT_SLUG_LOCKED',
  productNotFound: 'PRODUCT_NOT_FOUND',
  productNotDeletable: 'PRODUCT_NOT_DELETABLE',
  productImageNotFound: 'PRODUCT_IMAGE_NOT_FOUND',
  productImageLimitExceeded: 'PRODUCT_IMAGE_LIMIT_EXCEEDED',
  productImageDeletePending: 'PRODUCT_IMAGE_DELETE_PENDING',
  productPublishRequiresImage: 'PRODUCT_PUBLISH_REQUIRES_IMAGE',
  importFileRequired: 'IMPORT_FILE_REQUIRED',
  importFileTypeInvalid: 'IMPORT_FILE_TYPE_INVALID',
  importFileTooLarge: 'IMPORT_FILE_TOO_LARGE',
  importUploadNotFound: 'IMPORT_UPLOAD_NOT_FOUND',
  importUploadExpired: 'IMPORT_UPLOAD_EXPIRED',
  importUploadChunkInvalid: 'IMPORT_UPLOAD_CHUNK_INVALID',
  importUploadIncomplete: 'IMPORT_UPLOAD_INCOMPLETE',
  importUploadStateInvalid: 'IMPORT_UPLOAD_STATE_INVALID',
  importUploadCancelled: 'IMPORT_UPLOAD_CANCELLED',
  importProcessingFailed: 'IMPORT_PROCESSING_FAILED',
  importRowLimitExceeded: 'IMPORT_ROW_LIMIT_EXCEEDED',
  importWorksheetMissing: 'IMPORT_WORKSHEET_MISSING',
  importHeaderInvalid: 'IMPORT_HEADER_INVALID',
  importDuplicateHeader: 'IMPORT_DUPLICATE_HEADER',
  importFormulaNotAllowed: 'IMPORT_FORMULA_NOT_ALLOWED',
  importNoDataRows: 'IMPORT_NO_DATA_ROWS',
  importRequiredFieldMissing: 'IMPORT_REQUIRED_FIELD_MISSING',
  importFieldInvalid: 'IMPORT_FIELD_INVALID',
  importDuplicateSkuInFile: 'IMPORT_DUPLICATE_SKU_IN_FILE',
  importSkuAlreadyExists: 'IMPORT_SKU_ALREADY_EXISTS',
  importSlugDuplicate: 'IMPORT_SLUG_DUPLICATE',
  importCategoryInvalid: 'IMPORT_CATEGORY_INVALID',
  importStatusInvalid: 'IMPORT_STATUS_INVALID',
  importLifecycleInvalid: 'IMPORT_LIFECYCLE_INVALID',
  importTagInvalid: 'IMPORT_TAG_INVALID',
  importPricePermissionDenied: 'IMPORT_PRICE_PERMISSION_DENIED',
  importPublishReadinessFailed: 'IMPORT_PUBLISH_READINESS_FAILED',
  importImageInvalid: 'IMPORT_IMAGE_INVALID',
  importImageMappingInvalid: 'IMPORT_IMAGE_MAPPING_INVALID',
  importExternalLink: 'IMPORT_EXTERNAL_LINK',
  importValidationNotFound: 'IMPORT_VALIDATION_NOT_FOUND',
  importValidationExpired: 'IMPORT_VALIDATION_EXPIRED',
  importValidationConfigMismatch: 'IMPORT_VALIDATION_CONFIG_MISMATCH',
  importAlreadyConsumed: 'IMPORT_ALREADY_CONSUMED',
  importAtomicCommitFailed: 'IMPORT_ATOMIC_COMMIT_FAILED',
  /** The stored object is also referenced by another business entity. */
  assetInUse: 'ASSET_IN_USE',
  fileOperationNotFound: 'FILE_OPERATION_NOT_FOUND',
  fileOperationNotRetryable: 'FILE_OPERATION_NOT_RETRYABLE',
  storageUnavailable: 'STORAGE_UNAVAILABLE',
  customerPhoneConflict: 'CUSTOMER_PHONE_CONFLICT',
  customerPhoneInvalid: 'CUSTOMER_PHONE_INVALID',
  customerCountryRequired: 'CUSTOMER_COUNTRY_REQUIRED',
  uploadTypeNotAllowed: 'UPLOAD_TYPE_NOT_ALLOWED',
  uploadSignatureMismatch: 'UPLOAD_SIGNATURE_MISMATCH',
  uploadTooLarge: 'UPLOAD_TOO_LARGE',
  uploadPixelLimitExceeded: 'UPLOAD_PIXEL_LIMIT_EXCEEDED',
  uploadProcessingFailed: 'UPLOAD_PROCESSING_FAILED',
  uploadDirectUnavailable: 'UPLOAD_DIRECT_UNAVAILABLE',
  fileNotFound: 'FILE_NOT_FOUND',
  jobFailed: 'JOB_FAILED',
  jobNotFound: 'JOB_NOT_FOUND',
  jobAlreadyRunning: 'JOB_ALREADY_RUNNING',
  quoteTemplateInvalid: 'QUOTE_TEMPLATE_INVALID',
  quoteExportEmpty: 'QUOTE_EXPORT_EMPTY',
  quoteExportTooLarge: 'QUOTE_EXPORT_TOO_LARGE',
  quotationExportValidationFailed: 'QUOTATION_EXPORT_VALIDATION_FAILED',
  quotationExportPricingInvalid: 'QUOTATION_EXPORT_PRICING_INVALID',
  quotationExportImageUnavailable: 'QUOTATION_EXPORT_IMAGE_UNAVAILABLE',
  quotationExportImageSetTooLarge: 'QUOTATION_EXPORT_IMAGE_SET_TOO_LARGE',
  quotationExportSnapshotMissing: 'QUOTATION_EXPORT_SNAPSHOT_MISSING',
  quoteTemplateInUse: 'QUOTE_TEMPLATE_IN_USE',
  excelPdfDisabled: 'EXCEL_PDF_DISABLED',
  excelPdfUploadNotFound: 'EXCEL_PDF_UPLOAD_NOT_FOUND',
  excelPdfUploadExpired: 'EXCEL_PDF_UPLOAD_EXPIRED',
  excelPdfUploadChunkInvalid: 'EXCEL_PDF_UPLOAD_CHUNK_INVALID',
  excelPdfUploadIncomplete: 'EXCEL_PDF_UPLOAD_INCOMPLETE',
  excelPdfUploadStateInvalid: 'EXCEL_PDF_UPLOAD_STATE_INVALID',
  excelPdfFileTypeInvalid: 'EXCEL_PDF_FILE_TYPE_INVALID',
  excelPdfFileInvalid: 'EXCEL_PDF_FILE_INVALID',
  excelPdfMacroNotAllowed: 'EXCEL_PDF_MACRO_NOT_ALLOWED',
  excelPdfExternalLinkNotAllowed: 'EXCEL_PDF_EXTERNAL_LINK_NOT_ALLOWED',
  excelPdfPasswordProtected: 'EXCEL_PDF_PASSWORD_PROTECTED',
  excelPdfZipBomb: 'EXCEL_PDF_ZIP_BOMB',
  excelPdfJobNotFound: 'EXCEL_PDF_JOB_NOT_FOUND',
  excelPdfJobNotRetryable: 'EXCEL_PDF_JOB_NOT_RETRYABLE',
  excelPdfJobNotDownloadable: 'EXCEL_PDF_JOB_NOT_DOWNLOADABLE',
  excelPdfOutputInvalid: 'EXCEL_PDF_OUTPUT_INVALID',
  excelPdfConverterUnavailable: 'EXCEL_PDF_CONVERTER_UNAVAILABLE',
  excelPdfConversionTimeout: 'EXCEL_PDF_CONVERSION_TIMEOUT',
  excelPdfConversionInterrupted: 'EXCEL_PDF_CONVERSION_INTERRUPTED',
  excelPdfWorkspaceUnavailable: 'EXCEL_PDF_WORKSPACE_UNAVAILABLE',
  piNotEditable: 'PI_NOT_EDITABLE',
  piRevisionRequired: 'PI_REVISION_REQUIRED',
  piCurrencyMismatch: 'PI_CURRENCY_MISMATCH',
  orderConcurrentUpdate: 'ORDER_CONCURRENT_UPDATE',
  orderSnapshotUpdateForbidden: 'ORDER_SNAPSHOT_UPDATE_FORBIDDEN',
  commercialDocumentNotFound: 'COMMERCIAL_DOCUMENT_NOT_FOUND',
  commercialDocumentNotEditable: 'COMMERCIAL_DOCUMENT_NOT_EDITABLE',
  commercialDocumentMissingFields: 'COMMERCIAL_DOCUMENT_MISSING_FIELDS',
  commercialDocumentCurrencyMismatch: 'COMMERCIAL_DOCUMENT_CURRENCY_MISMATCH',
  commercialDocumentTemplateInvalid: 'COMMERCIAL_DOCUMENT_TEMPLATE_INVALID',
  commercialDocumentTemplateRequired: 'COMMERCIAL_DOCUMENT_TEMPLATE_REQUIRED',
  commercialDocumentTemplateInUse: 'COMMERCIAL_DOCUMENT_TEMPLATE_IN_USE',
  commercialDocumentPdfUnavailable: 'COMMERCIAL_DOCUMENT_PDF_UNAVAILABLE',
  commercialDocumentRenderFailed: 'COMMERCIAL_DOCUMENT_RENDER_FAILED',
  commercialDocumentConverterUnavailable: 'COMMERCIAL_DOCUMENT_CONVERTER_UNAVAILABLE',
  commercialDocumentConversionFailed: 'COMMERCIAL_DOCUMENT_CONVERSION_FAILED',
  commercialDocumentConversionTimeout: 'COMMERCIAL_DOCUMENT_CONVERSION_TIMEOUT',
  commercialDocumentPdfInfoUnavailable: 'COMMERCIAL_DOCUMENT_PDFINFO_UNAVAILABLE',
  commercialDocumentOutputInvalid: 'COMMERCIAL_DOCUMENT_OUTPUT_INVALID',
  commercialDocumentOutputTooLarge: 'COMMERCIAL_DOCUMENT_OUTPUT_TOO_LARGE',
  commercialDocumentOutputTooManyPages: 'COMMERCIAL_DOCUMENT_OUTPUT_TOO_MANY_PAGES',
  commercialDocumentStateConflict: 'COMMERCIAL_DOCUMENT_STATE_CONFLICT',
  commercialDocumentConcurrentUpdate: 'COMMERCIAL_DOCUMENT_CONCURRENT_UPDATE',
  commercialDocumentOrderMismatch: 'COMMERCIAL_DOCUMENT_ORDER_MISMATCH',
  documentTemplateNotPublished: 'DOCUMENT_TEMPLATE_NOT_PUBLISHED',
  documentTemplateTypeMismatch: 'DOCUMENT_TEMPLATE_TYPE_MISMATCH',
  documentTemplateNotFound: 'DOCUMENT_TEMPLATE_NOT_FOUND',
  documentTemplateNotDeletable: 'DOCUMENT_TEMPLATE_NOT_DELETABLE',
  documentTemplateInUse: 'DOCUMENT_TEMPLATE_IN_USE',
  documentTemplateNotActive: 'DOCUMENT_TEMPLATE_NOT_ACTIVE',
  documentTemplateLocaleMismatch: 'DOCUMENT_TEMPLATE_LOCALE_MISMATCH',
  companyProfileNotFound: 'COMPANY_PROFILE_NOT_FOUND',
  bankAccountNotFound: 'BANK_ACCOUNT_NOT_FOUND',
  bankAccountInUse: 'BANK_ACCOUNT_IN_USE',
  bankAccountCurrencyInvalid: 'BANK_ACCOUNT_CURRENCY_INVALID',
  bankAccountCountryInvalid: 'BANK_ACCOUNT_COUNTRY_INVALID',
  bankAccountCurrencyRequired: 'BANK_ACCOUNT_CURRENCY_REQUIRED',
  bankAccountCurrencyInUse: 'BANK_ACCOUNT_CURRENCY_IN_USE',
  bankAccountCurrencyMismatch: 'BANK_ACCOUNT_CURRENCY_MISMATCH',
  bankAccountDisabled: 'BANK_ACCOUNT_DISABLED',
  bankAccountDefaultConflict: 'BANK_ACCOUNT_DEFAULT_CONFLICT',
  bankAccountDefaultRequired: 'BANK_ACCOUNT_DEFAULT_REQUIRED',
  bankAccountMissing: 'BANK_ACCOUNT_MISSING',
  settingsSecretNotReadable: 'SETTINGS_SECRET_NOT_READABLE',
  lastSuperAdminProtected: 'LAST_SUPER_ADMIN_PROTECTED',
  usernameAlreadyExists: 'USERNAME_ALREADY_EXISTS',
  roleNotFound: 'ROLE_NOT_FOUND',
  roleNotAssignable: 'ROLE_NOT_ASSIGNABLE',
  roleSystemProtected: 'ROLE_SYSTEM_PROTECTED',
  roleInUse: 'ROLE_IN_USE',
  permissionCodeInvalid: 'PERMISSION_CODE_INVALID',
  permissionAssignmentForbidden: 'PERMISSION_ASSIGNMENT_FORBIDDEN',
  concurrentRoleUpdate: 'CONCURRENT_ROLE_UPDATE',
  menuCodeExists: 'MENU_CODE_EXISTS',
  menuRouteExists: 'MENU_ROUTE_EXISTS',
  menuRouteKindMismatch: 'MENU_TYPE_ROUTE_MISMATCH',
  menuParentInvalid: 'MENU_PARENT_INVALID',
  menuParentCycle: 'MENU_PARENT_CYCLE',
  menuDepthExceeded: 'MENU_DEPTH_EXCEEDED',
  menuHasChildren: 'MENU_HAS_CHILDREN',
  menuSystemProtected: 'MENU_SYSTEM_PROTECTED',
  menuIconInvalid: 'MENU_ICON_INVALID',
  menuModified: 'MENU_MODIFIED',
  menuTranslationMissing: 'MENU_TRANSLATION_MISSING',
  dictionaryCodeDuplicated: 'DICTIONARY_CODE_DUPLICATED',
  dictionaryItemInUse: 'DICTIONARY_ITEM_IN_USE',
  dictionaryTypeHasItems: 'DICTIONARY_TYPE_HAS_ITEMS',
  dictionaryTypeMismatch: 'DICTIONARY_TYPE_MISMATCH',
  settingKeyConflict: 'SETTING_KEY_CONFLICT',
  settingNotFound: 'SETTING_NOT_FOUND',
  settingSystemLocked: 'SETTING_SYSTEM_LOCKED',
  settingInUse: 'SETTING_IN_USE',
  settingValueInvalid: 'SETTING_VALUE_INVALID',
  settingSecretWriteOnly: 'SETTING_SECRET_WRITE_ONLY',
  settingRevisionConflict: 'SETTING_REVISION_CONFLICT',
  settingPublicSecretConflict: 'SETTING_PUBLIC_SECRET_CONFLICT',
  userModified: 'USER_MODIFIED',
  userNotFound: 'USER_NOT_FOUND',
  systemLocked: 'SYSTEM_LOCKED',
  storageError: 'STORAGE_ERROR',
  internalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Settings metadata (docs/21 §3.3, §5.4).
 *
 * `groupCode` is a management category, not an authorization scope: visibility
 * comes from `isPublic`, sensitivity from `isSecret`, and the server decides
 * editability/deletability from the system flags.
 */
export const SETTING_GROUPS = [
  'site_profile',
  'contact',
  'social',
  'inquiry',
  'seo',
  'analytics',
  'integrations',
  'custom',
] as const;
export type SettingGroupCode = (typeof SETTING_GROUPS)[number];

/**
 * Value types the settings form can render.
 *
 * The database keeps `value` as JSON; `valueType` is what makes the stored JSON
 * unambiguous and is validated server-side before anything is written.
 */
export const SETTING_VALUE_TYPES = [
  'string',
  'text',
  'number',
  'boolean',
  'url',
  'email',
  'phone',
  'select',
  'stringList',
  'objectList',
  'json',
] as const;
export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

/**
 * Icon names the back office can render for a menu (docs/19 §3.1).
 *
 * `MenuIcon` in `@b2b/ui` resolves these names; anything else falls back to a
 * generic list icon, so the API rejects unknown values instead of silently
 * storing an icon that never renders.
 */
export const MENU_ICON_NAMES = [
  'grid',
  'box',
  'tree',
  'tag',
  'image',
  'document',
  'chat',
  'chart',
  'file',
  'folder',
  'download',
  'swap',
  'invoice',
  'user',
  'shield',
  'menu',
  'book',
  'settings',
  'list',
] as const;

export type MenuIconName = (typeof MENU_ICON_NAMES)[number];

/**
 * Menus that make up the product's own navigation skeleton.
 *
 * They map 1:1 to the routes, API permissions and seeded translations of the
 * back office, so deleting one would break navigation and any role grant that
 * points at it. `database/prisma/seed.ts` asserts that every seeded menu code
 * appears here, which keeps the two lists from drifting (docs/19 §4.5, §8.1).
 */
export const PROTECTED_MENU_CODES: readonly string[] = [
  'workspace',
  'dashboard',
  'catalog',
  'products',
  'products.bulk-import',
  'products.quotation-export',
  'quotation-calculator',
  'quotations',
  'orders',
  'categories',
  'tags',
  'leads-analytics',
  'customers',
  'analytics',
  'quotes-files',
  'quote-templates',
  'quote-exports',
  'excel-pdf',
  'pi-documents',
  'commercial-documents',
  'document-templates',
  'company-profile',
  'content-management',
  'ads',
  'content',
  'content.factory-media',
  'content.factory-process',
  'content.credentials',
  'content.home-sections',
  'administration',
  'users',
  'roles',
  'menus',
  'dictionary',
  'settings',
  'audit-logs',
];

/** Maximum menu nesting depth, counting a root menu as level 1 (docs/19 §5.3). */
export const MENU_MAX_DEPTH = 5;

/**
 * Dictionary type codes the application itself depends on (docs/20 §4).
 *
 * Keep these stable: they are query keys for the shared option endpoint, while
 * `DictionaryItem.code` stays the stable business value inside a type.
 */
export const DICTIONARY_TYPES = {
  productLifecycle: 'product_lifecycle',
  productPublishStatus: 'publish_status',
  inquirySource: 'inquiry_source',
  adPlacement: 'ad_placement',
  paymentTerms: 'payment_terms',
  packagingType: 'packaging_type',
  credentialType: 'credential_type',
  currency: 'currency',
  country: 'country',
  volumetricWeightDivisor: 'volumetric_weight_divisor',
  quotationFeeType: 'quotation_fee_type',
} as const;

export type DictionaryTypeCode = (typeof DICTIONARY_TYPES)[keyof typeof DICTIONARY_TYPES];

/**
 * Types whose items drive application behaviour, not just display.
 *
 * Product status feeds publish/storefront filtering, ad placement is matched by
 * the storefront renderer and inquiry source drives analytics classification, so
 * normal administrators may edit labels, order and enablement but must not add
 * or remove items (docs/20 §7.4, §14.4).
 */
export const SYSTEM_LOCKED_DICTIONARY_TYPES: readonly string[] = [
  DICTIONARY_TYPES.productLifecycle,
  DICTIONARY_TYPES.productPublishStatus,
  DICTIONARY_TYPES.inquirySource,
  DICTIONARY_TYPES.adPlacement,
  DICTIONARY_TYPES.currency,
  DICTIONARY_TYPES.country,
  DICTIONARY_TYPES.volumetricWeightDivisor,
];

/** Locale fallback chain for dictionary labels: requested → en-US → zh-CN → code. */
export const DICTIONARY_LABEL_FALLBACKS: readonly SupportedLocale[] = ['en-US', 'zh-CN'];

export const AD_PLACEMENTS = ['home-hero', 'catalog-top', 'sidebar'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export const CONTENT_PAGE_TYPES = ['about', 'contact', 'custom'] as const;
export type ContentPageType = (typeof CONTENT_PAGE_TYPES)[number];

export const QUOTE_TEMPLATE_TYPES = ['product_quote', 'pi', 'calculator_quote'] as const;
export type QuoteTemplateType = (typeof QUOTE_TEMPLATE_TYPES)[number];

/** Stable currency code sourced from the enabled `dictionary.currency` items. */
export type QuotationExportCurrency = string;

export const QUOTATION_EXPORT_LIMITS = {
  maxProducts: 200,
  maxImageBytes: 10 * 1024 * 1024,
  // The product-quote template export has produced legitimate source image
  // sets above 40 MiB in production. Keep its higher cap isolated from the
  // calculator/order snapshot export cap below.
  // Product quote work now runs on the isolated, serial Worker (4 GiB in the
  // production compose profile). Leave headroom for ExcelJS and ZIP buffers.
  maxProductQuoteTotalImageBytes: 256 * 1024 * 1024,
  maxTotalImageBytes: 40 * 1024 * 1024,
  imageReadConcurrency: 4,
  maxImagePixels: 20_000_000,
} as const;

export const PI_STATUSES = ['draft', 'review', 'issued', 'superseded', 'cancelled'] as const;
export type PiStatus = (typeof PI_STATUSES)[number];

export const INQUIRY_SOURCES = ['manual', 'website_click', 'whatsapp_webhook'] as const;
export type InquirySource = (typeof INQUIRY_SOURCES)[number];

/** Upload allow-lists. SVG stays rejected until a sanitisation pipeline exists (docs/11 §3). */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
] as const;
export const ALLOWED_UPLOAD_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  excel: ['.xlsx'],
} as const;
