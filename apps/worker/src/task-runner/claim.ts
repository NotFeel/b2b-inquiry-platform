import type {
  AnalyticsRollupJobPayload,
  FileDeleteJobPayload,
  ImageDerivativeJobPayload,
  QuoteExportJobPayload,
} from '@b2b/contracts';
import type { PrismaClient } from '@b2b/database';
import type { ClaimedTask, TaskRunnerOptions } from './types';

interface FileDeleteRow {
  id: string;
  storageKey: string | null;
  entityType: string | null;
  entityId: string | null;
  productId: string | null;
  attempts: number;
}

interface QuoteExportRow {
  id: string;
  templateId: string;
  templateVersion: number;
  filterSnapshot: unknown;
  attempts: number;
}

interface OutboxRow {
  id: string;
  eventType: string;
  payload: unknown;
  attempts: number;
}

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Claims one task atomically.
 *
 * The database row is the only queue truth. External work starts only after
 * this transaction commits, so no R2/Sharp/Excel operation runs under a row
 * lock. Expired `PROCESSING` leases are claimable again after a runner crash.
 */
export async function claimNextTask(
  prisma: PrismaClient,
  options: TaskRunnerOptions,
): Promise<ClaimedTask | null> {
  return prisma.$transaction(async (transaction) => {
    const fileDelete = await claimFileDeletion(transaction, options);
    if (fileDelete) return fileDelete;

    const quoteExport = await claimQuoteExport(transaction, options);
    if (quoteExport) return quoteExport;

    return claimOutboxEvent(transaction, options);
  });
}

async function claimFileDeletion(
  transaction: TransactionClient,
  options: TaskRunnerOptions,
): Promise<ClaimedTask | null> {
  const rows = await transaction.$queryRaw<FileDeleteRow[]>`
    SELECT id, "storageKey", "entityType", "entityId", "productId", attempts
    FROM file_deletion_jobs
    WHERE (
      (status = 'QUEUED'::"JobStatus" AND "runAfter" <= now())
      OR (
        status = 'PROCESSING'::"JobStatus"
        AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
      )
    )
    ORDER BY "runAfter" ASC, "createdAt" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const claimed = await claimRow(transaction, 'file_deletion_jobs', row.id, options);
  if (!claimed) return null;
  return {
    source: 'file_delete',
    id: row.id,
    attempts: claimed.attempts,
    payload: {
      jobId: row.id,
      storageKey: row.storageKey,
      entityType: row.entityType,
      entityId: row.entityId,
      productId: row.productId,
    } satisfies FileDeleteJobPayload,
  };
}

async function claimQuoteExport(
  transaction: TransactionClient,
  options: TaskRunnerOptions,
): Promise<ClaimedTask | null> {
  const rows = await transaction.$queryRaw<QuoteExportRow[]>`
    SELECT id, "templateId", "templateVersion", "filterSnapshot", attempts
    FROM quote_export_jobs
    WHERE (
      (status = 'QUEUED'::"JobStatus" AND "runAfter" <= now())
      OR (
        status = 'PROCESSING'::"JobStatus"
        AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
      )
    )
    ORDER BY "runAfter" ASC, "createdAt" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const claimed = await claimRow(transaction, 'quote_export_jobs', row.id, options);
  if (!claimed) return null;
  return {
    source: 'quote_export',
    id: row.id,
    attempts: claimed.attempts,
    payload: quotePayload(row),
  };
}

async function claimOutboxEvent(
  transaction: TransactionClient,
  options: TaskRunnerOptions,
): Promise<ClaimedTask | null> {
  const rows = await transaction.$queryRaw<OutboxRow[]>`
    SELECT id, "eventType", payload, attempts
    FROM outbox_events
    WHERE "eventType" IN ('image-derivatives', 'analytics-rollup')
      AND (
        (status = 'QUEUED'::"JobStatus" AND "runAfter" <= now())
        OR (
          status = 'PROCESSING'::"JobStatus"
          AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
        )
      )
    ORDER BY "runAfter" ASC, "createdAt" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const claimed = await claimRow(transaction, 'outbox_events', row.id, options);
  if (!claimed) return null;
  if (row.eventType === 'image-derivatives') {
    return {
      source: 'outbox',
      id: row.id,
      attempts: claimed.attempts,
      eventType: 'image-derivatives',
      payload: row.payload as ImageDerivativeJobPayload,
    };
  }
  if (row.eventType === 'analytics-rollup') {
    return {
      source: 'outbox',
      id: row.id,
      attempts: claimed.attempts,
      eventType: 'analytics-rollup',
      payload: row.payload as AnalyticsRollupJobPayload,
    };
  }
  return null;
}

async function claimRow(
  transaction: TransactionClient,
  table: 'file_deletion_jobs' | 'quote_export_jobs' | 'outbox_events',
  id: string,
  options: TaskRunnerOptions,
): Promise<{ attempts: number } | null> {
  const leaseUntil = new Date(Date.now() + options.leaseSeconds * 1000);
  const errorColumn = table === 'quote_export_jobs' ? 'errorCode' : 'lastErrorCode';
  const result = await transaction.$queryRawUnsafe<{ attempts: number }[]>(
    `UPDATE "${table}"
     SET status = 'PROCESSING'::"JobStatus",
         attempts = attempts + 1,
         "lockedBy" = $1,
         "lockedUntil" = $2,
         "heartbeatAt" = now(),
         "${errorColumn}" = NULL,
         "updatedAt" = now()
     WHERE id = $3::uuid
     RETURNING attempts`,
    options.workerId,
    leaseUntil,
    id,
  );
  return result[0] ?? null;
}

function quotePayload(row: QuoteExportRow): QuoteExportJobPayload {
  const snapshot = isRecord(row.filterSnapshot) ? row.filterSnapshot : {};
  return {
    jobId: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    locale: typeof snapshot.locale === 'string' ? snapshot.locale : 'en-US',
    filter: {
      categoryId: typeof snapshot.categoryId === 'string' ? snapshot.categoryId : null,
      includeDescendants:
        typeof snapshot.includeDescendants === 'boolean' ? snapshot.includeDescendants : true,
      publishStatus:
        typeof snapshot.publishStatus === 'string' ? snapshot.publishStatus : undefined,
      lifecycleStatus:
        typeof snapshot.lifecycleStatus === 'string' ? snapshot.lifecycleStatus : undefined,
      tag: typeof snapshot.tag === 'string' ? snapshot.tag : undefined,
      search: typeof snapshot.search === 'string' ? snapshot.search : undefined,
      piDocumentId: typeof snapshot.piDocumentId === 'string' ? snapshot.piDocumentId : undefined,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
