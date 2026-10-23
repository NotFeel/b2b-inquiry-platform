-- Additive lease/claim metadata for the PostgreSQL-backed task runner.
-- Existing BullMQ consumers and historical rows remain valid during rollout.

ALTER TABLE "quote_export_jobs"
  ADD COLUMN "runAfter" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lockedBy" VARCHAR(120),
  ADD COLUMN "lockedUntil" TIMESTAMPTZ(6),
  ADD COLUMN "heartbeatAt" TIMESTAMPTZ(6),
  ADD COLUMN "completedAt" TIMESTAMPTZ(6);

ALTER TABLE "file_deletion_jobs"
  ADD COLUMN "lockedBy" VARCHAR(120),
  ADD COLUMN "lockedUntil" TIMESTAMPTZ(6),
  ADD COLUMN "heartbeatAt" TIMESTAMPTZ(6);

ALTER TABLE "outbox_events"
  ADD COLUMN "lockedBy" VARCHAR(120),
  ADD COLUMN "lockedUntil" TIMESTAMPTZ(6),
  ADD COLUMN "heartbeatAt" TIMESTAMPTZ(6),
  ADD COLUMN "idempotencyKey" VARCHAR(160),
  ADD COLUMN "completedAt" TIMESTAMPTZ(6);

CREATE INDEX "quote_export_jobs_status_runAfter_lockedUntil_idx"
  ON "quote_export_jobs"("status", "runAfter", "lockedUntil");

CREATE INDEX "file_deletion_jobs_status_runAfter_lockedUntil_idx"
  ON "file_deletion_jobs"("status", "runAfter", "lockedUntil");

CREATE INDEX "outbox_events_status_runAfter_lockedUntil_idx"
  ON "outbox_events"("status", "runAfter", "lockedUntil");

CREATE UNIQUE INDEX "outbox_events_idempotencyKey_key"
  ON "outbox_events"("idempotencyKey");

-- Rollback (only after pausing both runners and confirming no process reads
-- the columns):
-- DROP INDEX "outbox_events_idempotencyKey_key";
-- DROP INDEX "outbox_events_status_runAfter_lockedUntil_idx";
-- DROP INDEX "file_deletion_jobs_status_runAfter_lockedUntil_idx";
-- DROP INDEX "quote_export_jobs_status_runAfter_lockedUntil_idx";
-- ALTER TABLE "outbox_events" DROP COLUMN "completedAt", DROP COLUMN "idempotencyKey",
--   DROP COLUMN "heartbeatAt", DROP COLUMN "lockedUntil", DROP COLUMN "lockedBy";
-- ALTER TABLE "file_deletion_jobs" DROP COLUMN "heartbeatAt",
--   DROP COLUMN "lockedUntil", DROP COLUMN "lockedBy";
-- ALTER TABLE "quote_export_jobs" DROP COLUMN "heartbeatAt",
--   DROP COLUMN "lockedUntil", DROP COLUMN "lockedBy", DROP COLUMN "runAfter",
--   DROP COLUMN "completedAt";
