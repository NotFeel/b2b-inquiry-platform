import { PRODUCT_IMAGE_LIMITS, SUPPORTED_LOCALES } from '@b2b/contracts';
import type { ProductAdminDetail, ProductLifecycleStatus, PublishStatus } from '@b2b/contracts';
import type {
  CreateProductPayload,
  ProductTranslationPayload,
  ProductWritePayload,
} from './products-api';

// Product editor state and its mapping to the API payload (docs/24 §3.3).
//
// Pure functions on purpose: every unit rule ("each dimension has its own label
// and unit", "English content is required", "a dimension cannot be negative") is
// testable without a browser, and the server re-validates all of it anyway.
//
// Numeric fields are held as strings so an empty input stays empty instead of
// silently becoming 0, and so a malformed value is reported to the operator
// rather than sent as NaN.

export interface ProductSpecFormState {
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightGrams: string;
  packaging: string;
  cartonLengthCm: string;
  cartonWidthCm: string;
  cartonHeightCm: string;
  cartonWeightKg: string;
  cartonQuantity: string;
}

export interface ProductTranslationFormState {
  name: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
}

export interface ProductFormState {
  sku: string;
  slug: string;
  categoryId: string | null;
  publishStatus: PublishStatus;
  lifecycleStatus: ProductLifecycleStatus;
  sortOrder: string;
  priceCny: string;
  tagIds: string[];
  specs: ProductSpecFormState;
  translations: Record<string, ProductTranslationFormState>;
}

export type ProductFormErrors = Record<string, string>;

const ENGLISH = 'en-US';

export function emptyProductForm(): ProductFormState {
  return {
    sku: '',
    slug: '',
    categoryId: null,
    publishStatus: 'draft',
    lifecycleStatus: 'available',
    sortOrder: '0',
    priceCny: '',
    tagIds: [],
    specs: {
      lengthCm: '',
      widthCm: '',
      heightCm: '',
      weightGrams: '',
      packaging: '',
      cartonLengthCm: '',
      cartonWidthCm: '',
      cartonHeightCm: '',
      cartonWeightKg: '',
      cartonQuantity: '',
    },
    translations: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        { name: '', description: '', seoTitle: '', seoDescription: '' },
      ]),
    ),
  };
}

export function fromProductDetail(detail: ProductAdminDetail): ProductFormState {
  const base = emptyProductForm();
  return {
    ...base,
    sku: detail.sku,
    slug: detail.slug,
    categoryId: detail.categoryId,
    publishStatus: detail.publishStatus,
    lifecycleStatus: detail.lifecycleStatus,
    sortOrder: String(detail.sortOrder),
    priceCny: detail.priceVisible ? (detail.priceCny ?? '') : '',
    tagIds: detail.tagIds,
    specs: {
      // Product dimensions are entered and displayed in centimetres. The
      // existing database columns stay canonical millimetres (Int), so the
      // conversion happens only at this boundary and historical values keep
      // their meaning.
      lengthCm: millimetresToCentimetresInput(detail.lengthMm),
      widthCm: millimetresToCentimetresInput(detail.widthMm),
      heightCm: millimetresToCentimetresInput(detail.heightMm),
      weightGrams: numberToInput(detail.weightGrams),
      packaging: detail.packaging ?? '',
      cartonLengthCm: numberToInput(detail.cartonLengthCm),
      cartonWidthCm: numberToInput(detail.cartonWidthCm),
      cartonHeightCm: numberToInput(detail.cartonHeightCm),
      cartonWeightKg: detail.cartonWeightKg ?? '',
      cartonQuantity: numberToInput(detail.cartonQuantity),
    },
    translations: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => {
        const stored = detail.translations[locale];
        return [
          locale,
          {
            name: stored?.name ?? '',
            description: stored?.description ?? '',
            seoTitle: stored?.seoTitle ?? '',
            seoDescription: stored?.seoDescription ?? '',
          },
        ];
      }),
    ),
  };
}

