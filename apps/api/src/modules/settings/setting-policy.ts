import { ERROR_CODES, SETTING_GROUPS, SETTING_VALUE_TYPES } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

// Pure policy for global settings (docs/21 §4, §7).
//
// Kept free of Prisma so every rule can be unit tested directly: the service
// supplies the stored row and the registry definition, and these guards decide
// whether the requested change is allowed at all.

export interface SettingRowRef {
  key: string;
  isPublic: boolean;
  isSecret: boolean;
  isSystem: boolean;
  isEditable: boolean;
  isDeletable: boolean;
  valueType: string;
  revision: number;
}

export const SETTING_GROUP_CODES: readonly string[] = SETTING_GROUPS;
export const SETTING_TYPE_CODES: readonly string[] = SETTING_VALUE_TYPES;

export function assertGroupAndTypeAreValid(groupCode: string, valueType: string): void {
  if (!SETTING_GROUP_CODES.includes(groupCode)) {
    throw new ApiError(ERROR_CODES.settingValueInvalid, `Unknown setting group ${groupCode}.`, {
      status: 400,
      details: { groupCode },
    });
  }
  if (!SETTING_TYPE_CODES.includes(valueType)) {
    throw new ApiError(ERROR_CODES.settingValueInvalid, `Unknown setting value type ${valueType}.`, {
      status: 400,
      details: { valueType },
    });
  }
}

/**
 * Public and secret are mutually exclusive: a secret can never be exposed by the
 * public config projection (docs/21 §7.4).
 */
export function assertVisibilityIsConsistent(isPublic: boolean, isSecret: boolean): void {
  if (isPublic && isSecret) {
    throw new ApiError(ERROR_CODES.settingPublicSecretConflict, 'A secret setting cannot be public.', {
      status: 409,
      details: { isPublic, isSecret },
    });
  }
}

/**
 * Built-in settings keep their key, group, type and system flags; only value,
 * labels and ordering are editable through the ordinary flow (docs/21 §4.2).
 */
export function assertMetadataChangeIsAllowed(
  row: SettingRowRef,
  change: { groupCode?: string; valueType?: string; isSecret?: boolean },
): void {
  if (row.isSystem) {
    if (change.groupCode !== undefined || change.valueType !== undefined) {
      // Group/type of a built-in key is owned by the registry + seed.
      throw new ApiError(
        ERROR_CODES.settingSystemLocked,
        'The group and type of a system setting are controlled by the application.',
        { status: 409, details: { key: row.key } },
      );
    }
  }
  if (change.isSecret === false && row.isSecret) {
    throw new ApiError(
      ERROR_CODES.settingSystemLocked,
      'A setting cannot be unlocked from secret mode here; delete and recreate it instead.',
      { status: 409, details: { key: row.key } },
    );
  }
}

export function assertSettingIsEditable(row: SettingRowRef): void {
  if (!row.isEditable) {
    throw new ApiError(ERROR_CODES.settingSystemLocked, 'This setting is not editable.', {
      status: 409,
      details: { key: row.key },
    });
  }
}

/**
 * Deletion is restricted to custom, deletable row that no code reads. Built-in
 * keys are read by the application, so they are never deletable (docs/21 §4.3).
 */
export function assertSettingIsDeletable(row: SettingRowRef, referencedByCode: boolean): void {
  if (row.isSystem || referencedByCode) {
    throw new ApiError(
      ERROR_CODES.settingInUse,
      'This setting is read by the application and cannot be deleted.',
      { status: 409, details: { key: row.key } },
    );
  }
  if (!row.isDeletable) {
    throw new ApiError(ERROR_CODES.settingSystemLocked, 'This setting is marked as not deletable.', {
      status: 409,
      details: { key: row.key },
    });
  }
}

export function assertRevisionMatches(expected: number | undefined, actual: number): void {
  if (expected === undefined) return;
  if (expected !== actual) {
    throw new ApiError(
      ERROR_CODES.settingRevisionConflict,
      'This setting was changed by another administrator. Reload it and try again.',
      { status: 409, details: { currentRevision: actual } },
    );
  }
}

