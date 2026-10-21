/**
 * Physical-delete integrity acceptance (docs/24 §4.3, §8.2, §11.2).
 *
 * Exercises the worker's deletion task directly against the real database and a
 * real storage directory, including the two cases the API cannot honestly
 * report through HTTP alone:
 *
 *   1. object storage fails  -> the task is FAILED, the key and the image row
 *      stay, the file is still on disk, and nothing claims a successful delete;
 *   2. a product purge runs before its images are gone -> the product row is
 *      NOT deleted, so the storage keys of the pending images are not lost.
 *
 * Usage (database + storage configured through .env):
 *   pnpm --filter @b2b/worker run acceptance:file-delete
 */

import { existsSync, promises as fs } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { PrismaClient } from '@b2b/database';
import { processFileDeletion } from '../src/jobs/file-delete';
import { WorkerLogger } from '../src/logger';
import { LocalObjectStorage } from '../src/storage';
import type { ObjectStorage } from '../src/storage';

const prisma = new PrismaClient();
const storageRootSetting = process.env.STORAGE_LOCAL_ROOT ?? './.data/uploads';
// Same resolution rule as the worker runtime: a relative setting is resolved
// against the repository root, never against the process working directory.
const storageRoot = isAbsolute(storageRootSetting)
  ? storageRootSetting
  : resolve(process.cwd(), '..', '..', storageRootSetting);
const realStorage = new LocalObjectStorage(storageRoot);

let failures = 0;
let checks = 0;