function numberToInput(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Applies a lifecycle change and keeps the home pre-order flag consistent.
 *
 * Moving a product out of the pre-order lifecycle clears the home-page flag in
 * the same edit, so the form never submits a combination the server rejects.
 * Moving *into* pre-order does not tick the flag automatically: appearing on
 * the home page stays an explicit operator decision.
 */
export function applyLifecycleChange(
  state: ProductFormState,
  lifecycleStatus: ProductLifecycleStatus,
): ProductFormState {
  return {
    ...state,
    lifecycleStatus,
  };
}

/**
 * Client-side validation.
 *
 * This exists to give immediate feedback, never to be the control: every rule is
 * enforced again by the API, and the form maps server field errors onto the same
 * keys so the two cannot disagree silently.
 */
export function validateProductForm(
  state: ProductFormState,
  options: { mode: 'create' | 'edit' },
): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (options.mode === 'create' && state.sku.trim().length === 0) {
    errors.sku = 'products.validation.skuRequired';
  }
  if (state.slug.trim().length === 0) {
    errors.slug = 'products.validation.slugRequired';
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.slug.trim())) {
    errors.slug = 'products.validation.slugFormat';
  }
  if (!state.categoryId) {
    errors.categoryId = 'products.validation.categoryRequired';
  }
  if (state.translations[ENGLISH]?.name.trim().length === 0) {
    errors['translations.en-US.name'] = 'products.validation.englishNameRequired';
  }

  const centimetreFields: [keyof ProductSpecFormState, string][] = [
    ['lengthCm', 'products.validation.length'],
    ['widthCm', 'products.validation.width'],
    ['heightCm', 'products.validation.height'],
  ];
  for (const [field, message] of centimetreFields) {
    const value = state.specs[field];
    if (value === '') continue;
    // One decimal gives millimetre precision after conversion to the stored
    // Int millimetre column.
    if (!/^\d+(\.\d)?$/.test(value.trim()) || Number(value) <= 0) {
      errors[`specs.${field}`] = message;
    }
  }

  const numberFields: [keyof ProductSpecFormState, string][] = [
    ['weightGrams', 'products.validation.weight'],
    ['cartonLengthCm', 'products.validation.cartonLength'],
    ['cartonWidthCm', 'products.validation.cartonWidth'],
    ['cartonHeightCm', 'products.validation.cartonHeight'],
    ['cartonQuantity', 'products.validation.cartonQuantity'],
  ];
  for (const [field, message] of numberFields) {
    const value = state.specs[field];
    if (value === '') continue;
    if (!/^\d+$/.test(value.trim()) || Number(value) <= 0) errors[`specs.${field}`] = message;
  }
  if (state.specs.cartonWeightKg !== '') {
    const value = state.specs.cartonWeightKg.trim();
    if (!/^\d+(\.\d{1,3})?$/.test(value) || Number(value) <= 0) {
      errors['specs.cartonWeightKg'] = 'products.validation.cartonWeight';
    }
  }
  if (state.priceCny !== '') {
    const value = state.priceCny.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value)) errors.priceCny = 'products.validation.price';
  }
  if (state.sortOrder !== '' && !/^\d+$/.test(state.sortOrder.trim())) {
    errors.sortOrder = 'products.validation.sortOrder';
  }
  return errors;
}

/**
 * Translates one server field error (`specs.lengthMm`, `translations.en-US.name`)
 * into the same key space the client validation uses, so both render identically.
 */
export function mapServerFieldErrors(details: Record<string, unknown> | undefined): {
  errors: ProductFormErrors;
  formLevel: string[];
} {
  const errors: ProductFormErrors = {};
  const formLevel: string[] = [];
  for (const [field, value] of Object.entries(details ?? {})) {
    const key = normalizeFieldKey(field);
    if (key) errors[key] = String(value);
    else formLevel.push(String(value));
  }
  return { errors, formLevel };
}

