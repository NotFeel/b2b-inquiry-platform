import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_ADMIN_LOCALE,
  ERROR_CODES,
  SUPPORTED_LOCALES,
  buildPaginationMeta,
} from '@b2b/contracts';
import type { Paginated, PublicTagFilter, TagOption, TagSummary } from '@b2b/contracts';
import type { CreateTagInput, TagListQueryInput, UpdateTagInput } from '@b2b/validation';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  adminTagLabel,
  assertColorTokenAllowed,
  assertEnglishLabelPresent,
  assertTagDeletable,
  assertTagNotModified,
  missingLocales,
  publicTagLabel,
  toTranslationRows,
} from './tag-policy';

const TAG_SELECT = {
  id: true,
  code: true,
  colorToken: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  translations: { select: { locale: true, label: true } },
  _count: { select: { products: true } },
} as const;

interface TagRow {
  id: string;
  code: string;
  colorToken: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  translations: { locale: string; label: string }[];
  _count: { products: number };
}

/**
 * Tag administration (docs/23).
 *
 * `code` is the stable business key; display names live in `TagTranslation` and
 * are resolved per locale. `productCount` is always aggregated server-side and
 * never accepted from a client. Deleting a referenced tag is refused by the
 * service (TAG_IN_USE) and blocked again by a RESTRICT foreign key.
 */
