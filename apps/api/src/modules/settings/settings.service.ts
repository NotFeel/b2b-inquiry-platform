import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_ADMIN_LOCALE,
  DEFAULT_WHATSAPP_SELECTION_LIMIT,
  ERROR_CODES,
  PUBLIC_LOCALE,
  SETTING_GROUPS,
  normalizeWhatsAppNumber,
} from '@b2b/contracts';
import type { GlobalSettingGroupSummary, GlobalSettingSummary, PublicSiteConfig } from '@b2b/contracts';
import { Prisma } from '@b2b/database';
import type { CreateSettingInput, SettingListQueryInput, UpdateSettingInput } from '@b2b/validation';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import {
  SETTING_DEFINITION_MAP,
  SETTING_DEFINITIONS,
  envSeededDefaults,
  type SettingDefinition,
} from './settings.registry';
import {
  assertGroupAndTypeAreValid,
  assertMetadataChangeIsAllowed,
  assertRevisionMatches,
  assertSettingIsDeletable,
  assertSettingIsEditable,
  assertTypeChangeIsLossless,
  assertVisibilityIsConsistent,
  normalizeSettingValue,
  valuePreview,
  type SettingRowRef,
} from './setting-policy';

interface SettingRow {
  key: string;
  value: unknown;
  isPublic: boolean;
  isSecret: boolean;
}

const SETTING_ROW_SELECT = {
  key: true,
  value: true,
  isPublic: true,
  isSecret: true,
  groupCode: true,
  valueType: true,
  labelKey: true,
  descriptionKey: true,
  isSystem: true,
  isEditable: true,
  isDeletable: true,
  isRequired: true,
  sortOrder: true,
  options: true,
  validation: true,
  revision: true,
  updatedAt: true,
  updatedById: true,
  translations: { select: { locale: true, label: true, description: true } },
} as const;

type SettingFullRow = Prisma.GlobalSettingGetPayload<{ select: typeof SETTING_ROW_SELECT }>;

