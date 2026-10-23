import { ERROR_CODES, type ErrorCode } from '@b2b/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorOptions {
  status?: number;
  details?: Record<string, unknown>;
}

const DEFAULT_STATUS: Record<string, number> = {
  [ERROR_CODES.validationFailed]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.unauthorized]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.authInvalidCredentials]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.authAccountDisabled]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.authAccountLocked]: HttpStatus.LOCKED,
  [ERROR_CODES.authSessionExpired]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.authPasswordChangeRequired]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.authCurrentPasswordInvalid]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.forbidden]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.notFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.conflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.rateLimited]: HttpStatus.TOO_MANY_REQUESTS,
  [ERROR_CODES.payloadTooLarge]: HttpStatus.PAYLOAD_TOO_LARGE,
  // RBAC + menu management (docs/18, docs/19). Keep this table complete: an
  // unmapped business code would silently surface as HTTP 400.
  [ERROR_CODES.roleNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.roleNotAssignable]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.roleSystemProtected]: HttpStatus.CONFLICT,
  [ERROR_CODES.roleInUse]: HttpStatus.CONFLICT,
  [ERROR_CODES.concurrentRoleUpdate]: HttpStatus.CONFLICT,
  [ERROR_CODES.permissionCodeInvalid]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.permissionAssignmentForbidden]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.menuCodeExists]: HttpStatus.CONFLICT,
  [ERROR_CODES.menuRouteExists]: HttpStatus.CONFLICT,
  [ERROR_CODES.menuRouteKindMismatch]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.menuParentInvalid]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.menuParentCycle]: HttpStatus.CONFLICT,
  [ERROR_CODES.menuDepthExceeded]: HttpStatus.CONFLICT,
  [ERROR_CODES.menuHasChildren]: HttpStatus.CONFLICT,
  [ERROR_CODES.menuSystemProtected]: HttpStatus.CONFLICT,
  [ERROR_CODES.menuIconInvalid]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.menuModified]: HttpStatus.CONFLICT,
  [ERROR_CODES.menuTranslationMissing]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.settingKeyConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.settingSystemLocked]: HttpStatus.CONFLICT,
  [ERROR_CODES.settingInUse]: HttpStatus.CONFLICT,
  [ERROR_CODES.settingRevisionConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.settingPublicSecretConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.settingValueInvalid]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.settingSecretWriteOnly]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.settingNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.categoryCodeConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.categorySlugConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.categoryParentInvalid]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.categoryCycleDetected]: HttpStatus.CONFLICT,
  [ERROR_CODES.categoryDepthExceeded]: HttpStatus.CONFLICT,
  [ERROR_CODES.categoryHasChildren]: HttpStatus.CONFLICT,
  [ERROR_CODES.categoryHasProducts]: HttpStatus.CONFLICT,
  [ERROR_CODES.categoryConcurrentUpdate]: HttpStatus.CONFLICT,
  // Products and the image gallery (docs/24 §6.3). Every new business code
  // belongs in this table: an unmapped code would silently surface as HTTP 400
  // and hide the difference between "invalid input" and "conflict"/"not found".
  [ERROR_CODES.productSkuConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.productSlugConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.productSlugSuggestionConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.productSlugLocked]: HttpStatus.CONFLICT,
  [ERROR_CODES.productNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.productNotDeletable]: HttpStatus.CONFLICT,
  [ERROR_CODES.productImageNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.productImageLimitExceeded]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODES.productImageDeletePending]: HttpStatus.CONFLICT,
  [ERROR_CODES.productPublishRequiresImage]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODES.assetInUse]: HttpStatus.CONFLICT,
  [ERROR_CODES.fileOperationNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.fileOperationNotRetryable]: HttpStatus.CONFLICT,
  [ERROR_CODES.fileNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.uploadProcessingFailed]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODES.uploadDirectUnavailable]: HttpStatus.CONFLICT,
  [ERROR_CODES.quoteExportTooLarge]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODES.storageUnavailable]: HttpStatus.SERVICE_UNAVAILABLE,
  [ERROR_CODES.tagCodeConflict]: HttpStatus.CONFLICT,
  [ERROR_CODES.tagInUse]: HttpStatus.CONFLICT,
  [ERROR_CODES.tagNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.tagColorTokenInvalid]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.tagTranslationMissing]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.tagConcurrentUpdate]: HttpStatus.CONFLICT,
  [ERROR_CODES.dictionaryCodeDuplicated]: HttpStatus.CONFLICT,
  [ERROR_CODES.dictionaryItemInUse]: HttpStatus.CONFLICT,
  [ERROR_CODES.dictionaryTypeHasItems]: HttpStatus.CONFLICT,
  [ERROR_CODES.dictionaryTypeMismatch]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODES.systemLocked]: HttpStatus.CONFLICT,
  [ERROR_CODES.lastSuperAdminProtected]: HttpStatus.CONFLICT,
  [ERROR_CODES.usernameAlreadyExists]: HttpStatus.CONFLICT,
  [ERROR_CODES.userModified]: HttpStatus.CONFLICT,
  [ERROR_CODES.userNotFound]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.storageError]: HttpStatus.BAD_GATEWAY,
  [ERROR_CODES.internalError]: HttpStatus.INTERNAL_SERVER_ERROR,
};

// Carries a stable machine code to the HTTP layer. The message here is a
// developer-facing fallback; UIs translate `code` (docs/05 §5).
export class ApiError extends HttpException {
  readonly code: ErrorCode | string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode | string, message: string, options: ApiErrorOptions = {}) {
    const status = options.status ?? DEFAULT_STATUS[code] ?? HttpStatus.BAD_REQUEST;
    super({ code, message, details: options.details }, status);
    this.code = code;
    this.details = options.details;
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(ERROR_CODES.notFound, message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(ERROR_CODES.forbidden, message);
  }

  static conflict(code: ErrorCode | string, message: string): ApiError {
    return new ApiError(code, message);
  }

  static validation(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(ERROR_CODES.validationFailed, message, { details });
  }
}