function normalizeFieldKey(field: string): string | null {
  const map: Record<string, string> = {
    sku: 'sku',
    slug: 'slug',
    categoryId: 'categoryId',
    priceCny: 'priceCny',
    sortOrder: 'sortOrder',
    lengthMm: 'specs.lengthCm',
    widthMm: 'specs.widthCm',
    heightMm: 'specs.heightCm',
    weightGrams: 'specs.weightGrams',
    cartonLengthCm: 'specs.cartonLengthCm',
    cartonWidthCm: 'specs.cartonWidthCm',
    cartonHeightCm: 'specs.cartonHeightCm',
    cartonWeightKg: 'specs.cartonWeightKg',
    cartonQuantity: 'specs.cartonQuantity',
    'translations.en-US': 'translations.en-US',
  };
  if (map[field]) return map[field];
  // A Zod field error inside the translations array is reported as
  // `translations.<index>.<field>`, which cannot be attributed to one locale
  // tab: it stays a form-level message rather than being attached to the wrong
  // input. The explicit English requirement uses the `translations.en-US` key.
  return null;
}

export function toCreatePayload(
  state: ProductFormState,
  options: { canEditCost: boolean },
): CreateProductPayload {
  return { sku: state.sku.trim(), ...toWritePayload(state, options) };
}

export function toWritePayload(
  state: ProductFormState,
  options: { canEditCost: boolean },
): ProductWritePayload {
  const translation = (locale: string): ProductTranslationPayload => {
    const entry = state.translations[locale] ?? {
      name: '',
      description: '',
      seoTitle: '',
      seoDescription: '',
    };
    return {
      locale,
      name: entry.name.trim(),
      description: textOrNull(entry.description),
      seoTitle: textOrNull(entry.seoTitle),
      seoDescription: textOrNull(entry.seoDescription),
    };
  };

  return {
    slug: state.slug.trim(),
    categoryId: state.categoryId ?? '',
    publishStatus: state.publishStatus,
    lifecycleStatus: state.lifecycleStatus,
    sortOrder: intOrZero(state.sortOrder),
    lengthMm: centimetresToMillimetres(state.specs.lengthCm),
    widthMm: centimetresToMillimetres(state.specs.widthCm),
    heightMm: centimetresToMillimetres(state.specs.heightCm),
    weightGrams: intOrNull(state.specs.weightGrams),
    packaging: textOrNull(state.specs.packaging),
    cartonLengthCm: intOrNull(state.specs.cartonLengthCm),
    cartonWidthCm: intOrNull(state.specs.cartonWidthCm),
    cartonHeightCm: intOrNull(state.specs.cartonHeightCm),
    cartonWeightKg: textOrNull(state.specs.cartonWeightKg),
    cartonQuantity: intOrNull(state.specs.cartonQuantity),
    tagIds: state.tagIds,
    // Only locales with content are submitted: an empty translation row would
    // claim the product is translated when it is not.
    translations: SUPPORTED_LOCALES.map((locale) => translation(locale)).filter(
      (entry) => entry.locale === ENGLISH || entry.name.length > 0,
    ),
    // The cost field is only included for an actor allowed to change it; the API
    // refuses the write otherwise.
    ...(options.canEditCost ? { priceCny: textOrNull(state.priceCny) } : {}),
  };
}

function textOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

function intOrNull(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrZero(value: string | undefined): number {
  return intOrNull(value) ?? 0;
}

/** Converts the canonical millimetre value into the editor's cm string. */
export function millimetresToCentimetresInput(value: number | null): string {
  if (value === null || value === undefined) return '';
  const centimetres = value / 10;
  return Number.isInteger(centimetres) ? String(centimetres) : centimetres.toFixed(1);
}

/**
 * Converts a cm input into the millimetre integer stored by the existing
 * schema. One decimal is enough for millimetre precision; invalid input is
 * rejected by validation before this helper is used.
 */
export function centimetresToMillimetres(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) : null;
}

/** Mirrors the API's limit so the picker can explain it before an upload starts. */
export const IMAGE_LIMITS = PRODUCT_IMAGE_LIMITS;

/** Formats a byte count for the gallery tile. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