@Injectable()
export class SettingsService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
  ) {}

  // ------------------------------------------------------------- admin listing

  /**
   * Admin list with metadata, safe previews and server-side filters (docs/21 §6.1).
   *
   * Rows without a database entry are still listed: a built-in setting that was
   * never written keeps working from the registry/env default, and the UI must
   * show that state instead of hiding the key.
   */
  async listSettings(query: SettingListQueryInput) {
    const rows = await this.prisma.globalSetting.findMany({ select: SETTING_ROW_SELECT });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const all: GlobalSettingSummary[] = [];

    for (const definition of SETTING_DEFINITIONS) {
      all.push(this.toSummary(definition.key, byKey.get(definition.key) ?? null, definition, query.locale));
    }
    for (const row of rows) {
      if (SETTING_DEFINITION_MAP.has(row.key)) continue;
      all.push(this.toSummary(row.key, row, null, query.locale));
    }

    const keyword = query.keyword?.trim().toLowerCase();
    const filtered = all.filter((item) => {
      if (query.groupCode !== 'all' && item.groupCode !== query.groupCode) return false;
      if (query.valueType !== 'all' && item.valueType !== query.valueType) return false;
      if (query.source === 'system' && !item.isSystem) return false;
      if (query.source === 'custom' && item.isSystem) return false;
      if (query.visibility === 'public' && !item.isPublic) return false;
      if (query.visibility === 'secret' && !item.isSecret) return false;
      if (query.visibility === 'private' && (item.isPublic || item.isSecret)) return false;
      if (!keyword) return true;
      return (
        item.key.toLowerCase().includes(keyword) ||
        item.label.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword)
      );
    });

    filtered.sort(
      (left, right) =>
        left.groupCode.localeCompare(right.groupCode) ||
        left.sortOrder - right.sortOrder ||
        left.key.localeCompare(right.key),
    );

    const total = filtered.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: filtered.slice(start, start + query.pageSize),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /** Group inventory with counts, used by the category navigation (docs/21 §3.3). */
  async listGroups(): Promise<GlobalSettingGroupSummary[]> {
    const list = await this.listSettings({
      page: 1,
      pageSize: 1000,
      locale: DEFAULT_ADMIN_LOCALE,
      groupCode: 'all',
      valueType: 'all',
      visibility: 'all',
      source: 'all',
    });
    return SETTING_GROUPS.map((code) => {
      const items = list.data.filter((item) => item.groupCode === code);
      return {
        code,
        labelKey: `settings.groups.${code}`,
        count: items.length,
        publicCount: items.filter((item) => item.isPublic).length,
        secretCount: items.filter((item) => item.isSecret).length,
        customCount: items.filter((item) => !item.isSystem).length,
      };
    }).filter((group) => group.count > 0 || group.code === 'custom');
  }

  async getSetting(key: string, locale: string = DEFAULT_ADMIN_LOCALE): Promise<GlobalSettingSummary> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key }, select: SETTING_ROW_SELECT });
    const definition = SETTING_DEFINITION_MAP.get(key);
    if (!row && !definition) {
      throw new ApiError(ERROR_CODES.settingNotFound, 'Setting not found.', { status: 404 });
    }
    return this.toSummary(key, row, definition ?? null, locale);
  }

  private toSummary(
    key: string,
    row: SettingFullRow | null,
    definition: SettingDefinition | null,
    locale: string = DEFAULT_ADMIN_LOCALE,
  ): GlobalSettingSummary {
    const isSecret = row?.isSecret ?? Boolean(definition?.isSecret);
    const isPublic = isSecret ? false : (row?.isPublic ?? definition?.isPublic ?? false);
    const rawValue = row ? row.value : (envSeededDefaults(this.env)[key] ?? definition?.defaultValue ?? null);
    const preview = isSecret ? null : valuePreview(row ? row.value : rawValue);
    // Custom settings keep their labels in the translation table (resolved for
    // the requested locale with a fallback chain); built-in ones resolve through
    // `labelKey` + the admin i18n dictionary.
    const translations = row?.translations ?? [];
    const translation =
      translations.find((item) => item.locale === locale) ??
      translations.find((item) => item.locale === 'en-US') ??
      translations[0] ??
      null;

    return {
      key,
      value: isSecret ? null : (row?.value ?? null),
      hasValue: row !== null && row.value !== null,
      isPublic,
      isSecret,
      configured: isSecret ? row !== null && row.value !== null : rawValue !== null && rawValue !== undefined,
      groupCode: row?.groupCode ?? definition?.groupCode ?? 'custom',
      valueType: row?.valueType ?? definition?.type ?? 'string',
      label: translation?.label ?? definition?.labelKey ?? key,
      description: translation?.description ?? definition?.description ?? '',
      isSystem: row?.isSystem ?? definition !== null,
      isEditable: row?.isEditable ?? true,
      isDeletable: row?.isDeletable ?? false,
      isRequired: row?.isRequired ?? Boolean(definition?.isRequired),
      sortOrder: row?.sortOrder ?? definition?.sortOrder ?? 0,
      revision: row?.revision ?? 1,
      valuePreview: preview,
      usingDefault: row === null,
      updatedBy: row?.updatedById ?? null,
      updatedAt: (row?.updatedAt ?? new Date()).toISOString(),
    };
  }

  // ----------------------------------------------------------- admin CRUD

  async createSetting(input: CreateSettingInput, actorId: string, requestId: string) {
    assertGroupAndTypeAreValid(input.groupCode, input.valueType);
    assertVisibilityIsConsistent(input.isPublic, input.isSecret);
    if (SETTING_DEFINITION_MAP.has(input.key)) {
      throw new ApiError(ERROR_CODES.settingKeyConflict, 'This key is reserved by a built-in setting.', {
        details: { key: 'validation.conflict' },
      });
    }

    const existing = await this.prisma.globalSetting.findUnique({ where: { key: input.key } });
    if (existing) {
      throw new ApiError(ERROR_CODES.settingKeyConflict, 'A setting with this key already exists.', {
        details: { key: 'validation.conflict' },
      });
    }

    const { value } = normalizeSettingValue(
      input.key,
      input.valueType,
      input.value ?? null,
      input.options,
      normalizeWhatsAppNumber,
    );

    try {
      const created = await this.prisma.globalSetting.create({
        data: {
          key: input.key,
          value: value as never,
          isPublic: input.isPublic,
          isSecret: input.isSecret,
          groupCode: input.groupCode,
          valueType: input.valueType,
          isSystem: false,
          isEditable: true,
          isDeletable: true,
          isRequired: input.isRequired,
          sortOrder: input.sortOrder,
          options: (input.options ?? undefined) as never,
          validation: (input.validation ?? undefined) as never,
          updatedById: actorId,
          translations: {
            create: input.translations.map((translation) => ({
              locale: translation.locale,
              label: translation.label,
              description: translation.description ?? null,
            })),
          },
        },
        select: { key: true },
      });
      await this.audit.record({
        actorId,
        action: 'settings.create',
        entityType: 'global_setting',
        entityId: created.key,
        requestId,
        metadata: { groupCode: input.groupCode, valueType: input.valueType, isSecret: input.isSecret },
      });
      if (input.isPublic) await this.revalidatePublicConfig();
      return this.getSetting(created.key, input.locale);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(ERROR_CODES.settingKeyConflict, 'A setting with this key already exists.', {
          details: { key: 'validation.conflict' },
        });
      }
      throw error;
    }
  }

  async updateSetting(
    key: string,
    input: UpdateSettingInput,
    actorId: string,
    requestId: string,
    locale?: string,
  ): Promise<GlobalSettingSummary> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key }, select: SETTING_ROW_SELECT });
    const definition = SETTING_DEFINITION_MAP.get(key);
    if (!row && !definition) {
      throw new ApiError(ERROR_CODES.settingNotFound, 'Setting not found.', { status: 404 });
    }

    const current: SettingRowRef = {
      key,
      isPublic: row?.isPublic ?? definition?.isPublic ?? false,
      isSecret: row?.isSecret ?? Boolean(definition?.isSecret),
      isSystem: row?.isSystem ?? definition !== null,
      isEditable: row?.isEditable ?? true,
      isDeletable: row?.isDeletable ?? false,
      valueType: row?.valueType ?? definition?.type ?? 'string',
      revision: row?.revision ?? 1,
    };
    assertSettingIsEditable(current);
    assertRevisionMatches(input.expectedRevision, current.revision);
    assertMetadataChangeIsAllowed(current, {
      groupCode: input.groupCode,
      valueType: input.valueType,
      isSecret: input.isSecret,
    });

    const nextSecret = input.isSecret ?? current.isSecret;
    // An explicit "make it public" together with secret mode is a conflicting
    // request and must fail instead of being silently coerced (docs/21 GS-015).
    if (nextSecret && input.isPublic === true) {
      assertVisibilityIsConsistent(true, true);
    }
    const nextPublic = nextSecret ? false : (input.isPublic ?? current.isPublic);
    assertVisibilityIsConsistent(nextPublic, nextSecret);

    const nextType = input.valueType ?? current.valueType;
    const nextOptions = input.options ?? row?.options ?? undefined;
    // A secret keeps its stored value unless a replacement was supplied.
    const valueSupplied = input.value !== undefined || input.clearSecret === true;
    const { value } = valueSupplied
      ? normalizeSettingValue(
          key,
          nextType,
          input.clearSecret === true ? null : input.value,
          nextOptions,
          normalizeWhatsAppNumber,
        )
      : { value: undefined };

    // Changing the declared type must not silently invalidate the stored value;
    // when no replacement was supplied the current value has to survive the new
    // type (docs/21 §4.2).
    if (input.valueType !== undefined && input.valueType !== current.valueType && !valueSupplied && row) {
      assertTypeChangeIsLossless(nextType, row.value, (type, candidate) =>
        normalizeSettingValue(key, type, candidate, nextOptions, normalizeWhatsAppNumber),
      );
    }

    const updated = await this.prisma.globalSetting.upsert({
      where: { key },
      create: {
        key,
        value: (value ?? null) as never,
        isPublic: nextPublic,
        isSecret: nextSecret,
        groupCode: input.groupCode ?? definition?.groupCode ?? 'custom',
        valueType: nextType,
        isSystem: definition !== null,
        isEditable: true,
        isDeletable: current.isDeletable,
        isRequired: input.isRequired ?? Boolean(definition?.isRequired),
        sortOrder: input.sortOrder ?? definition?.sortOrder ?? 0,
        options: (nextOptions ?? undefined) as never,
        validation: (input.validation ?? undefined) as never,
        updatedById: actorId,
      },
      update: {
        ...(valueSupplied ? { value: value as never } : {}),
        isPublic: nextPublic,
        isSecret: nextSecret,
        ...(input.groupCode !== undefined ? { groupCode: input.groupCode } : {}),
        ...(input.valueType !== undefined ? { valueType: input.valueType } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.options !== undefined ? { options: input.options as never } : {}),
        ...(input.validation !== undefined ? { validation: input.validation as never } : {}),
        revision: { increment: 1 },
        updatedById: actorId,
      },
      select: { key: true, isPublic: true, isSecret: true, value: true, translations: { select: { locale: true } } },
    });

    for (const translation of input.translations ?? []) {
      await this.prisma.globalSettingTranslation.upsert({
        where: { settingKey_locale: { settingKey: key, locale: translation.locale } },
        create: {
          settingKey: key,
          locale: translation.locale,
          label: translation.label,
          description: translation.description ?? null,
        },
        update: { label: translation.label, description: translation.description ?? null },
      });
    }

    await this.audit.record({
      actorId,
      action: 'settings.update',
      entityType: 'global_setting',
      entityId: key,
      requestId,
      // Secret values are never written to the audit trail (docs/21 §7.6).
      metadata: {
        isPublic: updated.isPublic,
        isSecret: updated.isSecret,
        valueChanged: valueSupplied,
        valueCleared: input.clearSecret === true,
        metadataChanged: input.groupCode !== undefined || input.valueType !== undefined,
      },
    });

    if (updated.isPublic) await this.revalidatePublicConfig();
    return this.getSetting(key, locale ?? DEFAULT_ADMIN_LOCALE);
  }

  async deleteSetting(key: string, actorId: string, requestId: string) {
    const row = await this.prisma.globalSetting.findUnique({ where: { key }, select: SETTING_ROW_SELECT });
    if (!row) {
      throw new ApiError(ERROR_CODES.settingNotFound, 'Setting not found.', { status: 404 });
    }
    assertSettingIsDeletable(
      {
        key,
        isPublic: row.isPublic,
        isSecret: row.isSecret,
        isSystem: row.isSystem,
        isEditable: row.isEditable,
        isDeletable: row.isDeletable,
        valueType: row.valueType,
        revision: row.revision,
      },
      SETTING_DEFINITION_MAP.has(key),
    );

    await this.prisma.globalSetting.delete({ where: { key } });
    await this.audit.record({
      actorId,
      action: 'settings.delete',
      entityType: 'global_setting',
      entityId: key,
      requestId,
      metadata: { groupCode: row.groupCode, valueType: row.valueType, isSecret: row.isSecret },
    });
    if (row.isPublic) await this.revalidatePublicConfig();
    return { deleted: true };
  }

  /**
   * Invalidates the storefront's ISR cache for the public configuration.
   *
   * The storefront keeps `/public/site-config` in a tagged cache with a short
   * TTL; this webhook removes it immediately after a public setting changes
   * (docs/21 §7.9). Without a configured secret the short TTL remains the
   * fallback, and the skip is logged instead of failing the save.
   */
  private async revalidatePublicConfig(): Promise<void> {
    const secret = this.env.REVALIDATE_SECRET;
    if (!secret) {
      this.logger.info('settings.revalidate_skipped', { reason: 'REVALIDATE_SECRET is not configured' });
      return;
    }
    try {
      const response = await fetch(`${this.env.APP_BASE_URL}/api/revalidate?tag=site-config`, {
        method: 'POST',
        headers: { 'x-revalidate-secret': secret },
      });
      if (!response.ok) {
        this.logger.warn('settings.revalidate_failed', { status: response.status });
      }
    } catch (error) {
      this.logger.warn('settings.revalidate_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadRows(): Promise<Map<string, SettingRow>> {
    const rows = await this.prisma.globalSetting.findMany();
    return new Map(
      rows.map((row) => [
        row.key,
        { key: row.key, value: row.value, isPublic: row.isPublic, isSecret: row.isSecret },
      ]),
    );
  }

  /** Effective value: database row first, then env seed, then registry default. */
  async getValue<T = unknown>(key: string): Promise<T | null> {
    const definition = SETTING_DEFINITION_MAP.get(key);
    const rows = await this.loadRows();
    const row = rows.get(key);
    if (row) return row.value as T;
    const seeded = envSeededDefaults(this.env);
    if (key in seeded) return seeded[key] as T;
    return (definition?.defaultValue ?? null) as T | null;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.getValue(key);
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const value = await this.getValue(key);
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }

  async getString(key: string, fallback: string | null = null): Promise<string | null> {
    const value = await this.getValue(key);
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text.length === 0 ? fallback : text;
  }

  async getStringList(key: string): Promise<string[]> {
    const value = await this.getValue(key);
    if (Array.isArray(value)) return value.map((item) => String(item));
    if (typeof value === 'string' && value.length > 0) {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return [];
  }

  async getObjectList(key: string): Promise<{ label: string; url: string }[]> {
    const value = await this.getValue(key);
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is { label?: unknown; url?: unknown } => typeof item === 'object' && item !== null)
      .map((item) => ({ label: String(item.label ?? ''), url: String(item.url ?? '') }))
      .filter((item) => item.label.length > 0 && item.url.length > 0);
  }

  async getWhatsAppNumber(): Promise<string | null> {
    const raw = await this.getString('site.whatsappNumber');
    return normalizeWhatsAppNumber(raw);
  }

  async getBatchInquiryLimit(): Promise<number> {
    return this.getNumber('site.batchInquiryLimit', DEFAULT_WHATSAPP_SELECTION_LIMIT);
  }

  async getUploadMaxBytes(): Promise<number> {
    return this.getNumber('upload.maxBytes', this.env.UPLOAD_MAX_BYTES);
  }

  /**
   * Public projection for the storefront: only keys flagged public, and never a
   * secret value (docs/01 §3.7).
   */
  async getPublicSiteConfig(logoUrl: string | null): Promise<PublicSiteConfig> {
    const rows = await this.loadRows();
    const seeded = envSeededDefaults(this.env);
    const read = (key: string): unknown => {
      const row = rows.get(key);
      if (row && !row.isSecret) return row.value;
      if (key in seeded) return seeded[key];
      return SETTING_DEFINITION_MAP.get(key)?.defaultValue ?? null;
    };
    const asString = (key: string): string | null => {
      const value = read(key);
      if (value === null || value === undefined) return null;
      const text = String(value).trim();
      return text.length === 0 ? null : text;
    };
    const asList = (key: string): { label: string; url: string }[] => {
      const value = read(key);
      if (!Array.isArray(value)) return [];
      return value
        .filter((item): item is { label?: unknown; url?: unknown } => typeof item === 'object' && item !== null)
        .map((item) => ({ label: String(item.label ?? ''), url: String(item.url ?? '') }))
        .filter((item) => item.label.length > 0 && item.url.length > 0);
    };
    const keywordList = (): string[] => {
      const value = read('site.seoKeywords');
      if (Array.isArray(value)) return value.map((item) => String(item));
      if (typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
      return [];
    };

    const updatedAt = await this.prisma.globalSetting
      .aggregate({ _max: { updatedAt: true } })
      .then((result) => result._max.updatedAt ?? new Date());

    return {
      companyName: asString('site.companyName') ?? 'Your Company',
      tagline: asString('site.tagline'),
      logoUrl,
      contactEmail: asString('site.contactEmail'),
      contactPhone: asString('site.contactPhone'),
      address: asString('site.address'),
      socialLinks: asList('site.socialLinks'),
      whatsappNumber: normalizeWhatsAppNumber(asString('site.whatsappNumber')),
      defaultLocale: (asString('site.defaultLocale') as PublicSiteConfig['defaultLocale']) ?? PUBLIC_LOCALE,
      seo: {
        title: asString('site.seoTitle') ?? 'Wholesale product catalogue',
        description:
          asString('site.seoDescription') ?? 'Browse our product range and request a quotation on WhatsApp.',
        keywords: keywordList(),
      },
      legalLinks: asList('site.legalLinks'),
      batchInquiryLimit: await this.getBatchInquiryLimit(),
      analyticsEnabled: Boolean(read('site.analyticsEnabled') ?? true),
      updatedAt: updatedAt.toISOString(),
    };
  }
}
