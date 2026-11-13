import { ApiError } from '../../common/errors/api-error';

/** Performance batch size only; configured display totals are not capped at 24. */
export const HOMEPAGE_PRODUCT_BATCH_SIZE = 24;

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 1024;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface NewArrivalsCursor {
  version: typeof CURSOR_VERSION;
  kind: 'new-arrivals';
  configuredLimit: number;
  returned: number;
  afterSortOrder: number;
  afterSku: string;
}

export interface CollectionCursor {
  version: typeof CURSOR_VERSION;
  kind: 'collection';
  collectionId: string;
  collectionUpdatedAt: string;
  productLimit: number;
  returned: number;
  afterSortOrder: number;
  afterId: string;
}

type HomepageCursor = NewArrivalsCursor | CollectionCursor;

export function homepageCursorInvalid(): ApiError {
  return ApiError.validation('The homepage cursor is invalid or stale.', {
    cursor: 'validation.homepage.cursor.invalid',
  });
}

export function encodeHomepageCursor(cursor: HomepageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeNewArrivalsCursor(raw: string | undefined): NewArrivalsCursor | null {
  if (!raw) return null;
  const value = decodeCursor(raw);
  if (value.kind !== 'new-arrivals' || value.version !== CURSOR_VERSION) {
    throw homepageCursorInvalid();
  }

  const configuredLimit = positiveInteger(value.configuredLimit);
  const returned = nonNegativeInteger(value.returned);
  const afterSortOrder = integer(value.afterSortOrder);
  const afterSku = shortString(value.afterSku, 64);
  if (returned > configuredLimit) throw homepageCursorInvalid();

  return {
    version: CURSOR_VERSION,
    kind: 'new-arrivals',
    configuredLimit,
    returned,
    afterSortOrder,
    afterSku,
  };
}

export function decodeCollectionCursor(raw: string | undefined): CollectionCursor | null {
  if (!raw) return null;
  const value = decodeCursor(raw);
  if (value.kind !== 'collection' || value.version !== CURSOR_VERSION) {
    throw homepageCursorInvalid();
  }

  const collectionId = uuid(value.collectionId);
  const collectionUpdatedAt = isoDate(value.collectionUpdatedAt);
  const productLimit = positiveInteger(value.productLimit);
  const returned = nonNegativeInteger(value.returned);
  const afterSortOrder = integer(value.afterSortOrder);
  const afterId = uuid(value.afterId);
  if (returned > productLimit) throw homepageCursorInvalid();

  return {
    version: CURSOR_VERSION,
    kind: 'collection',
    collectionId,
    collectionUpdatedAt,
    productLimit,
    returned,
    afterSortOrder,
    afterId,
  };
}

function decodeCursor(raw: string): Record<string, unknown> {
  if (raw.length > MAX_CURSOR_LENGTH || !CURSOR_PATTERN.test(raw)) {
    throw homepageCursorInvalid();
  }
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (!isRecord(parsed)) throw homepageCursorInvalid();
    return parsed;
  } catch {
    throw homepageCursorInvalid();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw homepageCursorInvalid();
  return value;
}

function positiveInteger(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 1) throw homepageCursorInvalid();
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 0) throw homepageCursorInvalid();
  return parsed;
}

function shortString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    throw homepageCursorInvalid();
  }
  return value;
}

function uuid(value: unknown): string {
  const parsed = shortString(value, 36);
  if (!UUID_PATTERN.test(parsed)) throw homepageCursorInvalid();
  return parsed;
}

function isoDate(value: unknown): string {
  const parsed = shortString(value, 40);
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp)) throw homepageCursorInvalid();
  return parsed;
}
