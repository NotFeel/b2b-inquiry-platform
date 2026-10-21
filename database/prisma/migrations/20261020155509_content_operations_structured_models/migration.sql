-- CreateTable
CREATE TABLE "factory_media" (
    "id" UUID NOT NULL,
    "mediaType" VARCHAR(20) NOT NULL,
    "assetId" UUID,
    "coverAssetId" UUID,
    "videoSourceType" VARCHAR(20),
    "videoUrl" VARCHAR(1000),
    "sourceNote" TEXT,
    "adminNote" TEXT,
    "placements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(6),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "factory_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_media_translations" (
    "mediaId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "altText" VARCHAR(240),

    CONSTRAINT "factory_media_translations_pkey" PRIMARY KEY ("mediaId","locale")
);

-- CreateTable
CREATE TABLE "factory_process_steps" (
    "id" UUID NOT NULL,
    "assetId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(6),
    "adminNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "factory_process_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_process_step_translations" (
    "stepId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,

    CONSTRAINT "factory_process_step_translations_pkey" PRIMARY KEY ("stepId","locale")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "credentialTypeCode" VARCHAR(100) NOT NULL,
    "issuer" VARCHAR(240),
    "credentialNumber" VARCHAR(160),
    "issuedAt" DATE,
    "validFrom" DATE,
    "validUntil" DATE,
    "validityType" VARCHAR(20) NOT NULL DEFAULT 'not_specified',
    "showExpiredBadge" BOOLEAN NOT NULL DEFAULT true,
    "primaryAssetId" UUID,
    "additionalAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verificationUrl" VARCHAR(1000),
    "placements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(6),
    "adminNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_translations" (
    "credentialId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "verificationLabel" VARCHAR(120),

    CONSTRAINT "credential_translations_pkey" PRIMARY KEY ("credentialId","locale")
);

-- CreateTable
CREATE TABLE "home_sections" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "displayLimit" INTEGER NOT NULL DEFAULT 4,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "itemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ctaUrl" VARCHAR(1000),
    "adminNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_section_translations" (
    "sectionId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "ctaLabel" VARCHAR(120),

    CONSTRAINT "home_section_translations_pkey" PRIMARY KEY ("sectionId","locale")
);

-- CreateIndex
CREATE INDEX "factory_media_status_sortOrder_idx" ON "factory_media"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "factory_media_mediaType_status_idx" ON "factory_media"("mediaType", "status");

-- CreateIndex
CREATE INDEX "factory_process_steps_status_sortOrder_idx" ON "factory_process_steps"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "credentials_status_sortOrder_idx" ON "credentials"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "credentials_credentialTypeCode_status_idx" ON "credentials"("credentialTypeCode", "status");

-- CreateIndex
CREATE INDEX "credentials_validUntil_idx" ON "credentials"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "home_sections_code_key" ON "home_sections"("code");

-- CreateIndex
CREATE INDEX "home_sections_enabled_sortOrder_idx" ON "home_sections"("enabled", "sortOrder");

-- AddForeignKey
ALTER TABLE "factory_media" ADD CONSTRAINT "factory_media_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_media" ADD CONSTRAINT "factory_media_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_media" ADD CONSTRAINT "factory_media_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_media_translations" ADD CONSTRAINT "factory_media_translations_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "factory_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_process_steps" ADD CONSTRAINT "factory_process_steps_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_process_steps" ADD CONSTRAINT "factory_process_steps_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_process_step_translations" ADD CONSTRAINT "factory_process_step_translations_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "factory_process_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_primaryAssetId_fkey" FOREIGN KEY ("primaryAssetId") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_translations" ADD CONSTRAINT "credential_translations_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_section_translations" ADD CONSTRAINT "home_section_translations_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "home_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
