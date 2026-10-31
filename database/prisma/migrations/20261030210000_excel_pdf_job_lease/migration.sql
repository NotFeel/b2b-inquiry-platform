-- Add an attempt-scoped conversion lease so two workers cannot mutate the same
-- PDF job concurrently. Existing rows remain valid and are reclaimable because
-- the new lease columns are nullable.

ALTER TABLE "pdf_conversion_jobs"
  ADD COLUMN "leaseOwner" VARCHAR(120),
  ADD COLUMN "leaseUntil" TIMESTAMPTZ(6);

CREATE INDEX "pdf_conversion_jobs_status_leaseUntil_idx"
  ON "pdf_conversion_jobs"("status", "leaseUntil");

-- Rollback (manual): dropping the lease columns restores the previous schema.
-- Rolling back requires stopping all Excel-to-PDF workers first.
-- DROP INDEX "pdf_conversion_jobs_status_leaseUntil_idx";
-- ALTER TABLE "pdf_conversion_jobs" DROP COLUMN "leaseUntil", DROP COLUMN "leaseOwner";
