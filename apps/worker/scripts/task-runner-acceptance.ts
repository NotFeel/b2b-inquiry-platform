import { PrismaClient } from '@b2b/database';
import { loadWorkerEnv } from '../src/env';
import { WorkerLogger } from '../src/logger';
import { createStorage } from '../src/storage';
import { claimNextTask } from '../src/task-runner/claim';
import { PostgresTaskRunner } from '../src/task-runner/runner';

const env = loadWorkerEnv();
const databaseHost = new URL(env.DATABASE_URL).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
  throw new Error('Task-runner acceptance refuses non-local DATABASE_URL.');
}

const prisma = new PrismaClient();
const options = {
  workerId: 'acceptance-a',
  maxAttempts: 3,
  leaseSeconds: 120,
  pollIntervalMs: 1_000,
  retryBaseDelayMs: 1_000,
};
const createdIds: string[] = [];
let cleanupScheduledKey: string | null = null;
let checks = 0;
let failures = 0;

function record(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

async function claimableCount(): Promise<number> {
  const [files, quotes, outbox] = await Promise.all([
    prisma.fileDeletionJob.count({ where: { status: 'QUEUED', runAfter: { lte: new Date() } } }),
    prisma.quoteExportJob.count({ where: { status: 'QUEUED', runAfter: { lte: new Date() } } }),
    prisma.outboxEvent.count({
      where: {
        status: 'QUEUED',
        runAfter: { lte: new Date() },
        eventType: { in: ['image-derivatives', 'analytics-rollup'] },
      },
    }),
  ]);
  return files + quotes + outbox;
}

async function main(): Promise<void> {
  const existing = await claimableCount();
  record('baseline.noPendingTasks', existing === 0, String(existing));
  if (existing > 0) {
    throw new Error('Refusing to claim pre-existing tasks during acceptance.');
  }

  const stamp = Date.now().toString(36);
  for (const suffix of ['a', 'b', 'c', 'd']) {
    const row = await prisma.fileDeletionJob.create({
      data: {
        storageKey: `private/acceptance/${stamp}-${suffix}.bin`,
        entityType: 'acceptance',
        entityId: `${stamp}-${suffix}`,
        status: 'QUEUED',
        idempotencyKey: `acceptance:task-runner:${stamp}:${suffix}`,
      },
      select: { id: true },
    });
    createdIds.push(row.id);
  }

  const first = await Promise.all(
    ['a', 'b', 'c', 'd'].map((suffix) =>
      claimNextTask(prisma, { ...options, workerId: `acceptance-runner-${suffix}` }),
    ),
  );
  const claimedIds = first.flatMap((task) => (task ? [task.id] : []));
  record(
    'claim.concurrentRunnersClaimAllTasks',
    claimedIds.length === 4,
    `claimed=${claimedIds.length} ids=${claimedIds.join(',')}`,
  );
  record('claim.noDuplicateClaim', new Set(claimedIds).size === claimedIds.length);

  const claimedRows = await prisma.fileDeletionJob.findMany({
    where: { id: { in: createdIds } },
    select: { id: true, status: true, attempts: true, lockedBy: true, lockedUntil: true },
  });
  record(
    'claim.statusProcessing',
    claimedRows.every((row) => row.status === 'PROCESSING'),
  );
  record(
    'claim.attemptIncremented',
    claimedRows.every((row) => row.attempts === 1),
  );
  record(
    'claim.leaseRecorded',
    claimedRows.every((row) => Boolean(row.lockedBy && row.lockedUntil)),
  );

  const expiredAt = new Date(Date.now() - 1_000);
  await prisma.fileDeletionJob.updateMany({
    where: { id: { in: createdIds } },
    data: { lockedUntil: expiredAt },
  });
  const recovered = await claimNextTask(prisma, {
    ...options,
    workerId: 'acceptance-runner-c',
  });
  record('lease.expiredTaskRecovered', recovered !== null);
  record('lease.recoveredTaskIncremented', Boolean(recovered && recovered.attempts === 2));

  await prisma.fileDeletionJob.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;

  const storage = createStorage(env);
  const storageKey = `private/acceptance/${stamp}-runner.bin`;
  await storage.put(storageKey, Buffer.from('runner-acceptance'), 'application/octet-stream');
  const executableTask = await prisma.fileDeletionJob.create({
    data: {
      storageKey,
      entityType: 'file_asset',
      entityId: `runner-${stamp}`,
      status: 'QUEUED',
      idempotencyKey: `acceptance:task-runner:${stamp}:execute`,
    },
    select: { id: true },
  });
  createdIds.push(executableTask.id);

  const yesterday = new Date(Date.now() - 86_400_000);
  yesterday.setUTCHours(0, 0, 0, 0);
  const scheduledKey = `analytics-rollup:${yesterday.toISOString().slice(0, 10)}`;
  const scheduledExisted = Boolean(
    await prisma.outboxEvent.findUnique({ where: { idempotencyKey: scheduledKey } }),
  );
  if (!scheduledExisted) cleanupScheduledKey = scheduledKey;
  const runner = new PostgresTaskRunner(
    prisma,
    storage,
    { ...env, TASK_RUNNER_ID: `acceptance-runner-${stamp}` },
    new WorkerLogger('error'),
  );
  record('runner.claimedExecutableTask', await runner.runOnce());
  const executed = await prisma.fileDeletionJob.findUnique({
    where: { id: executableTask.id },
    select: { status: true, lockedBy: true, lockedUntil: true },
  });
  record('runner.taskSucceeded', executed?.status === 'SUCCEEDED');
  record('runner.lockCleared', executed?.lockedBy === null && executed?.lockedUntil === null);
  record('runner.objectDeleted', !(await storage.exists(storageKey)));

  const retryKey = `private/acceptance/${stamp}-runner-retry.bin`;
  await storage.put(retryKey, Buffer.from('runner-retry'), 'application/octet-stream');
  const retryTask = await prisma.fileDeletionJob.create({
    data: {
      storageKey: retryKey,
      entityType: 'file_asset',
      entityId: `runner-retry-${stamp}`,
      status: 'QUEUED',
      idempotencyKey: `acceptance:task-runner:${stamp}:retry`,
    },
    select: { id: true },
  });
  createdIds.push(retryTask.id);
  const failingStorage = {
    put: storage.put.bind(storage),
    get: storage.get.bind(storage),
    readStream: storage.readStream.bind(storage),
    exists: storage.exists.bind(storage),
    delete: async () => {
      throw new Error('acceptance storage timeout');
    },
  };
  const retryRunner = new PostgresTaskRunner(
    prisma,
    failingStorage,
    { ...env, TASK_RUNNER_ID: `acceptance-retry-${stamp}` },
    new WorkerLogger('error'),
  );
  record('runner.retryExecutionAttempted', await retryRunner.runOnce());
  const retryQueued = await prisma.fileDeletionJob.findUnique({
    where: { id: retryTask.id },
    select: { status: true, attempts: true, lastErrorCode: true, runAfter: true },
  });
  record('runner.retryQueued', retryQueued?.status === 'QUEUED');
  record('runner.retryAttemptCounted', retryQueued?.attempts === 1);
  record('runner.retryErrorKept', Boolean(retryQueued?.lastErrorCode));
  record('runner.retryObjectKept', await storage.exists(retryKey));

  await prisma.fileDeletionJob.update({
    where: { id: retryTask.id },
    data: { runAfter: new Date() },
  });
  record('runner.retryRecovered', await runner.runOnce());
  const retried = await prisma.fileDeletionJob.findUnique({
    where: { id: retryTask.id },
    select: { status: true },
  });
  record('runner.retrySucceeded', retried?.status === 'SUCCEEDED');
  record('runner.retryObjectDeleted', !(await storage.exists(retryKey)));

  process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
  if (failures > 0) process.exitCode = 1;
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdIds.length > 0) {
      await prisma.fileDeletionJob.deleteMany({ where: { id: { in: createdIds } } });
    }
    if (cleanupScheduledKey) {
      await prisma.outboxEvent.deleteMany({ where: { idempotencyKey: cleanupScheduledKey } });
    }
    await prisma.$disconnect();
  });
