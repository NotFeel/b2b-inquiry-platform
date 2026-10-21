import { PrismaClient } from '@b2b/database';
import { QUEUE_NAMES } from '@b2b/contracts';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { loadWorkerEnv } from './env';
import { WorkerLogger } from './logger';
import { createStorage } from './storage';
import { processAnalyticsRollup } from './jobs/analytics-rollup';
import { processFileDeletion } from './jobs/file-delete';
import { startFileDeletionSweeper } from './jobs/file-delete-sweeper';
import { processImageDerivatives } from './jobs/image-derivatives';
import { processPdfConversion } from './jobs/pdf-convert';
import { processQuoteExport } from './jobs/quote-export';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = new WorkerLogger(env.LOG_LEVEL);
  const prisma = new PrismaClient();
  const storage = createStorage(env);
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const commonOptions = {
    connection,
    prefix: env.QUEUE_PREFIX,
    concurrency: env.WORKER_CONCURRENCY,
  };

  // The file-delete tasks may need to wait for their own siblings (a product
  // purge waits for the image objects of that product). Re-queueing is done by
  // the worker itself so a wait never burns the task's retry budget - which is
  // reserved for real storage failures (docs/24 §4.3).
  const fileDeleteQueue = new Queue(QUEUE_NAMES.fileDelete, {
    connection,
    prefix: env.QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: env.JOB_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { age: 3600 * 24 * env.JOB_RETENTION_DAYS },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });
  const enqueueFileDelete = async (
    payload: Record<string, unknown>,
    delayMs: number,
  ): Promise<void> => {
    const jobId = payload.jobId;
    await fileDeleteQueue.add(QUEUE_NAMES.fileDelete, payload, {
      delay: delayMs,
      // A distinct id per attempt: BullMQ ignores an add() whose id is already
      // known, which would silently drop this wait-and-retry.
      jobId:
        typeof jobId === 'string' ? `file-delete-${jobId}-r${Date.now().toString(36)}` : undefined,
    });
  };

  const workers: Worker[] = [
    new Worker(
      QUEUE_NAMES.imageDerivatives,
      async (job) => processImageDerivatives(job.data, { prisma, storage, env, logger }),
      commonOptions,
    ),
    new Worker(
      QUEUE_NAMES.quoteExport,
      async (job) => processQuoteExport(job.data, { prisma, storage, env, logger }),
      { ...commonOptions, concurrency: 2 },
    ),
    new Worker(
      QUEUE_NAMES.pdfConvert,
      async (job) => processPdfConversion(job.data, { prisma, storage, env, logger }),
      { ...commonOptions, concurrency: 1 },
    ),
    new Worker(
      QUEUE_NAMES.fileDelete,
      async (job) =>
        processFileDeletion(job.data, { prisma, storage, logger, env, enqueue: enqueueFileDelete }),
      commonOptions,
    ),
    new Worker(
      QUEUE_NAMES.analyticsRollup,
      async (job) => processAnalyticsRollup(job.data, { prisma, logger }),
      { ...commonOptions, concurrency: 1 },
    ),
  ];

  // Redis is a transport, not the source of truth. Re-enqueue durable delete
  // rows whose message disappeared so a product/image delete cannot stay
  // `DELETE_PENDING` forever while its file is still on disk.
  const sweeper = startFileDeletionSweeper({
    prisma,
    queue: fileDeleteQueue,
    logger,
    intervalMs: env.FILE_DELETE_SWEEP_INTERVAL_SECONDS * 1000,
  });

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      logger.error('job.failed', {
        queue: worker.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        message: error.message,
      });
    });
    worker.on('completed', (job) => {
      logger.debug('job.completed', { queue: worker.name, jobId: job.id });
    });
  }

  logger.info('worker.started', {
    queues: workers.map((worker) => worker.name),
    concurrency: env.WORKER_CONCURRENCY,
    storage: env.STORAGE_DRIVER,
  });

  const shutdown = async (signal: string) => {
    logger.info('worker.shutdown', { signal });
    sweeper.stop();
    await Promise.all(workers.map((worker) => worker.close()));
    await fileDeleteQueue.close().catch(() => undefined);
    await connection.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'worker',
      message: 'worker.bootstrap_failed',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
