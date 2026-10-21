import { Injectable } from '@nestjs/common';
import { DICTIONARY_TYPES, ERROR_CODES } from '@b2b/contracts';
import type {
  DictionaryItemSummary,
  DictionaryOptionSet,
  DictionaryTypeSummary,
} from '@b2b/contracts';
import { Prisma, type PrismaClient } from '@b2b/database';
import type {
  CreateDictionaryItemInput,
  CreateDictionaryTypeInput,
  DictionaryItemListQueryInput,
  DictionaryOptionQueryInput,
  DictionaryTypeListQueryInput,
  ReorderDictionaryItemsInput,
  UpdateDictionaryItemInput,
  UpdateDictionaryTypeInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DICTIONARY_REORDER_STEP,
  assertExpectedUpdatedAt,
  assertItemBelongsToType,
  assertItemIsDeletable,
  assertItemMutationAllowed,
  assertNotSystemLocked,
  assertReorderIsComplete,
  assertTypeIsDeletable,
  isBehaviourLockedType,
  toOptions,
} from './dictionary-policy';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

// Two-level dictionary (docs/20).
//
// `DictionaryType.code` is the one-level query key, `DictionaryItem.code` is the
// stable business value inside a type and the translated label only ever drives
// display. There is no dictionary cache in this codebase: reads always hit the
// database, so a label, order or enablement change is visible on the next
// request (docs/20 §9.2).
@Injectable()
export class DictionaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
  ) {}

  // ---------------------------------------------------------------- type side

  async listTypes(query: DictionaryTypeListQueryInput) {
    const keyword = query.keyword?.trim();
    const where: Prisma.DictionaryTypeWhereInput = {
      ...(query.enabled === 'true' ? { enabled: true } : {}),
      ...(query.enabled === 'false' ? { enabled: false } : {}),
      ...(keyword
        ? {
            OR: [
              { code: { contains: keyword, mode: 'insensitive' } },
              { nameKey: { contains: keyword, mode: 'insensitive' } },
              { description: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, types] = await this.prisma.$transaction([
      this.prisma.dictionaryType.count({ where }),
      this.prisma.dictionaryType.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
            select: {
              id: true,
              code: true,
              value: true,
              sortOrder: true,
              enabled: true,
              systemLocked: true,
              updatedAt: true,
              ...(query.includeItems
                ? { translations: { select: { locale: true, label: true } } }
                : {}),
            },
          },
        },
      }),
    ]);

    return {
      data: types.map((type) => ({
        id: type.id,
        code: type.code,
        nameKey: type.nameKey,
        description: type.description,
        systemLocked: type.systemLocked,
        enabled: type.enabled,
        itemCount: type.items.length,
        enabledItemCount: type.items.filter((item) => item.enabled).length,
        updatedAt: type.updatedAt.toISOString(),
        ...(query.includeItems
          ? {
              items: type.items.map((item) =>
                this.toItemSummary(type.code, { ...item, translations: item.translations ?? [] }),
              ),
            }
          : {}),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getType(id: string): Promise<DictionaryTypeSummary> {
    const type = await this.prisma.dictionaryType.findUnique({
      where: { id },
      include: {
        items: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], include: { translations: true } },
      },
    });
    if (!type) throw this.typeNotFound();
    return {
      id: type.id,
      code: type.code,
      nameKey: type.nameKey,
      description: type.description,
      systemLocked: type.systemLocked,
      enabled: type.enabled,
      itemCount: type.items.length,
      enabledItemCount: type.items.filter((item) => item.enabled).length,
      updatedAt: type.updatedAt.toISOString(),
      items: type.items.map((item) => this.toItemSummary(type.code, item)),
    };
  }

  async createType(input: CreateDictionaryTypeInput, actorId: string, requestId: string) {
    const code = input.code.trim().toLowerCase();
    const existing = await this.prisma.dictionaryType.findUnique({ where: { code } });
    if (existing) {
      throw new ApiError(ERROR_CODES.dictionaryCodeDuplicated, 'A dictionary type with this code exists.', {
        details: { code: 'validation.conflict' },
      });
    }

    try {
      // The id is returned from inside the transaction and re-read afterwards:
      // reading through `this.prisma` while the transaction is still open would
      // use a different connection and miss the uncommitted row.
      const createdId = await this.withSerializableTransaction(async (tx) => {
        const type = await tx.dictionaryType.create({
          data: {
            code,
            nameKey: input.nameKey,
            description: input.description ?? null,
            enabled: input.enabled,
            // Only the seed or a controlled maintenance flow may lock a type.
            systemLocked: false,
          },
        });
        await this.writeAudit(tx, {
          actorId,
          action: 'dictionary.type.created',
          entityId: type.id,
          requestId,
          metadata: { code, nameKey: input.nameKey },
        });
        return type.id;
      });
      return await this.getType(createdId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiError(ERROR_CODES.dictionaryCodeDuplicated, 'A dictionary type with this code exists.', {
          details: { code: 'validation.conflict' },
        });
      }
      throw error;
    }
  }

  async updateType(
    id: string,
    input: UpdateDictionaryTypeInput,
    actorId: string,
    requestId: string,
  ): Promise<DictionaryTypeSummary> {
    await this.withSerializableTransaction(async (tx) => {
      const type = await tx.dictionaryType.findUnique({ where: { id } });
      if (!type) throw this.typeNotFound();
      // A behaviour-driving type may not be switched off: its items are still
      // referenced by products and filters (docs/20 §7.4).
      if (input.enabled === false && type.systemLocked) {
        assertNotSystemLocked({ systemLocked: true, code: type.code }, 'disable');
      }

      await tx.dictionaryType.update({
        where: { id },
        data: {
          ...(input.nameKey !== undefined ? { nameKey: input.nameKey } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      await this.writeAudit(tx, {
        actorId,
        action: 'dictionary.type.updated',
        entityId: id,
        requestId,
        metadata: { code: type.code, fields: Object.keys(input) },
      });
    });

    return this.getType(id);
  }

  async removeType(id: string, actorId: string, requestId: string) {
    await this.withSerializableTransaction(async (tx) => {
      const type = await tx.dictionaryType.findUnique({
        where: { id },
        include: { _count: { select: { items: true } } },
      });
      if (!type) throw this.typeNotFound();
      assertTypeIsDeletable({
        type,
        itemCount: type._count.items,
        references: 0,
      });
      await tx.dictionaryType.delete({ where: { id } });
      await this.writeAudit(tx, {
        actorId,
        action: 'dictionary.type.deleted',
        entityId: id,
        requestId,
        metadata: { code: type.code, nameKey: type.nameKey },
      });
    });
    return { deleted: true };
  }

  // ---------------------------------------------------------------- item side

  /** Admin item list: every item of the type, with translations and usage. */
  async listItems(typeCode: string, query: DictionaryItemListQueryInput) {
    const type = await this.findTypeByCode(typeCode);
    const keyword = query.keyword?.trim().toLowerCase();
    const items = await this.prisma.dictionaryItem.findMany({
      where: {
        typeId: type.id,
        ...(query.enabled === 'true' ? { enabled: true } : {}),
        ...(query.enabled === 'false' ? { enabled: false } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { translations: true },
    });

    const filtered = keyword
      ? items.filter(
          (item) =>
            item.code.toLowerCase().includes(keyword) ||
            (item.value ?? '').toLowerCase().includes(keyword) ||
            item.translations.some((translation) => translation.label.toLowerCase().includes(keyword)),
        )
      : items;

    const summaries: DictionaryItemSummary[] = [];
    for (const item of filtered) {
      const summary = this.toItemSummary(type.code, item);
      summaries.push({
        ...summary,
        ...(query.includeUsageCount ? { usageCount: await this.countUsage(type.code, item) } : {}),
      });
    }
    return { data: summaries, type: { id: type.id, code: type.code, nameKey: type.nameKey, systemLocked: type.systemLocked } };
  }

  async getItem(id: string): Promise<DictionaryItemSummary> {
    const item = await this.prisma.dictionaryItem.findUnique({
      where: { id },
      include: { translations: true, type: { select: { code: true } } },
    });
    if (!item) throw this.itemNotFound();
    return {
      ...this.toItemSummary(item.type.code, item),
      usageCount: await this.countUsage(item.type.code, item),
    };
  }

  async createItem(
    typeCode: string,
    input: CreateDictionaryItemInput,
    actorId: string,
    requestId: string,
  ) {
    const type = await this.findTypeByCode(typeCode);
    assertItemMutationAllowed({
      typeCode: type.code,
      typeSystemLocked: type.systemLocked,
      action: 'create',
    });
    // The submitted typeCode must match the one in the body when both are sent.
    assertItemBelongsToType({
      expectedTypeCode: type.code,
      actualTypeCode: input.typeCode,
      itemCode: input.code,
      status: 400,
    });

    const code = input.code.trim().toLowerCase();
    const duplicate = await this.prisma.dictionaryItem.findUnique({
      where: { typeId_code: { typeId: type.id, code } },
    });
    if (duplicate) throw this.duplicateCode();

    try {
      return await this.withSerializableTransaction(async (tx) => {
        const item = await tx.dictionaryItem.create({
          data: {
            typeId: type.id,
            code,
            value: input.value ?? null,
            sortOrder: input.sortOrder,
            enabled: input.enabled,
            systemLocked: false,
            translations: { create: toTranslationRows(input.labels) },
          },
          include: { translations: true },
        });
        await this.writeAudit(tx, {
          actorId,
          action: 'dictionary.item.created',
          entityId: item.id,
          requestId,
          metadata: { typeCode: type.code, code, locales: Object.keys(input.labels) },
        });
        return this.toItemSummary(type.code, item);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.duplicateCode();
      throw error;
    }
  }

  async updateItem(
    id: string,
    input: UpdateDictionaryItemInput,
    actorId: string,
    requestId: string,
  ): Promise<DictionaryItemSummary> {
    await this.withSerializableTransaction(async (tx) => {
      const item = await tx.dictionaryItem.findUnique({
        where: { id },
        include: { type: { select: { code: true } } },
      });
      if (!item) throw this.itemNotFound();
      assertExpectedUpdatedAt(input.expectedUpdatedAt, item.updatedAt);
      if (input.enabled === false) {
        assertNotSystemLocked(item, 'disable');
      }

      const labels = input.labels ? toTranslationRows(input.labels) : [];
      for (const label of labels) {
        await tx.dictionaryItemTranslation.upsert({
          where: { itemId_locale: { itemId: id, locale: label.locale } },
          create: { itemId: id, locale: label.locale, label: label.label },
          update: { label: label.label },
        });
      }

      await tx.dictionaryItem.update({
        where: { id },
        data: {
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });

      const enablementOnly =
        input.enabled !== undefined &&
        input.value === undefined &&
        input.sortOrder === undefined &&
        labels.length === 0;
      await this.writeAudit(tx, {
        actorId,
        action: enablementOnly
          ? input.enabled
            ? 'dictionary.item.enabled'
            : 'dictionary.item.disabled'
          : 'dictionary.item.updated',
        entityId: id,
        requestId,
        metadata: {
          typeCode: item.type.code,
          code: item.code,
          locales: labels.map((label) => label.locale),
          enablementOnly,
        },
      });
    });

    return this.getItem(id);
  }

  async reorderItems(
    typeCode: string,
    input: ReorderDictionaryItemsInput,
    actorId: string,
    requestId: string,
  ) {
    await this.withSerializableTransaction(async (tx) => {
      const type = await tx.dictionaryType.findUnique({ where: { code: typeCode } });
      if (!type) throw this.typeNotFound();
      const items = await tx.dictionaryItem.findMany({ where: { typeId: type.id }, select: { id: true } });
      assertReorderIsComplete({ orderedIds: input.orderedIds, itemIds: items.map((item) => item.id) });

      for (const [index, itemId] of input.orderedIds.entries()) {
        await tx.dictionaryItem.update({
          where: { id: itemId },
          data: { sortOrder: (index + 1) * DICTIONARY_REORDER_STEP },
        });
      }
      await this.writeAudit(tx, {
        actorId,
        action: 'dictionary.item.updated',
        entityId: type.id,
        requestId,
        metadata: { typeCode: type.code, reordered: input.orderedIds.length },
      });
    });
    return { reordered: input.orderedIds.length };
  }

  async removeItem(id: string, actorId: string, requestId: string) {
    await this.withSerializableTransaction(async (tx) => {
      const item = await tx.dictionaryItem.findUnique({
        where: { id },
        include: { type: { select: { code: true, systemLocked: true } }, translations: true },
      });
      if (!item) throw this.itemNotFound();

      // Behaviour-driving types keep a fixed item set even when the row itself is
      // not flagged locked (docs/20 §7.4).
      if (isBehaviourLockedType(item.type.code)) {
        assertItemMutationAllowed({
          typeCode: item.type.code,
          typeSystemLocked: item.type.systemLocked,
          action: 'delete',
        });
      }
      assertItemIsDeletable({
        item,
        typeCode: item.type.code,
        usageCount: await this.countUsage(item.type.code, item, tx),
      });

      await tx.dictionaryItem.delete({ where: { id } });
      await this.writeAudit(tx, {
        actorId,
        action: 'dictionary.item.deleted',
        entityId: id,
        requestId,
        metadata: {
          typeCode: item.type.code,
          code: item.code,
          labels: Object.fromEntries(item.translations.map((t) => [t.locale, t.label])),
        },
      });
    });
    return { deleted: true };
  }

  // ------------------------------------------------------------- option side

  /**
   * Business option set for one typeCode (docs/20 §6.3).
   *
   * Enabled items only unless the caller explicitly asks for disabled ones, so
   * editing a historical record can still resolve a now-disabled value.
   */
  async getOptions(typeCode: string, query: DictionaryOptionQueryInput): Promise<DictionaryOptionSet> {
    const type = await this.prisma.dictionaryType.findUnique({
      where: { code: typeCode },
      include: {
        items: {
          where: query.includeDisabled ? {} : { enabled: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          include: { translations: true },
        },
      },
    });
    if (!type) throw this.typeNotFound();

    return {
      type: { code: type.code, nameKey: type.nameKey },
      locale: query.locale,
      items: toOptions(
        type.items.map((item) => ({
          id: item.id,
          code: item.code,
          value: item.value,
          sortOrder: item.sortOrder,
          enabled: item.enabled,
          labels: Object.fromEntries(item.translations.map((t) => [t.locale, t.label])),
        })),
        query.locale,
      ),
    };
  }

  /**
   * Resolves one item of a type by its stable code.
   *
   * Used by business services (product status, ...) to validate that a submitted
   * code exists in the expected type and to obtain the item id it should store.
   * Returns `null` when the type itself is missing, which only happens in an
   * unseeded environment; a missing *item* inside an existing type is a hard
   * error (docs/20 §7.4).
   */
  async resolveItem(
    typeCode: string,
    code: string,
  ): Promise<{ id: string; code: string; enabled: boolean } | null> {
    const type = await this.prisma.dictionaryType.findUnique({
      where: { code: typeCode },
      select: { id: true, code: true },
    });
    if (!type) return null;
    const item = await this.prisma.dictionaryItem.findUnique({
      where: { typeId_code: { typeId: type.id, code } },
      select: { id: true, code: true, enabled: true },
    });
    if (!item) {
      throw new ApiError(
        ERROR_CODES.dictionaryTypeMismatch,
        `${code} is not an item of dictionary type ${typeCode}.`,
        { status: 422, details: { typeCode, code } },
      );
    }
    return item;
  }

  // ----------------------------------------------------------------- helpers

  private toItemSummary(
    typeCode: string,
    item: {
      id: string;
      code: string;
      value: string | null;
      sortOrder: number;
      enabled: boolean;
      systemLocked: boolean;
      updatedAt: Date;
      translations: { locale: string; label: string }[];
    },
  ): DictionaryItemSummary {
    return {
      id: item.id,
      typeCode,
      code: item.code,
      value: item.value,
      sortOrder: item.sortOrder,
      enabled: item.enabled,
      systemLocked: item.systemLocked,
      updatedAt: item.updatedAt.toISOString(),
      labels: Object.fromEntries(item.translations.map((translation) => [translation.locale, translation.label])),
    };
  }

  private typeNotFound(): ApiError {
    return new ApiError(ERROR_CODES.notFound, 'Dictionary type not found.', { status: 404 });
  }

  private itemNotFound(): ApiError {
    return new ApiError(ERROR_CODES.notFound, 'Dictionary item not found.', { status: 404 });
  }

  private duplicateCode(): ApiError {
    return new ApiError(ERROR_CODES.dictionaryCodeDuplicated, 'This item code already exists in the type.', {
      details: { code: 'validation.conflict' },
    });
  }

  private async findTypeByCode(typeCode: string) {
    const type = await this.prisma.dictionaryType.findUnique({ where: { code: typeCode } });
    if (!type) throw this.typeNotFound();
    return type;
  }

  /**
   * Counts business rows referencing one item.
   *
   * Status types use the dictionary foreign keys; classification types match
   * their stable code. Free-text business fields (product packaging, PI payment
   * terms) only carry the displayed text, so an exact-text match is the only
   * honest signal available - it over-counts rather than silently allowing a
   * destructive delete (docs/20 §5.6).
   */
  private async countUsage(
    typeCode: string,
    item: { id: string; code: string; value: string | null; translations: { label: string }[] },
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    switch (typeCode) {
      case DICTIONARY_TYPES.productLifecycle:
        return client.product.count({ where: { lifecycleStatusItemId: item.id } });
      case DICTIONARY_TYPES.productPublishStatus:
        return client.product.count({ where: { publishStatusItemId: item.id } });
      case DICTIONARY_TYPES.adPlacement:
        return client.ad.count({ where: { placement: item.code } });
      case DICTIONARY_TYPES.inquirySource:
        return client.inquiryActivity.count({ where: { source: item.code } });
      default:
        break;
    }

    const texts = [item.value, item.code, ...item.translations.map((t) => t.label)].filter(
      (text): text is string => typeof text === 'string' && text.trim().length > 0,
    );
    if (texts.length === 0) return 0;

    if (typeCode === DICTIONARY_TYPES.packagingType) {
      return client.product.count({ where: { packaging: { in: texts } } });
    }
    if (typeCode === DICTIONARY_TYPES.paymentTerms) {
      return client.piDocument.count({
        where: {
          OR: texts.map((text) => ({
            termsSnapshot: { path: ['paymentTerms'], equals: text },
          })),
        },
      });
    }
    return 0;
  }

  private async withSerializableTransaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === 0 && this.isWriteConflict(error)) continue;
        if (this.isWriteConflict(error)) {
          throw new ApiError(
            ERROR_CODES.conflict,
            'Another administrator changed this dictionary entry at the same time. Reload and retry.',
            { status: 409 },
          );
        }
        throw error;
      }
    }
    throw new ApiError(ERROR_CODES.conflict, 'Concurrent modification detected. Reload and retry.', {
      status: 409,
    });
  }

  private async writeAudit(
    tx: TransactionClient,
    entry: {
      actorId: string;
      action: string;
      entityId: string;
      requestId: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: 'dictionary_item',
          entityId: entry.entityId,
          requestId: entry.requestId,
          metadata: (entry.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      // A dictionary change must never be left unrecorded, so the whole
      // transaction is rolled back when its audit row cannot be written.
      this.logger.error(
        'dictionary.audit_write_failed',
        error instanceof Error ? error.stack : String(error),
        'DictionaryService',
        { action: entry.action, entityId: entry.entityId },
      );
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isWriteConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('could not serialize access');
  }
}

function toTranslationRows(labels: Record<string, string>): { locale: string; label: string }[] {
  return Object.entries(labels)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .map(([locale, label]) => ({ locale, label: label.trim() }))
    .sort((left, right) => left.locale.localeCompare(right.locale));
}
