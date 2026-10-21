import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { QueueName } from '@b2b/contracts';
import { Queue } from 'bullmq';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ERROR_CODES } from '@b2b/contracts';
import { ApiError } from '../errors/api-error';
import { JsonLogger } from '../logger.service';
import { RedisService } from './redis.service';

// The API only enqueues work; long-running processing happens in the worker so
// no HTTP request blocks on Excel export, image processing or file cleanup
// (docs/02 §3, docs/08).
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly redis: RedisService,
    private readonly logger: JsonLogger,
  ) {}

  private getQueue(name: QueueName): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const connection = this.redis.getClient();
    if (!connection) {
      throw new ApiError(
        ERROR_CODES.jobFailed,
        'Background queue is unavailable: REDIS_URL is not configured.',
      );
    }
    const queue = new Queue(name, {
      connection,
      prefix: this.env.QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: this.env.JOB_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600 * 24 * this.env.JOB_RETENTION_DAYS },
        removeOnFail: { age: 3600 * 24 * 7 },
      },
    });
    this.queues.set(name, queue);
    return queue;
  }

  async enqueue(
    queueName: QueueName,
    payload: Record<string, unknown>,
    options: { jobId?: string; idempotencyKey?: string } = {},
  ): Promise<string> {
    const queue = this.getQueue(queueName);
    try {
      const job = await queue.add(queueName, payload, {
        jobId: options.jobId ?? options.idempotencyKey,
      });
      this.logger.info('job.enqueued', { queue: queueName, jobId: job.id }, 'JobsService');
      return String(job.id);
    } catch (error) {
      this.logger.error(
        'job.enqueue_failed',
        error instanceof Error ? error.message : String(error),
        'JobsService',
        { queue: queueName },
      );
      throw new ApiError(ERROR_CODES.jobFailed, 'Could not enqueue the background task.');
    }
  }

  async getJobState(queueName: QueueName, jobId: string) {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return { state, progress: job.progress ?? 0, error: job.failedReason ?? null };
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close().catch(() => undefined);
    }
    this.queues.clear();
  }
}
