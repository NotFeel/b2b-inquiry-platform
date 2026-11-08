import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  DOCUMENT_FIELD_KEYS,
  DOCUMENT_ITEM_COLUMN_KEYS,
  DOCUMENT_SECTION_KEYS,
  DOCUMENT_SECTION_LABELS,
  DOCUMENT_ITEM_COLUMN_LABELS,
  defaultFieldLabel,
  documentFieldDefinition,
  type DocumentItemColumnKey,
  type DocumentSectionKey,
} from './field-catalog';

// A template is declarative data only. It cannot contain HTML, JavaScript,
// SQL, URLs or arbitrary expressions — those are the primary injection and
// SSRF risks described in docs/41 §7.6. The server builds the HTML from this
// configuration plus escaped business values.

export const DOCUMENT_FONT_FAMILIES = [
  'Helvetica',
  'Arial',
  'Times New Roman',
  'Georgia',
  'Noto Sans',
  'DejaVu Sans',
] as const;
export type DocumentFontFamily = (typeof DOCUMENT_FONT_FAMILIES)[number];

const COLOUR = /^#[0-9a-fA-F]{6}$/;

export const DOCUMENT_TEMPLATE_LOCALES = ['en-US', 'zh-CN'] as const;
export type DocumentTemplateLocale = (typeof DOCUMENT_TEMPLATE_LOCALES)[number];

export type LocalizedText = Partial<Record<DocumentTemplateLocale, string>>;

const localizedTextSchema = (max: number) =>
  z
    .object({
      'en-US': z.string().trim().max(max).optional(),
      'zh-CN': z.string().trim().max(max).optional(),
    })
    .optional();

/** Built-in document headings, so an English template still renders a Chinese
 * document (and vice versa) without an administrator re-typing the title. */
export const DEFAULT_HEADER_TITLES: Record<'PI' | 'CI', Required<LocalizedText>> = {
  PI: { 'en-US': 'PROFORMA INVOICE', 'zh-CN': '形式发票' },
  CI: { 'en-US': 'COMMERCIAL INVOICE', 'zh-CN': '商业发票' },
};

export const DEFAULT_FOOTER_TEXTS: Required<LocalizedText> = {
  'en-US': 'This document is system generated. The numeric total on this page prevails.',
  'zh-CN': '本文件由系统生成，金额以本页数字金额为准。',
};

const fieldConfigSchema = z.object({
  key: z
    .string()
    .trim()
    .max(80)
    .refine((key) => (DOCUMENT_FIELD_KEYS as readonly string[]).includes(key), 'unknown field key'),
  visible: z.boolean().default(true),
  required: z.boolean().default(false),
  /** Legacy single-language override kept for existing templates. */
  label: z.string().trim().max(120).optional(),
  labels: localizedTextSchema(120),
});

const sectionSchema = z.object({
  key: z.enum(DOCUMENT_SECTION_KEYS),
  visible: z.boolean().default(true),
  /** Legacy single-language override kept for existing templates. */
  title: z.string().trim().max(120).optional(),
  titles: localizedTextSchema(120),
  fields: z.array(fieldConfigSchema).max(DOCUMENT_FIELD_KEYS.length),
});

const itemColumnSchema = z.object({
  key: z.enum(DOCUMENT_ITEM_COLUMN_KEYS),
  visible: z.boolean().default(true),
  /** Legacy single-language override kept for existing templates. */
  label: z.string().trim().max(80).optional(),
  labels: localizedTextSchema(80),
  width: z.number().int().min(4).max(40).optional(),
});

const documentTemplateConfigBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    page: z.object({
      size: z.enum(['A4', 'Letter']),
      orientation: z.enum(['portrait', 'landscape']),
      marginMm: z.object({
        top: z.number().int().min(8).max(30),
        right: z.number().int().min(8).max(30),
        bottom: z.number().int().min(8).max(30),
        left: z.number().int().min(8).max(30),
      }),
    }),
    theme: z.object({
      primaryColor: z.string().regex(COLOUR),
      accentColor: z.string().regex(COLOUR),
      fontFamily: z.enum(DOCUMENT_FONT_FAMILIES),
      fontSizePt: z.number().int().min(8).max(14).default(10),
    }),
    header: z.object({
      title: z.string().trim().max(120),
      titles: localizedTextSchema(120),
      subtitle: z.string().trim().max(160).optional(),
      subtitles: localizedTextSchema(160),
      showLogo: z.boolean().default(true),
      /** Optional for legacy configurations; defaults to the legacy logo flag. */
      showStamp: z.boolean().optional(),
      showDocumentType: z.boolean().default(true),
    }),
    sections: z.array(sectionSchema).max(DOCUMENT_SECTION_KEYS.length),
    itemColumns: z.array(itemColumnSchema).min(1).max(DOCUMENT_ITEM_COLUMN_KEYS.length),
    footer: z.object({
      text: z.string().trim().max(500).optional(),
      texts: localizedTextSchema(500),
      /** Optional for legacy configurations; defaults to whether text was set. */
      showText: z.boolean().optional(),
      showPageNumbers: z.boolean().default(true),
    }),
    terms: z.object({
      paymentNotice: z.string().trim().max(1000).optional(),
      shipmentNotice: z.string().trim().max(1000).optional(),
      authenticityDeclaration: z.string().trim().max(1000).optional(),
      /** Optional flags are normalized to true for historical templates. */
      showPaymentNotice: z.boolean().optional(),
      showShipmentNotice: z.boolean().optional(),
      showAuthenticityDeclaration: z.boolean().optional(),
    }),
    notes: z
      .object({
        visible: z.boolean().default(true),
        title: z.string().trim().max(120).optional(),
        titles: localizedTextSchema(120),
      })
      .optional(),
  })
  .superRefine((config, context) => {
    const sectionKeys = new Set<string>();
    for (const section of config.sections) {
      if (sectionKeys.has(section.key)) {
        context.addIssue({
          code: 'custom',
          path: ['sections'],
          message: `Duplicate section ${section.key}.`,
        });
      }
      sectionKeys.add(section.key);
      const seenFields = new Set<string>();
      for (const field of section.fields) {
        if (seenFields.has(field.key)) {
          context.addIssue({
            code: 'custom',
            path: ['sections'],
            message: `Duplicate field ${field.key}.`,
          });
        }
        seenFields.add(field.key);
        const definition = documentFieldDefinition(field.key);
        if (definition && definition.section !== section.key) {
          context.addIssue({
            code: 'custom',
            path: ['sections'],
            message: `Field ${field.key} belongs to ${definition.section}, not ${section.key}.`,
          });
        }
      }
    }
    const columnKeys = new Set<string>();
    for (const column of config.itemColumns) {
      if (columnKeys.has(column.key)) {
        context.addIssue({
          code: 'custom',
          path: ['itemColumns'],
          message: `Duplicate item column ${column.key}.`,
        });
      }
      columnKeys.add(column.key);
    }
    if (!columnKeys.has('items.description')) {
      context.addIssue({
        code: 'custom',
        path: ['itemColumns'],
        message: 'The description column is required.',
      });
    }
    if (!columnKeys.has('items.amount')) {
      context.addIssue({
        code: 'custom',
        path: ['itemColumns'],
        message: 'The amount column is required.',
      });
    }
  });

/**
 * Normalizes optional settings introduced after schema version 1 without
 * rewriting historical published JSON. The defaults deliberately preserve the
 * rendering of older templates.
 */
export const documentTemplateConfigSchema = documentTemplateConfigBaseSchema.transform(
  (config) => ({
    ...config,
    header: {
      ...config.header,
      showStamp: config.header.showStamp ?? config.header.showLogo,
    },
    footer: {
      ...config.footer,
      showText: config.footer.showText ?? Boolean(config.footer.text),
    },
    terms: {
      ...config.terms,
      showPaymentNotice: config.terms.showPaymentNotice ?? true,
      showShipmentNotice: config.terms.showShipmentNotice ?? true,
      showAuthenticityDeclaration: config.terms.showAuthenticityDeclaration ?? true,
    },
    notes: config.notes ?? { visible: true },
  }),
);

export type DocumentTemplateConfig = z.infer<typeof documentTemplateConfigSchema>;
export type DocumentTemplateFieldConfig =
  DocumentTemplateConfig['sections'][number]['fields'][number];
export type DocumentTemplateItemColumn = DocumentTemplateConfig['itemColumns'][number];

