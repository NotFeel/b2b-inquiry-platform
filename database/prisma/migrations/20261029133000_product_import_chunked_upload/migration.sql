CREATE TABLE "product_import_uploads" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'UPLOADING',
    "originalName" VARCHAR(255) NOT NULL,
    "declaredSize" BIGINT NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "fileSha256" VARCHAR(64),
    "summary" JSONB,
    "errors" JSONB,
    "warnings" JSONB,
    "validationId" UUID,
    "errorCode" VARCHAR(120),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_import_uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_import_chunks" (
    "uploadId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_import_chunks_pkey" PRIMARY KEY ("uploadId", "index")
);

CREATE INDEX "product_import_uploads_actorId_createdAt_idx"
ON "product_import_uploads"("actorId", "createdAt" DESC);

CREATE INDEX "product_import_uploads_status_expiresAt_idx"
ON "product_import_uploads"("status", "expiresAt");

ALTER TABLE "product_import_uploads"
ADD CONSTRAINT "product_import_uploads_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "admin_users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_import_chunks"
ADD CONSTRAINT "product_import_chunks_uploadId_fkey"
FOREIGN KEY ("uploadId") REFERENCES "product_import_uploads"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