function record(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

// A quiet logger: the acceptance run asserts on database and disk state, and
// the task's own JSON logs would only add noise.
const logger = new WorkerLogger('error');

function resolveStoragePath(key: string): string {
  return join(storageRoot, key);
}

/** Storage stub that always fails, standing in for an unreachable bucket. */
const failingStorage: ObjectStorage = {
  put: async () => undefined,
  get: async () => Buffer.alloc(0),
  readStream: () => {
    throw new Error('not used');
  },
  exists: async () => true,
  delete: async () => {
    const error = new Error('S3 connection reset') as NodeJS.ErrnoException;
    error.code = 'ECONNRESET';
    throw error;
  },
};

async function main(): Promise<void> {
  const stamp = Date.now().toString(36).slice(-6);
  const category = await prisma.category.create({
    data: {
      code: `qa-filedelete-${stamp}`,
      slug: `qa-filedelete-${stamp}`,
      translations: { create: [{ locale: 'en-US', name: `QA file delete ${stamp}` }] },
    },
    select: { id: true },
  });

  const key = `product-image/qa/${stamp}.png`;
  await fs.mkdir(resolveStoragePath('product-image/qa'), { recursive: true });
  await fs.writeFile(resolveStoragePath(key), Buffer.from('png-bytes-placeholder'));

  const product = await prisma.product.create({
    data: {
      sku: `QA-FD-${stamp}`,
      slug: `qa-fd-${stamp}`,
      categoryId: category.id,
      translations: { create: [{ locale: 'en-US', name: 'QA delete fixture' }] },
      images: { create: [{ storageKey: key, altText: 'fixture', isCover: true }] },
    },
    select: { id: true, images: { select: { id: true } } },
  });
  const imageId = product.images[0]?.id as string;

  // ------------------------------------------------- 1. storage failure path
  const failingJob = await prisma.fileDeletionJob.create({
    data: {
      storageKey: key,
      entityType: 'product_image',
      entityId: imageId,
      productId: product.id,
      status: 'QUEUED',
      idempotencyKey: `acceptance-fail:${stamp}`,
    },
    select: { id: true },
  });

  let threw = false;
  try {
    await processFileDeletion(
      { jobId: failingJob.id, storageKey: key, entityType: 'product_image', entityId: imageId, productId: product.id },
      { prisma, storage: failingStorage, logger, env: null },
    );
  } catch {
    threw = true;
  }
  record('failure.taskRethrown', threw);

  const afterFailure = await prisma.fileDeletionJob.findUnique({ where: { id: failingJob.id } });
  record('failure.jobStaysFailed', afterFailure?.status === 'FAILED', afterFailure?.status ?? '');
  record('failure.errorCodeKept', Boolean(afterFailure?.lastErrorCode), afterFailure?.lastErrorCode ?? '');
  record('failure.keyKept', afterFailure?.storageKey === key);
  const failedImage = await prisma.productImage.findUnique({ where: { id: imageId } });
  record('failure.imageStateDeleteFailed', failedImage?.deleteState === 'DELETE_FAILED');
  record('failure.fileStillOnDisk', existsSync(resolveStoragePath(key)));
  record('failure.noFalseSuccessAudit', (await prisma.auditLog.count({
    where: { entityId: imageId, action: 'product.image.permanent_delete_succeeded' },
  })) === 0);

  // ------------------------------------------ 2. manual retry with healthy storage
  await prisma.fileDeletionJob.update({
    where: { id: failingJob.id },
    data: { status: 'QUEUED', attempts: 0, lastErrorCode: null },
  });
  await processFileDeletion(
    { jobId: failingJob.id, storageKey: key, entityType: 'product_image', entityId: imageId, productId: product.id },
    { prisma, storage: realStorage, logger, env: null },
  );
  const afterRetry = await prisma.fileDeletionJob.findUnique({ where: { id: failingJob.id } });
  record('retry.jobSucceeded', afterRetry?.status === 'SUCCEEDED');
  record('retry.objectGone', !existsSync(resolveStoragePath(key)));
  record('retry.imageRowGone', (await prisma.productImage.count({ where: { id: imageId } })) === 0);
  record('retry.auditRecorded', (await prisma.auditLog.count({
    where: { entityId: imageId, action: 'product.image.permanent_delete_succeeded' },
  })) === 1);

  // Re-running the same task is idempotent: a missing object is a success, not
  // an error, and nothing is recreated.
  await processFileDeletion(
    { jobId: failingJob.id, storageKey: key, entityType: 'product_image', entityId: imageId, productId: product.id },
    { prisma, storage: realStorage, logger, env: null },
  );
  record('retry.idempotent', (await prisma.productImage.count({ where: { id: imageId } })) === 0);

  // --------------------------------------- 3. product purge waits for its images
  const purgeKey = `product-image/qa/${stamp}-purge.png`;
  await fs.writeFile(resolveStoragePath(purgeKey), Buffer.from('png-bytes-placeholder'));
  const purgeImage = await prisma.productImage.create({
    data: { productId: product.id, storageKey: purgeKey, altText: 'purge fixture' },
    select: { id: true },
  });

  const imageJob = await prisma.fileDeletionJob.create({
    data: {
      storageKey: purgeKey,
      entityType: 'product_image',
      entityId: purgeImage.id,
      productId: product.id,
      status: 'QUEUED',
      idempotencyKey: `acceptance-purge-image:${stamp}`,
    },
    select: { id: true },
  });
  const productJob = await prisma.fileDeletionJob.create({
    data: {
      storageKey: null,
      entityType: 'product',
      entityId: product.id,
      productId: product.id,
      status: 'QUEUED',
      idempotencyKey: `acceptance-purge:${stamp}`,
    },
    select: { id: true },
  });

  // The product task runs first on purpose: it must refuse to delete anything
  // while an image object still exists.
  let requeueRequests = 0;
  await processFileDeletion(
    { jobId: productJob.id, storageKey: null, entityType: 'product', entityId: product.id, productId: product.id },
    {
      prisma,
      storage: realStorage,
      logger,
      env: null,
      // A wait is not a failure: the task re-queues itself and keeps its retry
      // budget for real storage errors.
      enqueue: async () => {
        requeueRequests += 1;
      },
    },
  );
  record('purge.requeuedWhileWaiting', requeueRequests === 1);
  record(
    'purge.productKeptWhileImagePending',
    (await prisma.product.count({ where: { id: product.id } })) === 1,
  );
  record('purge.storageKeyStillTracked', Boolean(await prisma.productImage.findUnique({
    where: { id: purgeImage.id },
    select: { storageKey: true },
  })));
  const waitingJob = await prisma.fileDeletionJob.findUnique({ where: { id: productJob.id } });
  record('purge.taskRescheduled', waitingJob?.status === 'QUEUED');

  // Now the image task, then the product task.
  await processFileDeletion(
    { jobId: imageJob.id, storageKey: purgeKey, entityType: 'product_image', entityId: purgeImage.id, productId: product.id },
    { prisma, storage: realStorage, logger, env: null },
  );
  await processFileDeletion(
    { jobId: productJob.id, storageKey: null, entityType: 'product', entityId: product.id, productId: product.id },
    { prisma, storage: realStorage, logger, env: null },
  );
  record('purge.productGoneAfterImages', (await prisma.product.count({ where: { id: product.id } })) === 0);
  record('purge.productObjectGone', !existsSync(resolveStoragePath(purgeKey)));
  record('purge.translationsCascaded', (await prisma.productTranslation.count({
    where: { productId: product.id },
  })) === 0);
  const purgeJob = await prisma.fileDeletionJob.findUnique({ where: { id: productJob.id } });
  record('purge.taskSucceeded', purgeJob?.status === 'SUCCEEDED');

  // ------------------------------------------------------------------ cleanup
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [imageId, purgeImage.id, product.id] } } });
  await prisma.fileDeletionJob.deleteMany({
    where: { id: { in: [failingJob.id, imageJob.id, productJob.id] } },
  });
  await prisma.product.deleteMany({ where: { id: product.id } });
  await prisma.category.deleteMany({ where: { id: category.id } });

  process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
