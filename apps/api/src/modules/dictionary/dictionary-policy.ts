import {
  DICTIONARY_LABEL_FALLBACKS,
  ERROR_CODES,
  SYSTEM_LOCKED_DICTIONARY_TYPES,
} from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

// Pure policy for the two-level dictionary (docs/20 §5.6, §7).
//
// `DictionaryType.code` is the one-level query key and `DictionaryItem.code` is
// the stable business value inside it; labels are display-only. The service
// supplies database facts and runs these guards inside the write transaction.

export interface DictionaryTypeRef {
  id: string;
  code: string;
  systemLocked: boolean;
  enabled: boolean;
}

export interface DictionaryItemRef {
  id: string;
  typeId: string;
  code: string;
  enabled: boolean;
  systemLocked: boolean;
}

/** Types whose item codes drive behaviour and therefore may not be restructured. */
export function isBehaviourLockedType(typeCode: string): boolean {
  return SYSTEM_LOCKED_DICTIONARY_TYPES.includes(typeCode);
}

/**
 * Resolves a label with the shared fallback chain (docs/20 §9.3):
 * requested locale → en-US → zh-CN → the stable code. Never returns an empty
 * string, so a select can never render a blank option.
 */
export function resolveLabel(
  labels: Record<string, string | undefined>,
  locale: string,
): string | null {
  const direct = labels[locale];
  if (direct && direct.trim().length > 0) return direct;
  for (const fallback of DICTIONARY_LABEL_FALLBACKS) {
    const value = labels[fallback];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

export interface LabeledItem {
  id: string;
  code: string;
  value: string | null;
  sortOrder: number;
  enabled: boolean;
  labels: Record<string, string>;
}

/**
 * Maps items to selectable options, sorted by the documented stable order
 * (`sortOrder`, then code) and never blank-labeled (docs/20 §3.3).
 */
export function toOptions(
  items: LabeledItem[],
  locale: string,
): { id: string; code: string; label: string; value: string | null; sortOrder: number; enabled: boolean }[] {
  return [...items]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code))
    .map((item) => ({
      id: item.id,
      code: item.code,
      label: resolveLabel(item.labels, locale) ?? item.code,
      value: item.value,
      sortOrder: item.sortOrder,
      enabled: item.enabled,
    }));
}

/**
 * A locked type or item is protected from deletion and from being disabled or
 * re-enabled by ordinary administrators (docs/20 §5.6, §14.5).
 */
export function assertNotSystemLocked(
  subject: { systemLocked: boolean; code: string },
  action: 'delete' | 'disable' | 'edit-code' | 'restructure',
): void {
  if (!subject.systemLocked) return;
  const reason =
    action === 'delete'
      ? 'System dictionary entries cannot be deleted.'
      : action === 'disable'
        ? 'System dictionary entries cannot be disabled.'
        : action === 'restructure'
          ? 'Items of this dictionary type drive application behaviour and cannot be added or removed.'
          : 'System dictionary codes cannot be renamed.';
  throw new ApiError(ERROR_CODES.systemLocked, reason, {
    status: 409,
    details: { code: subject.code, action },
  });
}

/**
 * Behaviour-driving types keep a fixed item set: labels, order and translations
 * stay editable, but adding or removing codes would change what the application
 * understands without any workflow设计 (docs/20 §7.4, §14.4).
 */
export function assertItemMutationAllowed(params: {
  typeCode: string;
  typeSystemLocked: boolean;
  action: 'create' | 'delete';
}): void {
  if (!params.typeSystemLocked && !isBehaviourLockedType(params.typeCode)) return;
  throw new ApiError(
    ERROR_CODES.systemLocked,
    'This dictionary type drives application behaviour, so its item set is fixed. Edit labels, order or enablement instead.',
    { status: 409, details: { typeCode: params.typeCode, action: params.action } },
  );
}

export function assertTypeIsDeletable(params: {
  type: DictionaryTypeRef;
  itemCount: number;
  references: number;
}): void {
  assertNotSystemLocked(params.type, 'delete');
  if (params.itemCount > 0) {
    throw new ApiError(ERROR_CODES.dictionaryTypeHasItems, 'This dictionary type still has items.', {
      status: 409,
      details: { itemCount: params.itemCount },
    });
  }
  if (params.references > 0) {
    throw new ApiError(ERROR_CODES.dictionaryItemInUse, 'This dictionary type is still referenced.', {
      status: 409,
      details: { usageCount: params.references },
    });
  }
}

/**
 * An item that business rows reference cannot be physically deleted; disabling
 * it keeps historical records readable while removing it from new selections
 * (docs/20 §5.6, §7.5).
 */
export function assertItemIsDeletable(params: {
  item: DictionaryItemRef;
  typeCode: string;
  usageCount: number;
}): void {
  assertNotSystemLocked(params.item, 'delete');
  if (params.usageCount > 0) {
    throw new ApiError(ERROR_CODES.dictionaryItemInUse, 'This dictionary item is still referenced.', {
      status: 409,
      details: { usageCount: params.usageCount, typeCode: params.typeCode, code: params.item.code },
    });
  }
}

/**
 * Guards the "wrong type" failure mode: a publish-status item must never be
 * accepted where a lifecycle-status item is expected, even though both exist in
 * the same table (docs/20 §7.4, §11.1 DIC-010).
 */
export function assertItemBelongsToType(params: {
  expectedTypeCode: string;
  actualTypeCode: string;
  itemCode: string;
  status?: number;
}): void {
  if (params.expectedTypeCode === params.actualTypeCode) return;
  throw new ApiError(
    ERROR_CODES.dictionaryTypeMismatch,
    `Item ${params.itemCode} belongs to ${params.actualTypeCode}, not ${params.expectedTypeCode}.`,
    {
      status: params.status ?? 422,
      details: {
        expectedTypeCode: params.expectedTypeCode,
        actualTypeCode: params.actualTypeCode,
        itemCode: params.itemCode,
      },
    },
  );
}

/** Reorder requests must describe the complete item set of one type. */
export function assertReorderIsComplete(params: {
  orderedIds: string[];
  itemIds: string[];
}): void {
  const requested = new Set(params.orderedIds);
  const items = new Set(params.itemIds);
  const missing = params.itemIds.filter((id) => !requested.has(id));
  const unknown = params.orderedIds.filter((id) => !items.has(id));
  if (missing.length > 0 || unknown.length > 0 || requested.size !== params.orderedIds.length) {
    throw ApiError.validation('The reorder request must list every item of the type exactly once.', {
      missing: missing.join(','),
      unknown: unknown.join(','),
    });
  }
}

/** Items are renumbered in steps of 10 so a manual insert has room. */
export const DICTIONARY_REORDER_STEP = 10;

/**
 * Optimistic concurrency guard for item edits: two administrators editing the
 * same item must not silently overwrite each other (docs/20 §10).
 */
export function assertExpectedUpdatedAt(expected: string | undefined, actual: Date): void {
  if (!expected) return;
  const expectedTime = Date.parse(expected);
  if (Number.isNaN(expectedTime)) {
    throw ApiError.validation('The concurrency token is not a valid timestamp.');
  }
  if (expectedTime !== actual.getTime()) {
    throw new ApiError(
      ERROR_CODES.conflict,
      'This dictionary entry was changed by another administrator. Reload and try again.',
      { status: 409, details: { updatedAt: actual.toISOString() } },
    );
  }
}
