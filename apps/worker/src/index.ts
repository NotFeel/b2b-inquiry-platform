import { PrismaClient } from '@b2b/database';
import { loadWorkerEnv } from './env';
import { WorkerLogger } from './logger';
import { createStorage } from './storage';
import { PostgresTaskRunner } from './task-runner/runner';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = new WorkerLogger(env.LOG_LEVEL);
  const prisma = new PrismaClient();
  const storage = createStorage(env);
  const runner = new PostgresTaskRunner(prisma, storage, env, logger);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await runner.stop(signal);
    await prisma.$disconnect().catch(() => undefined);
  };
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  });

  await runner.start();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'task-runner',
      message: 'task_runner.bootstrap_failed',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
