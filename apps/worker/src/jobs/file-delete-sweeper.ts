import { QUEUE_NAMES } from '@b2b/contracts';
import type { PrismaClient } from '@b2b/database';
import type { Queue } from 'bullmq';
import type { WorkerLogger } from '../logger';

interface SweepJobRow {
  id: string;
  storageKey: string | null;
  entityType: string | null;
  entityId: string | null;
  productId: string | null;
}

export interface SweepDeps {
  prisma: PrismaClient;
  queue: Queue;
  logger: WorkerLogger;
  /** Injectable clock so overdue-job selection is deterministic in tests. */
  now?: Date;
  /** Only jobs untouched for this long are considered lost queue messages. */
  staleAfterMs?: number;
  /** How far the claim moves `runAfter` forward before enqueueing. */
  claimDelayMs?: number;
  batchSize?: number;
}

export interface SweepResult {
  found: number;
  enqueued: number;
}

const DEFAULT_STALE_AFTER_MS = 60_000;
const DEFAULT_CLAIM_DELAY_MS = 60_000;
const DEFAULT_BATCH_SIZE = 100;

/**
 * Re-enqueues durable delete jobs whose BullMQ message is missing.
 *
 * The database row, not Redis, is the source of truth (docs/24 §4.3). A Redis
 * restart, a queue outage during the original request, or a failed `add()` must
 * not leave an image in `DELETE_PENDING` and its file on disk forever.
 *
 * Each job is claimed by moving its `runAfter` forward in a conditional update,
 * so concurrent worker processes cannot enqueue the same stale row at the same
 * time. The enqueue itself uses an attempt-specific BullMQ id: BullMQ silently
 * ignores `add()` when the id already exists, which would otherwise make a
 * retry of a previously failed task a no-op.
 */
export async function recoverStaleFileDeletions(deps: SweepDeps): Promise<SweepResult> {
  const now = deps.now ?? new Date();
  const staleAfterMs = deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const claimDelayMs = deps.claimDelayMs ?? DEFAULT_CLAIM_DELAY_MS;
  const staleBefore = new Date(now.getTime() - staleAfterMs);

  const candidates = (await deps.prisma.fileDeletionJob.findMany({
    where: {
      status: 'QUEUED',
      runAfter: { lte: staleBefore },
    },
    orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
    take: deps.batchSize ?? DEFAULT_BATCH_SIZE,
    select: {
      id: true,
      storageKey: true,
      entityType: true,
      entityId: true,
      productId: true,
    },
  })) as SweepJobRow[];

  let enqueued = 0;
  for (const job of candidates) {
    const claimed = await deps.prisma.fileDeletionJob.updateMany({
      where: {
        id: job.id,
        status: 'QUEUED',
        runAfter: { lte: staleBefore },
      },
      data: { runAfter: new Date(now.getTime() + claimDelayMs) },
    });
    if (claimed.count === 0) continue;

    try {
      await deps.queue.add(
        QUEUE_NAMES.fileDelete,
        {
          jobId: job.id,
          storageKey: job.storageKey,
          entityType: job.entityType,
          entityId: job.entityId,
          productId: job.productId,
        },
        { jobId: `file-delete-${job.id}-recover-${now.getTime().toString(36)}` },
      );
      enqueued += 1;
    } catch (error) {
      // The row keeps its key and is picked up again by the next sweep.
      deps.logger.warn('file.delete_recover_enqueue_failed', {
        jobId: job.id,
        entityType: job.entityType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { found: candidates.length, enqueued };
}

export interface SweeperHandle {
  stop(): void;
  /** Runs one sweep immediately; exposed for startup and tests. */
  runOnce(): Promise<SweepResult>;
}

export function startFileDeletionSweeper(deps: SweepDeps & { intervalMs: number }): SweeperHandle {
  let running = false;

  const runOnce = async (): Promise<SweepResult> => {
    if (running) return { found: 0, enqueued: 0 };
    running = true;
    try {
      const result = await recoverStaleFileDeletions(deps);
      if (result.found > 0) {
        deps.logger.info('file.delete_recovered', { ...result });
      }
      return result;
    } finally {
      running = false;
    }
  };

  void runOnce().catch((error: unknown) => {
    deps.logger.error('file.delete_sweep_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const timer = setInterval(() => {
    void runOnce().catch((error: unknown) => {
      deps.logger.error('file.delete_sweep_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, deps.intervalMs);
  timer.unref?.();

  return {
    runOnce,
    stop: () => clearInterval(timer),
  };
}
