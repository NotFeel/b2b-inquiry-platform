import type { SettingGroupCode, SettingValueType } from './constants';

// Built-in settings registry (docs/21 §4.4, §9 phase 1).
//
// It lives in the shared contracts package because both the API (type, group,
// visibility, delete rules) and the database seed (metadata backfill) must agree
// on exactly the same definitions.

export type SettingType = SettingValueType;

export interface SettingDefinition {
  key: string;
  type: SettingType;
  groupCode: SettingGroupCode;
  isPublic: boolean;
  isSecret?: boolean;
  /** Display name/description come from these i18n keys in the admin app. */
  labelKey: string;
  description: string;
  /** Sort order inside the group. */
  sortOrder: number;
  isRequired?: boolean;
  /** Built-in settings cannot be renamed, unlocked or deleted (docs/21 §4.4). */
  isDeletable?: boolean;
  /** Value used when neither the database nor the environment provides one. */
  defaultValue: unknown;
}

/** `settings.definitions.<key>` is the convention shared with the migration. */
export function definitionLabelKey(key: string): string {
  return `settings.definitions.${key.replace(/\./g, '_')}`;
}

interface DefinitionSeed {
  key: string;
  type: SettingType;
  groupCode: SettingGroupCode;
  isPublic: boolean;
  isSecret?: boolean;
  description: string;
  defaultValue: unknown;
  sortOrder: number;
  isRequired?: boolean;
  isDeletable?: boolean;
}

/**
 * Registry of built-in settings.
 *
 * This is the code-side source of truth for a key's type, group, visibility,
 * defaults and deletion rules; `prisma/seed.ts` mirrors the metadata into the
 * database so the API can filter and authorize without guessing (docs/21 §4.4).
 */
export const SETTING_DEFINITIONS: SettingDefinition[] = (
  [
    {
      key: 'site.companyName',
      type: 'string',
      groupCode: 'site_profile',
      isPublic: true,
      description: 'Company name shown in the storefront header, footer and metadata.',
      defaultValue: 'Your Company',
      sortOrder: 10,
    },
    {
      key: 'site.tagline',
      type: 'text',
      groupCode: 'site_profile',
      isPublic: true,
      description: 'Short storefront strapline.',
      defaultValue: null,
      sortOrder: 20,
    },
    {
      key: 'site.logoFileAssetId',
      type: 'string',
      groupCode: 'site_profile',
      isPublic: true,
      description: 'File asset id of the storefront logo (upload in Files, not a free URL).',
      defaultValue: null,
      sortOrder: 30,
    },
    {
      key: 'site.defaultLocale',
      type: 'select',
      groupCode: 'site_profile',
      isPublic: true,
      description: 'Default locale for public content (en-US in phase one).',
      defaultValue: 'en-US',
      sortOrder: 40,
    },
    {
      key: 'admin.timezone',
      type: 'string',
      groupCode: 'site_profile',
      isPublic: false,
      description: 'Timezone used to render timestamps in the back office.',
      defaultValue: 'UTC',
      sortOrder: 50,
    },
    {
      key: 'site.contactEmail',
      type: 'email',
      groupCode: 'contact',
      isPublic: true,
      description: 'Public contact email address.',
      defaultValue: null,
      sortOrder: 10,
    },
    {
      key: 'site.contactPhone',
      type: 'phone',
      groupCode: 'contact',
      isPublic: true,
      description: 'Public contact phone number (display format).',
      defaultValue: null,
      sortOrder: 20,
    },
    {
      key: 'site.address',
      type: 'text',
      groupCode: 'contact',
      isPublic: true,
      description: 'Postal address shown on the contact page.',
      defaultValue: null,
      sortOrder: 30,
    },
    {
      key: 'site.socialLinks',
      type: 'objectList',
      groupCode: 'social',
      isPublic: true,
      description: 'List of { label, url } social links.',
      defaultValue: [],
      sortOrder: 10,
    },
    {
      key: 'site.legalLinks',
      type: 'objectList',
      groupCode: 'social',
      isPublic: true,
      description: 'List of { label, url } legal links shown in the footer.',
      defaultValue: [],
      sortOrder: 20,
    },
    {
      key: 'site.whatsappNumber',
      type: 'phone',
      groupCode: 'inquiry',
      isPublic: true,
      description: 'International WhatsApp number, digits only (no +, spaces or dashes).',
      defaultValue: '',
      sortOrder: 10,
      isRequired: true,
    },
    {
      key: 'site.batchInquiryLimit',
      type: 'number',
      groupCode: 'inquiry',
      isPublic: true,
      description: 'Maximum number of SKUs accepted in one WhatsApp batch message.',
      defaultValue: 20,
      sortOrder: 20,
    },
    {
      key: 'site.seoTitle',
      type: 'string',
      groupCode: 'seo',
      isPublic: true,
      description: 'Default SEO title used when a page has none.',
      defaultValue: 'Wholesale product catalogue',
      sortOrder: 10,
    },
    {
      key: 'site.seoDescription',
      type: 'text',
      groupCode: 'seo',
      isPublic: true,
      description: 'Default SEO description.',
      defaultValue: 'Browse our product range and request a quotation on WhatsApp.',
      sortOrder: 20,
    },
    {
      key: 'site.seoKeywords',
      type: 'stringList',
      groupCode: 'seo',
      isPublic: true,
      description: 'Comma separated default SEO keywords.',
      defaultValue: [],
      sortOrder: 30,
    },
    {
      key: 'site.analyticsEnabled',
      type: 'boolean',
      groupCode: 'analytics',
      isPublic: true,
      description: 'Enables anonymous storefront analytics collection.',
      defaultValue: true,
      sortOrder: 10,
    },
    {
      key: 'analytics.rawRetentionDays',
      type: 'number',
      groupCode: 'analytics',
      isPublic: false,
      description: 'Retention window for raw analytics events before rollup.',
      defaultValue: 90,
      sortOrder: 20,
    },
    {
      key: 'upload.maxBytes',
      type: 'number',
      groupCode: 'integrations',
      isPublic: false,
      description: 'Maximum accepted upload size in bytes (server-enforced).',
      defaultValue: 10_485_760,
      sortOrder: 10,
    },
    {
      key: 'integrations.whatsappWebhookSecret',
      type: 'string',
      groupCode: 'integrations',
      isPublic: false,
      isSecret: true,
      description: 'Reserved for the WhatsApp Business Platform webhook integration.',
      defaultValue: null,
      sortOrder: 20,
    },
  ] satisfies DefinitionSeed[]
).map((definition: DefinitionSeed): SettingDefinition => ({
  ...definition,
  labelKey: definitionLabelKey(definition.key),
  isRequired: Boolean(definition.isRequired),
  isDeletable: definition.isDeletable ?? false,
}));

export const SETTING_DEFINITION_MAP = new Map(SETTING_DEFINITIONS.map((item) => [item.key, item]));