export function createDefaultTemplateConfig(
  documentType: 'PI' | 'CI',
  locale: 'en-US' | 'zh-CN' = 'en-US',
): DocumentTemplateConfig {
  const zh = locale === 'zh-CN';
  const sections = DOCUMENT_SECTION_KEYS.map((section) => ({
    key: section,
    // A PI shares the parties, trade and payment blocks. Shipping and the
    // customs declaration are the CI-specific sections (docs/41 §2.1).
    visible: documentType === 'CI' ? true : section !== 'shipping' && section !== 'notifyParty',
    title: DOCUMENT_SECTION_LABELS[section][locale],
    fields: DOCUMENT_FIELD_KEYS.filter(
      (key) => documentFieldDefinition(key)?.section === section,
    ).map((key) => ({
      key,
      visible: true,
      required: false,
      label: defaultFieldLabel(key, locale),
    })),
  }));

  const columns: Record<DocumentItemColumnKey, { visible: boolean; width: number }> = {
    'items.lineNo': { visible: true, width: 4 },
    'items.sku': { visible: true, width: 11 },
    'items.description': { visible: true, width: 28 },
    'items.hsCode': { visible: documentType === 'CI', width: 10 },
    'items.originCountryCode': { visible: documentType === 'CI', width: 8 },
    'items.quantity': { visible: true, width: 8 },
    'items.unit': { visible: true, width: 6 },
    'items.unitPrice': { visible: true, width: 11 },
    'items.cartons': { visible: documentType === 'CI', width: 7 },
    'items.netWeightKg': { visible: false, width: 8 },
    'items.grossWeightKg': { visible: documentType === 'CI', width: 8 },
    'items.cbm': { visible: documentType === 'CI', width: 7 },
    'items.amount': { visible: true, width: 12 },
  };

  return {
    schemaVersion: 1,
    page: {
      size: 'A4',
      orientation: 'portrait',
      marginMm: { top: 12, right: 12, bottom: 14, left: 12 },
    },
    theme: {
      primaryColor: '#111827',
      accentColor: '#2563eb',
      fontFamily: 'Helvetica',
      fontSizePt: 10,
    },
    header: {
      title: documentType === 'CI' ? 'COMMERCIAL INVOICE' : 'PROFORMA INVOICE',
      subtitle: undefined,
      showLogo: true,
      showStamp: true,
      showDocumentType: true,
    },
    sections,
    itemColumns: DOCUMENT_ITEM_COLUMN_KEYS.map((key) => ({
      key,
      visible: columns[key].visible,
      width: columns[key].width,
      label: DOCUMENT_ITEM_COLUMN_LABELS[key][locale],
    })),
    footer: {
      text: zh
        ? '本文件由系统生成，金额以本页数字金额为准。'
        : 'This document is system generated. The numeric total on this page prevails.',
      showText: true,
      showPageNumbers: true,
    },
    terms: {
      paymentNotice: undefined,
      shipmentNotice: undefined,
      authenticityDeclaration: undefined,
      showPaymentNotice: true,
      showShipmentNotice: true,
      showAuthenticityDeclaration: true,
    },
    notes: {
      visible: true,
      title: zh ? '备注' : 'Notes',
    },
  };
}

/** Parses and validates an untrusted template configuration. */
export function parseTemplateConfig(value: unknown): DocumentTemplateConfig {
  return documentTemplateConfigSchema.parse(value);
}

export function templateConfigChecksum(config: DocumentTemplateConfig): string {
  // Stable key order is built explicitly so the checksum does not depend on the
  // caller's JSON property order.
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(config)))
    .digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export function visibleSections(
  config: DocumentTemplateConfig,
  locale: string,
): Array<{
  key: DocumentSectionKey;
  title: string;
  fields: Array<{ key: string; label: string; required: boolean }>;
}> {
  return config.sections
    .filter((section) => isSectionVisible(config, section.key))
    .map((section) => ({
      key: section.key,
      title:
        section.title ||
        (locale === 'zh-CN'
          ? DOCUMENT_SECTION_LABELS[section.key]['zh-CN']
          : DOCUMENT_SECTION_LABELS[section.key]['en-US']),
      fields: section.fields
        .filter((field) => isFieldVisible(config, section.key, field.key))
        .map((field) => ({
          key: field.key,
          label: field.label || defaultFieldLabel(field.key, locale),
          required: field.required,
        })),
    }));
}

export function isSectionVisible(
  config: DocumentTemplateConfig,
  sectionKey: DocumentSectionKey,
): boolean {
  return config.sections.find((section) => section.key === sectionKey)?.visible === true;
}

/**
 * An absent field is hidden. This prevents legacy or malformed configurations
 * from accidentally exposing a field that the editor did not explicitly enable.
 */
export function isFieldVisible(
  config: DocumentTemplateConfig,
  sectionKey: DocumentSectionKey,
  fieldKey: string,
): boolean {
  const section = config.sections.find((candidate) => candidate.key === sectionKey);
  if (!section?.visible) return false;
  return section.fields.find((field) => field.key === fieldKey)?.visible === true;
}

export function hasVisibleFields(
  config: DocumentTemplateConfig,
  sectionKey: DocumentSectionKey,
): boolean {
  const section = config.sections.find((candidate) => candidate.key === sectionKey);
  return Boolean(section?.visible && section.fields.some((field) => field.visible));
}

export function templateSectionField(
  config: DocumentTemplateConfig,
  sectionKey: DocumentSectionKey,
  fieldKey: string,
) {
  return config.sections
    .find((section) => section.key === sectionKey)
    ?.fields.find((field) => field.key === fieldKey);
}
