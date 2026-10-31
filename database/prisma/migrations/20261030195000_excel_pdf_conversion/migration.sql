-- Reintroduce Excel-to-PDF as an additive feature (docs/38).
-- Existing pdf_conversion_jobs rows retain their source asset and output key;
-- every new column is nullable or has a safe default.

ALTER TABLE "pdf_conversion_jobs"
  ADD COLUMN "uploadId" UUID,
  ADD COLUMN "outputAssetId" UUID,
  ADD COLUMN "businessType" VARCHAR(32) NOT NULL DEFAULT 'other',
  ADD COLUMN "options" JSONB,
  ADD COLUMN "attemptId" UUID,
  ADD COLUMN "inputSizeBytes" BIGINT,
  ADD COLUMN "inputSha256" VARCHAR(64),
  ADD COLUMN "errorMessageKey" VARCHAR(160),
  ADD COLUMN "purgeState" "PurgeState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "purgeRequestedAt" TIMESTAMPTZ(6),
  ADD COLUMN "startedAt" TIMESTAMPTZ(6),
  ADD COLUMN "completedAt" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "pdf_conversion_jobs_uploadId_key"
  ON "pdf_conversion_jobs"("uploadId");
CREATE UNIQUE INDEX "pdf_conversion_jobs_outputAssetId_key"
  ON "pdf_conversion_jobs"("outputAssetId");
CREATE INDEX "pdf_conversion_jobs_expiresAt_purgeState_idx"
  ON "pdf_conversion_jobs"("expiresAt", "purgeState");

ALTER TABLE "pdf_conversion_jobs"
  ADD CONSTRAINT "pdf_conversion_jobs_outputAssetId_fkey"
  FOREIGN KEY ("outputAssetId") REFERENCES "file_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "excel_pdf_uploads" (
  "id" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'UPLOADING',
  "originalName" VARCHAR(255) NOT NULL,
  "declaredSize" BIGINT NOT NULL,
  "chunkSize" INTEGER NOT NULL,
  "chunkCount" INTEGER NOT NULL,
  "businessType" VARCHAR(32) NOT NULL DEFAULT 'other',
  "options" JSONB NOT NULL,
  "jobId" UUID,
  "errorCode" VARCHAR(120),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "excel_pdf_uploads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "excel_pdf_uploads_idempotencyKey_key"
  ON "excel_pdf_uploads"("idempotencyKey");
CREATE UNIQUE INDEX "excel_pdf_uploads_jobId_key"
  ON "excel_pdf_uploads"("jobId");
CREATE INDEX "excel_pdf_uploads_actorId_createdAt_idx"
  ON "excel_pdf_uploads"("actorId", "createdAt" DESC);
CREATE INDEX "excel_pdf_uploads_status_expiresAt_idx"
  ON "excel_pdf_uploads"("status", "expiresAt");

ALTER TABLE "excel_pdf_uploads"
  ADD CONSTRAINT "excel_pdf_uploads_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "admin_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "excel_pdf_upload_chunks" (
  "uploadId" UUID NOT NULL,
  "index" INTEGER NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "excel_pdf_upload_chunks_pkey" PRIMARY KEY ("uploadId", "index")
);

ALTER TABLE "excel_pdf_upload_chunks"
  ADD CONSTRAINT "excel_pdf_upload_chunks_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "excel_pdf_uploads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Sanity checks run before commit. A failed assertion aborts the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pdf_conversion_jobs"
    WHERE "sourceAssetId" IS NULL
  ) THEN
    RAISE EXCEPTION 'pdf_conversion_jobs contains rows without sourceAssetId';
  END IF;
END $$;

-- Rollback (manual, additive columns/tables only):
-- DROP TABLE "excel_pdf_upload_chunks";
-- DROP TABLE "excel_pdf_uploads";
-- ALTER TABLE "pdf_conversion_jobs" DROP CONSTRAINT "pdf_conversion_jobs_outputAssetId_fkey";
-- DROP INDEX "pdf_conversion_jobs_expiresAt_purgeState_idx";
-- DROP INDEX "pdf_conversion_jobs_outputAssetId_key";
-- DROP INDEX "pdf_conversion_jobs_uploadId_key";
-- ALTER TABLE "pdf_conversion_jobs" DROP COLUMN ...;
