-- Product image physical-deletion state and an honest delete outbox
-- (docs/24 §4.3-§4.4, §5.2, §8.2).
--
-- Purely additive and backward compatible:
--   * `product_images.deleteState` defaults to READY, so every existing row is
--     immediately usable and publicly visible exactly as before.
--   * `file_deletion_jobs` keeps every existing row and column; the new columns
--     are nullable and the `storage_key` NOT NULL is relaxed so an aggregate
--     purge task (the product finaliser) can exist without inventing a key.
-- No row is rewritten, deleted or moved.
--
-- Reused outbox: the project already had `file_deletion_jobs` consumed by the
-- `file-delete` worker queue, so this migration extends it instead of adding a
-- second, parallel deletion queue (docs/24 §4.3 "must reuse an existing outbox").

-- ---------------------------------------------------------------- expand

-- Every existing image is a functioning, publicly reachable image.
ALTER TABLE "product_images"
  ADD COLUMN "deleteState" VARCHAR(32) NOT NULL DEFAULT 'READY';

-- The catalogue and the public projector filter on this pair.
CREATE INDEX "product_images_productId_deleteState_idx"
  ON "product_images" ("productId", "deleteState");

-- The product purge task has no single object key of its own: it waits for its
-- image tasks and then removes the product row. Existing rows all have a key.
ALTER TABLE "file_deletion_jobs"
  ALTER COLUMN "storageKey" DROP NOT NULL;

ALTER TABLE "file_deletion_jobs"
  ADD COLUMN "productId" UUID,
  ADD COLUMN "requestedBy" UUID,
  ADD COLUMN "idempotencyKey" VARCHAR(160),
  ADD COLUMN "completedAt" TIMESTAMPTZ(6);

-- One queued/executing delete per object: a repeated DELETE request or a double
-- click must not enqueue the same physical delete twice (docs/24 §8.3).
CREATE UNIQUE INDEX "file_deletion_jobs_idempotencyKey_key"
  ON "file_deletion_jobs" ("idempotencyKey");

CREATE INDEX "file_deletion_jobs_entityType_entityId_idx"
  ON "file_deletion_jobs" ("entityType", "entityId");

CREATE INDEX "file_deletion_jobs_productId_status_idx"
  ON "file_deletion_jobs" ("productId", "status");

-- ------------------------------------------------------------- backfill

-- No data backfill is required: `deleteState` defaults to READY for images that
-- are still in storage, and pre-existing `file_deletion_jobs` rows already
-- describe their own object key with `entityType`/`entityId`.
--
-- Verification queries (run on the target database after the migration):
--   SELECT "deleteState", count(*) FROM "product_images" GROUP BY 1;
--   SELECT count(*) FROM "product_images" i
--     LEFT JOIN "file_assets" a ON a."id" = i."fileAssetId"
--     WHERE i."fileAssetId" IS NOT NULL
--       AND (a."id" IS NULL OR a."storageKey" <> i."storageKey");
--   SELECT count(*) FROM "file_deletion_jobs" WHERE "status" IN ('QUEUED','PROCESSING');

-- --------------------------------------------------------------- rollback

-- Rollback is only safe once no physical delete is in flight: dropping
-- `idempotencyKey`/`productId` would orphan the running tasks' clues.
--   DROP INDEX IF EXISTS "file_deletion_jobs_productId_status_idx";
--   DROP INDEX IF EXISTS "file_deletion_jobs_entityType_entityId_idx";
--   DROP INDEX IF EXISTS "file_deletion_jobs_idempotencyKey_key";
--   DELETE FROM "file_deletion_jobs" WHERE "storageKey" IS NULL;
--   ALTER TABLE "file_deletion_jobs"
--     ALTER COLUMN "storageKey" SET NOT NULL,
--     DROP COLUMN "completedAt", DROP COLUMN "idempotencyKey",
--     DROP COLUMN "requestedBy", DROP COLUMN "productId";
--   DROP INDEX IF EXISTS "product_images_productId_deleteState_idx";
--   ALTER TABLE "product_images" DROP COLUMN "deleteState";