export interface ValueValidationResult {
  value: unknown;
}

/**
 * Type-safe value normalisation (docs/21 §5.4).
 *
 * The stored column is JSON, so `valueType` is what keeps it unambiguous; the
 * client control is never the boundary.
 */
export function normalizeSettingValue(
  key: string,
  valueType: string,
  value: unknown,
  options?: unknown,
  normalizeWhatsAppNumber?: (raw: string | null) => string | null,
): ValueValidationResult {
  const invalid = (details: Record<string, unknown> = {}): never => {
    throw new ApiError(ERROR_CODES.settingValueInvalid, 'The value does not match the setting type.', {
      status: 400,
      details: { key, valueType, ...details },
    });
  };

  switch (valueType) {
    case 'number': {
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
      if (!Number.isFinite(parsed)) return invalid({ reason: 'not-a-number' });
      return { value: parsed };
    }
    case 'boolean':
      return { value: value === true || value === 'true' };
    case 'email': {
      const text = String(value ?? '').trim();
      if (text.length === 0) return { value: null };
      if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(text)) return invalid({ reason: 'email' });
      return { value: text };
    }
    case 'url': {
      const text = String(value ?? '').trim();
      if (text.length === 0) return { value: null };
      try {
        const url = new URL(text);
        if (!['https:', 'mailto:'].includes(url.protocol)) return invalid({ reason: 'protocol' });
      } catch {
        return invalid({ reason: 'protocol' });
      }
      return { value: text };
    }
    case 'phone': {
      const text = String(value ?? '').trim();
      if (text.length === 0) return { value: null };
      if (key === 'site.whatsappNumber' && normalizeWhatsAppNumber) {
        const normalized = normalizeWhatsAppNumber(text);
        if (!normalized) return invalid({ reason: 'whatsapp-format' });
        return { value: normalized };
      }
      if (!/^[+()\d\s.-]{4,32}$/.test(text)) return invalid({ reason: 'phone' });
      return { value: text };
    }
    case 'select': {
      const text = String(value ?? '').trim();
      if (text.length === 0) return { value: null };
      const allowed = Array.isArray(options) ? options.map((option) => String(option)) : [];
      if (allowed.length > 0 && !allowed.includes(text)) return invalid({ reason: 'option', allowed });
      return { value: text };
    }
    case 'stringList': {
      if (Array.isArray(value)) return { value: value.map((item) => String(item)) };
      return {
        value: String(value ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      };
    }
    case 'objectList': {
      if (!Array.isArray(value)) return { value: [] };
      return {
        value: value
          .filter((item): item is { label?: unknown; url?: unknown } => typeof item === 'object' && item !== null)
          .map((item) => ({ label: String(item.label ?? '').slice(0, 120), url: String(item.url ?? '') }))
          .filter((item) => item.label.length > 0),
      };
    }
    case 'json': {
      if (typeof value === 'string') {
        const text = value.trim();
        if (text.length === 0) return { value: null };
        try {
          return { value: JSON.parse(text) as unknown };
        } catch {
          return invalid({ reason: 'json' });
        }
      }
      if (typeof value === 'object') return { value };
      return invalid({ reason: 'json' });
    }
    case 'text':
    case 'string':
    default: {
      const text = String(value ?? '').trim();
      return { value: text.length === 0 ? null : text };
    }
  }
}

/**
 * A safe, non-reversible preview for the list view. Secrets never get one.
 */
export function valuePreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value === 'object') return 'JSON';
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * A value type change must be lossless: the current value has to survive being
 * read under the new type, otherwise the request is refused (docs/21 §4.2).
 */
export function assertTypeChangeIsLossless(
  nextType: string,
  currentValue: unknown,
  normalize: (valueType: string, value: unknown) => unknown,
): void {
  if (nextType === 'json') return;
  try {
    normalize(nextType, currentValue);
  } catch {
    throw new ApiError(
      ERROR_CODES.settingValueInvalid,
      'The current value cannot be represented by the new type. Update the value first.',
      { status: 400, details: { valueType: nextType } },
    );
  }
}
