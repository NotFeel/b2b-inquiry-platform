CREATE TABLE "product_import_validations" (
    "id" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "actorId" UUID NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "templateVersion" VARCHAR(32) NOT NULL,
    "configHash" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "imageCount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_import_validations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_import_validations_tokenHash_key"
ON "product_import_validations"("tokenHash");

CREATE INDEX "product_import_validations_actorId_expiresAt_idx"
ON "product_import_validations"("actorId", "expiresAt");

CREATE INDEX "product_import_validations_expiresAt_idx"
ON "product_import_validations"("expiresAt");

ALTER TABLE "product_import_validations"
ADD CONSTRAINT "product_import_validations_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "admin_users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
