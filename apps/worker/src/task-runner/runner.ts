import type { PrismaClient } from '@b2b/database';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import { processAnalyticsRollup } from '../jobs/analytics-rollup';
import { processFileDeletion } from '../jobs/file-delete';
import { processImageDerivatives } from '../jobs/image-derivatives';
import { processQuoteExport } from '../jobs/quote-export';
import { claimNextTask } from './claim';
import type { ClaimedTask, TaskRunnerOptions } from './types';

export class PostgresTaskRunner {
  private stopping = false;
  private currentTask: Promise<void> | null = null;
  private readonly options: TaskRunnerOptions;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly env: WorkerEnv,
    private readonly logger: WorkerLogger,
  ) {
    this.options = {
      workerId: env.TASK_RUNNER_ID,
      maxAttempts: env.JOB_MAX_ATTEMPTS,
      leaseSeconds: env.TASK_LEASE_SECONDS,
      pollIntervalMs: env.TASK_POLL_INTERVAL_MS,
      retryBaseDelayMs: env.TASK_RETRY_BASE_DELAY_MS,
    };
  }

  async start(): Promise<void> {
    await failExhaustedExpiredTasks(this.prisma, this.options);
    this.logger.info('task_runner.started', {
      workerId: this.options.workerId,
      maxAttempts: this.options.maxAttempts,
      leaseSeconds: this.options.leaseSeconds,
      pollIntervalMs: this.options.pollIntervalMs,
    });

    while (!this.stopping) {
      try {
        const processed = await this.runOnce();
        if (!processed) {
          await sleep(this.options.pollIntervalMs);
          continue;
        }
      } catch (error) {
        this.logger.error('task_runner.loop_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(Math.max(this.options.pollIntervalMs, 2_000));
      }
    }
    await this.currentTask;
  }

  /** Executes at most one claim; useful for startup probes and acceptance tests. */
  async runOnce(): Promise<boolean> {
    await ensureScheduledTasks(this.prisma, this.env);
    const task = await claimNextTask(this.prisma, this.options);
    if (!task) return false;
    this.currentTask = this.execute(task);
    try {
      await this.currentTask;
    } finally {
      this.currentTask = null;
    }
    return true;
  }

  async stop(signal: string): Promise<void> {
    this.stopping = true;
    this.logger.info('task_runner.stopping', { signal });
    await this.currentTask;
  }

  private async execute(task: ClaimedTask): Promise<void> {
    const startedAt = Date.now();
    const heartbeat = this.startHeartbeat(task);
    this.logger.info('task_runner.claimed', {
      taskId: task.id,
      source: task.source,
      eventType: 'eventType' in task ? task.eventType : task.source,
      attempts: task.attempts,
    });

    try {
      await this.dispatch(task);
      await completeTask(this.prisma, task);
      this.logger.info('task_runner.completed', {
        taskId: task.id,
        source: task.source,
        attempts: task.attempts,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry = task.attempts < this.options.maxAttempts;
      await failTask(
        this.prisma,
        task,
        message,
        retry,
        nextRetryAt(task.attempts, this.options.retryBaseDelayMs),
      );
      this.logger.error(retry ? 'task_runner.retry_scheduled' : 'task_runner.failed', {
        taskId: task.id,
        source: task.source,
        attempts: task.attempts,
        maxAttempts: this.options.maxAttempts,
        durationMs: Date.now() - startedAt,
        errorCode: errorCodeOf(error),
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async dispatch(task: ClaimedTask): Promise<void> {
    if (task.source === 'file_delete') {
      await processFileDeletion(task.payload, {
        prisma: this.prisma,
        storage: this.storage,
        logger: this.logger,
        env: this.env,
      });
      return;
    }
    if (task.source === 'quote_export') {
      await processQuoteExport(task.payload, {
        prisma: this.prisma,
        storage: this.storage,
        env: this.env,
        logger: this.logger,
      });
      return;
    }
    if (task.eventType === 'image-derivatives') {
      await processImageDerivatives(
        {
          ...task.payload,
          attemptsMade: task.attempts - 1,
          maxAttempts: this.options.maxAttempts,
        },
        {
          prisma: this.prisma,
          storage: this.storage,
          env: this.env,
          logger: this.logger,
        },
      );
      return;
    }
    await processAnalyticsRollup(task.payload, {
      prisma: this.prisma,
      logger: this.logger,
    });
  }

  private startHeartbeat(task: ClaimedTask): NodeJS.Timeout {
    const intervalMs = Math.max(1_000, Math.floor((this.options.leaseSeconds * 1000) / 3));
    const timer = setInterval(() => {
      void heartbeatTask(this.prisma, task, this.options);
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}

async function completeTask(prisma: PrismaClient, task: ClaimedTask): Promise<void> {
  const table = tableFor(task);
  const completion =
    task.source === 'outbox'
      ? ', "completedAt" = now(), "processedAt" = now()'
      : `, "completedAt" = CASE
           WHEN status = 'PROCESSING'::"JobStatus"
             THEN COALESCE("completedAt", now())
           ELSE "completedAt"
         END`;
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}"
     SET status = CASE
           WHEN status = 'PROCESSING'::"JobStatus" THEN 'SUCCEEDED'::"JobStatus"
           ELSE status
         END,
         "lockedBy" = NULL,
         "lockedUntil" = NULL,
         "heartbeatAt" = NULL,
         "updatedAt" = now()
         ${completion}
     WHERE id = $1::uuid`,
    task.id,
  );
}

async function failTask(
  prisma: PrismaClient,
  task: ClaimedTask,
  message: string,
  retry: boolean,
  retryAt: Date,
): Promise<void> {
  const table = tableFor(task);
  const errorColumn = table === 'quote_export_jobs' ? 'errorCode' : 'lastErrorCode';
  const code = message.slice(0, 120);
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}"
     SET status = $2::"JobStatus",
         "runAfter" = $3,
         "lockedBy" = NULL,
         "lockedUntil" = NULL,
         "heartbeatAt" = NULL,
         "${errorColumn}" = $4,
         "updatedAt" = now()
     WHERE id = $1::uuid`,
    task.id,
    retry ? 'QUEUED' : 'FAILED',
    retryAt,
    code,
  );
}

async function heartbeatTask(
  prisma: PrismaClient,
  task: ClaimedTask,
  options: TaskRunnerOptions,
): Promise<void> {
  const table = tableFor(task);
  const leaseUntil = new Date(Date.now() + options.leaseSeconds * 1000);
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}"
       SET "lockedUntil" = $1, "heartbeatAt" = now(), "updatedAt" = now()
       WHERE id = $2::uuid
         AND status = 'PROCESSING'::"JobStatus"
         AND "lockedBy" = $3`,
      leaseUntil,
      task.id,
      options.workerId,
    );
  } catch {
    // A transient heartbeat failure does not stop the current task. The lease
    // remains the recovery boundary if this runner crashes.
  }
}

async function failExhaustedExpiredTasks(
  prisma: PrismaClient,
  options: TaskRunnerOptions,
): Promise<void> {
  for (const table of ['file_deletion_jobs', 'quote_export_jobs', 'outbox_events'] as const) {
    const errorColumn = table === 'quote_export_jobs' ? 'errorCode' : 'lastErrorCode';
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}"
       SET status = 'FAILED'::"JobStatus",
           "lockedBy" = NULL,
           "lockedUntil" = NULL,
           "heartbeatAt" = NULL,
           "${errorColumn}" = COALESCE("${errorColumn}", 'TASK_LEASE_EXPIRED'),
           "updatedAt" = now()
       WHERE status = 'PROCESSING'::"JobStatus"
         AND attempts >= $1
         AND ("lockedUntil" IS NULL OR "lockedUntil" < now())`,
      options.maxAttempts,
    );
  }
}

function tableFor(task: ClaimedTask): 'file_deletion_jobs' | 'quote_export_jobs' | 'outbox_events' {
  if (task.source === 'file_delete') return 'file_deletion_jobs';
  if (task.source === 'quote_export') return 'quote_export_jobs';
  return 'outbox_events';
}

function nextRetryAt(attempts: number, baseDelayMs: number): Date {
  const exponent = Math.max(0, attempts - 1);
  const base = Math.min(baseDelayMs * 2 ** exponent, 15 * 60_000);
  const jitter = Math.floor(Math.random() * Math.max(250, base * 0.2));
  return new Date(Date.now() + base + jitter);
}

function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return (code ? `TASK_${code}` : error.message).slice(0, 120);
  }
  return String(error).slice(0, 120);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureScheduledTasks(prisma: PrismaClient, env: WorkerEnv): Promise<void> {
  const yesterday = new Date(Date.now() - 86_400_000);
  yesterday.setUTCHours(0, 0, 0, 0);
  const date = yesterday.toISOString().slice(0, 10);
  await prisma.outboxEvent.upsert({
    where: { idempotencyKey: `analytics-rollup:${date}` },
    create: {
      eventType: 'analytics-rollup',
      payload: {
        retentionDays: env.ANALYTICS_RAW_RETENTION_DAYS,
        targetDate: yesterday.toISOString(),
      } as never,
      status: 'QUEUED',
      idempotencyKey: `analytics-rollup:${date}`,
    },
    update: {},
  });
}