@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  // ------------------------------------------------------------------ reads

  /**
   * Paginated, filtered tag list (docs/23 §6.1).
   *
   * Search and filters run server-side; the page size is clamped by the shared
   * pagination schema so a caller can never request the whole table.
   */
  async list(query: TagListQueryInput): Promise<Paginated<TagSummary>> {
    const rows = await this.loadRows();
    const locale = query.locale ?? DEFAULT_ADMIN_LOCALE;
    const needle = query.q?.trim().toLowerCase();

    const filtered = rows
      .filter((row) => {
        if (query.status === 'enabled' && !row.enabled) return false;
        if (query.status === 'disabled' && row.enabled) return false;
        if (query.usage === 'used' && row._count.products === 0) return false;
        if (query.usage === 'unused' && row._count.products > 0) return false;
        if (!needle) return true;
        return (
          row.code.toLowerCase().includes(needle) ||
          row.translations.some((translation) => translation.label.toLowerCase().includes(needle))
        );
      })
      // Stable order: code ascending, matching the list's default sort.
      .sort((left, right) => left.code.localeCompare(right.code));

    const start = (query.page - 1) * query.pageSize;
    return {
      data: filtered.slice(start, start + query.pageSize).map((row) => this.toSummary(row, locale)),
      pagination: buildPaginationMeta(query.page, query.pageSize, filtered.length),
    };
  }

  async detail(id: string, locale: string = DEFAULT_ADMIN_LOCALE): Promise<TagSummary> {
    const row = await this.prisma.tag.findUnique({ where: { id }, select: TAG_SELECT });
    if (!row) throw new ApiError(ERROR_CODES.tagNotFound, 'Tag not found.');
    return this.toSummary(row, locale);
  }

  /**
   * Options for pickers (docs/23 §8.1): enabled tags only.
   *
   * A product that already carries a disabled tag keeps that association: the
   * product editor renders the saved codes on top of this list instead of
   * treating the list as the complete set.
   */
  async options(locale: string = DEFAULT_ADMIN_LOCALE): Promise<TagOption[]> {
    const rows = await this.prisma.tag.findMany({
      where: { enabled: true },
      orderBy: { code: 'asc' },
      select: TAG_SELECT,
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: adminTagLabel(this.labelsOf(row), locale) || row.code,
      colorToken: row.colorToken,
      enabled: row.enabled,
    }));
  }

  /**
   * Public filter catalogue: enabled tags and how many publicly visible
   * products use each tag. Disabled tags and unpublished products are excluded
   * by the query, so the count matches what a visitor can open.
   */
  async publicFilters(locale: string = DEFAULT_ADMIN_LOCALE): Promise<PublicTagFilter[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.tag.findMany({
        where: { enabled: true },
        orderBy: { code: 'asc' },
        select: TAG_SELECT,
      }),
      this.prisma.productTag.groupBy({
        by: ['tagId'],
        where: {
          product: {
            publishStatus: 'PUBLISHED',
            lifecycleStatus: { not: 'DISCONTINUED' },
          },
        },
        _count: { _all: true },
      }),
    ]);
    const countByTag = new Map(counts.map((row) => [row.tagId, row._count._all]));
    return rows.map((row) => ({
      code: row.code,
      label: publicTagLabel(this.labelsOf(row), locale) || row.code,
      colorToken: row.colorToken,
      productCount: countByTag.get(row.id) ?? 0,
    }));
  }

  // ----------------------------------------------------------------- writes

  async create(input: CreateTagInput, actorId: string, requestId: string): Promise<TagSummary> {
    assertColorTokenAllowed(input.colorToken ?? null);
    const translations = toTranslationRows(input.translations);
    assertEnglishLabelPresent(translations);

    const existing = await this.prisma.tag.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new ApiError(ERROR_CODES.tagCodeConflict, 'This tag code is already in use.', {
        details: { code: 'tag.code.taken' },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const tag = await tx.tag.create({
        data: {
          code: input.code,
          colorToken: input.colorToken ?? null,
          enabled: input.enabled,
          translations: { create: translations },
        },
        select: { id: true, code: true },
      });
      return tag;
    });

    await this.audit.record({
      actorId,
      action: 'tag.create',
      entityType: 'tag',
      entityId: created.id,
      requestId,
      metadata: {
        code: created.code,
        colorToken: input.colorToken ?? null,
        enabled: input.enabled,
        locales: translations.map((translation) => translation.locale),
      },
    });
    await this.revalidatePublicTags('create');
    return this.detail(created.id);
  }

  /**
   * Update names, style and status (docs/23 §6.3).
   *
   * `code` is intentionally absent from the DTO: it is the stable key products
   * reference, so renaming it needs a dedicated migration flow.
   */
  async update(
    id: string,
    input: UpdateTagInput,
    actorId: string,
    requestId: string,
  ): Promise<TagSummary> {
    const row = await this.prisma.tag.findUnique({ where: { id }, select: TAG_SELECT });
    if (!row) throw new ApiError(ERROR_CODES.tagNotFound, 'Tag not found.');
    assertTagNotModified(row.updatedAt, input.expectedUpdatedAt);
    assertColorTokenAllowed(input.colorToken ?? null);

    const currentLabels = this.labelsOf(row);
    let translations: { locale: string; label: string }[] | null = null;
    if (input.translations) {
      translations = toTranslationRows(input.translations);
      // Validate the merged result, not just the submitted slice: a PATCH must
      // not be able to remove the English label the storefront depends on.
      assertEnglishLabelPresent(
        Object.entries({
          ...currentLabels,
          ...Object.fromEntries(translations.map((t) => [t.locale, t.label])),
        }).map(([locale, label]) => ({ locale, label })),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tag.update({
        where: { id },
        data: {
          ...(input.colorToken !== undefined ? { colorToken: input.colorToken } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      for (const translation of translations ?? []) {
        await tx.tagTranslation.upsert({
          where: { tagId_locale: { tagId: id, locale: translation.locale } },
          create: { tagId: id, locale: translation.locale, label: translation.label },
          update: { label: translation.label },
        });
      }
    });

    await this.audit.record({
      actorId,
      action: 'tag.update',
      entityType: 'tag',
      entityId: id,
      requestId,
      // Translation diffs are recorded per locale, never as one opaque blob
      // (docs/23 §7).
      metadata: {
        code: row.code,
        ...(input.colorToken !== undefined && input.colorToken !== row.colorToken
          ? { colorToken: { from: row.colorToken, to: input.colorToken } }
          : {}),
        ...(input.enabled !== undefined && input.enabled !== row.enabled
          ? { enabled: { from: row.enabled, to: input.enabled } }
          : {}),
        ...(translations
          ? {
              translations: translations.map((translation) => ({
                locale: translation.locale,
                from: currentLabels[translation.locale] ?? null,
                to: translation.label,
              })),
            }
          : {}),
      },
    });
    await this.revalidatePublicTags('update');
    return this.detail(id);
  }

  /** Enable/disable (docs/23 §6.4): keeps historical product associations. */
  async setStatus(
    id: string,
    enabled: boolean,
    actorId: string,
    requestId: string,
  ): Promise<TagSummary> {
    const row = await this.prisma.tag.findUnique({
      where: { id },
      select: { id: true, code: true, enabled: true },
    });
    if (!row) throw new ApiError(ERROR_CODES.tagNotFound, 'Tag not found.');
    if (row.enabled !== enabled) {
      await this.prisma.tag.update({ where: { id }, data: { enabled } });
      await this.audit.record({
        actorId,
        action: 'tag.status_changed',
        entityType: 'tag',
        entityId: id,
        requestId,
        metadata: { code: row.code, enabled: { from: row.enabled, to: enabled } },
      });
      await this.revalidatePublicTags('status');
    }
    return this.detail(id);
  }

  /**
   * Delete a tag that nothing references (docs/23 §6.5).
   *
   * The reference count is re-read inside the same transaction as the delete, so
   * a `ProductTag` created a moment ago still blocks it; the `RESTRICT` foreign
   * key is the backstop. Associations are never cascaded away.
   */
  async remove(id: string, actorId: string, requestId: string): Promise<{ deleted: true }> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const tag = await tx.tag.findUnique({
        where: { id },
        select: { id: true, code: true, _count: { select: { products: true } } },
      });
      if (!tag) throw new ApiError(ERROR_CODES.tagNotFound, 'Tag not found.');
      assertTagDeletable(tag._count.products);
      // `TagTranslation` cascades with its tag: translations have no meaning
      // without the tag, unlike product associations.
      await tx.tag.delete({ where: { id } });
      return tag;
    });

    await this.audit.record({
      actorId,
      action: 'tag.delete',
      entityType: 'tag',
      entityId: id,
      requestId,
      metadata: { code: deleted.code },
    });
    await this.revalidatePublicTags('delete');
    return { deleted: true };
  }

  // ---------------------------------------------------------------- helpers

  private async loadRows(): Promise<TagRow[]> {
    return this.prisma.tag.findMany({ select: TAG_SELECT });
  }

  private labelsOf(row: Pick<TagRow, 'translations'>): Record<string, string> {
    return Object.fromEntries(
      row.translations.map((translation) => [translation.locale, translation.label]),
    );
  }

  private toSummary(row: TagRow, locale: string): TagSummary {
    const labels = this.labelsOf(row);
    return {
      id: row.id,
      code: row.code,
      colorToken: row.colorToken,
      enabled: row.enabled,
      // Resolved here so every caller (list, detail, picker) shows the same name.
      label: adminTagLabel(labels, locale) || row.code,
      labels,
      productCount: row._count.products,
      updatedAt: row.updatedAt.toISOString(),
      missingLocales: missingLocales(labels, SUPPORTED_LOCALES),
    };
  }

  /**
   * Storefront cache invalidation (docs/23 §6.4, §8.2).
   *
   * The storefront caches product lists under the `products` ISR tag, so a tag
   * change must invalidate it or the old badge keeps showing. Without a
   * configured secret the short ISR TTL stays the fallback and the skip is
   * logged rather than failing the save.
   */
  private async revalidatePublicTags(reason: string): Promise<void> {
    const secret = this.env.REVALIDATE_SECRET;
    if (!secret) {
      this.logger.info('tags.revalidate_skipped', {
        reason,
        cause: 'REVALIDATE_SECRET is not configured',
      });
      return;
    }
    try {
      const response = await fetch(`${this.env.APP_BASE_URL}/api/revalidate?tag=products`, {
        method: 'POST',
        headers: { 'x-revalidate-secret': secret },
      });
      if (!response.ok) {
        this.logger.warn('tags.revalidate_failed', { reason, status: response.status });
      }
    } catch (error) {
      this.logger.warn('tags.revalidate_failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
