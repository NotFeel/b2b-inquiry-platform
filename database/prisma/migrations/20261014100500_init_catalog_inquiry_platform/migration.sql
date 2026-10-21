-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "ProductLifecycleStatus" AS ENUM ('AVAILABLE', 'PREORDER', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurgeState" AS ENUM ('NONE', 'PENDING', 'PURGED', 'FAILED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "userAgent" VARCHAR(255),
    "ipHash" VARCHAR(128),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "nameKey" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(120) NOT NULL,
    "nameKey" VARCHAR(180) NOT NULL,
    "module" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionCode" VARCHAR(120) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "parentId" UUID,
    "route" VARCHAR(240),
    "icon" VARCHAR(60),
    "permissionCode" VARCHAR(120),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "external" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_translations" (
    "menuId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "label" VARCHAR(160) NOT NULL,

    CONSTRAINT "menu_translations_pkey" PRIMARY KEY ("menuId","locale")
);

-- CreateTable
CREATE TABLE "dictionary_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "nameKey" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "systemLocked" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dictionary_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_items" (
    "id" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "value" VARCHAR(240),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "systemLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dictionary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_item_translations" (
    "itemId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "label" VARCHAR(160) NOT NULL,

    CONSTRAINT "dictionary_item_translations_pkey" PRIMARY KEY ("itemId","locale")
);

-- CreateTable
CREATE TABLE "global_settings" (
    "key" VARCHAR(160) NOT NULL,
    "value" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "global_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "parentId" UUID,
    "coverFileAssetId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_translations" (
    "categoryId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "description" TEXT,

    CONSTRAINT "category_translations_pkey" PRIMARY KEY ("categoryId","locale")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "categoryId" UUID,
    "priceCny" DECIMAL(18,4),
    "lifecycleStatus" "ProductLifecycleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "publishStatus" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "weightGrams" INTEGER,
    "packaging" VARCHAR(500),
    "cartonLengthCm" INTEGER,
    "cartonWidthCm" INTEGER,
    "cartonHeightCm" INTEGER,
    "cartonWeightKg" DECIMAL(12,3),
    "cartonQuantity" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_translations" (
    "productId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "seoTitle" VARCHAR(240),
    "seoDescription" VARCHAR(400),

    CONSTRAINT "product_translations_pkey" PRIMARY KEY ("productId","locale")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "colorToken" VARCHAR(60),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_translations" (
    "tagId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "label" VARCHAR(100) NOT NULL,

    CONSTRAINT "tag_translations_pkey" PRIMARY KEY ("tagId","locale")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "productId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "fileAssetId" UUID,
    "storageKey" VARCHAR(500) NOT NULL,
    "altText" VARCHAR(240),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" BIGINT,
    "sha256" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" VARCHAR(64),
    "width" INTEGER,
    "height" INTEGER,
    "purpose" VARCHAR(40) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'processing',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "derivatives" JSONB,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "placement" VARCHAR(100) NOT NULL,
    "desktopAssetId" UUID,
    "mobileAssetId" UUID,
    "targetUrl" VARCHAR(1000),
    "activeFrom" TIMESTAMPTZ(6),
    "activeTo" TIMESTAMPTZ(6),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_translations" (
    "adId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(240),
    "description" TEXT,

    CONSTRAINT "ad_translations_pkey" PRIMARY KEY ("adId","locale")
);

-- CreateTable
CREATE TABLE "content_pages" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "pageType" VARCHAR(40) NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "content_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_page_translations" (
    "pageId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "bodyHtml" TEXT,
    "seoTitle" VARCHAR(240),
    "seoDescription" VARCHAR(400),

    CONSTRAINT "content_page_translations_pkey" PRIMARY KEY ("pageId","locale")
);

-- CreateTable
CREATE TABLE "faq_items" (
    "id" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_translations" (
    "faqId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "answer" TEXT NOT NULL,

    CONSTRAINT "faq_translations_pkey" PRIMARY KEY ("faqId","locale")
);

-- CreateTable
CREATE TABLE "quote_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "templateType" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storageKey" VARCHAR(500) NOT NULL,
    "sheetName" VARCHAR(120),
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "itemStartRow" INTEGER NOT NULL DEFAULT 2,
    "fieldMapping" JSONB NOT NULL,
    "validationReport" JSONB,
    "status" VARCHAR(24) NOT NULL DEFAULT 'draft',
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quote_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_export_jobs" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "requestedById" UUID NOT NULL,
    "filterSnapshot" JSONB NOT NULL,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "fileKey" VARCHAR(500),
    "fileSha256" VARCHAR(64),
    "fileSizeBytes" BIGINT,
    "errorCode" VARCHAR(100),
    "purgeState" "PurgeState" NOT NULL DEFAULT 'NONE',
    "purgeRequestedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quote_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_conversion_jobs" (
    "id" UUID NOT NULL,
    "sourceAssetId" UUID NOT NULL,
    "sourceFileName" VARCHAR(255) NOT NULL,
    "sheetName" VARCHAR(120),
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "outputKey" VARCHAR(500),
    "outputSizeBytes" BIGINT,
    "outputSha256" VARCHAR(64),
    "pageCount" INTEGER,
    "errorCode" VARCHAR(100),
    "expiresAt" TIMESTAMPTZ(6),
    "requestedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pdf_conversion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pi_documents" (
    "id" UUID NOT NULL,
    "piNo" VARCHAR(100) NOT NULL,
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "currency" VARCHAR(3) NOT NULL,
    "issuedAt" TIMESTAMPTZ(6),
    "validUntil" TIMESTAMPTZ(6),
    "sellerSnapshot" JSONB NOT NULL,
    "buyerSnapshot" JSONB NOT NULL,
    "termsSnapshot" JSONB,
    "pricingPolicy" JSONB,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "freightAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "insuranceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "supersedesId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pi_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pi_items" (
    "id" UUID NOT NULL,
    "piDocumentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "productNameSnapshot" VARCHAR(240) NOT NULL,
    "descriptionSnapshot" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(24) NOT NULL DEFAULT 'pcs',
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineAmount" DECIMAL(18,4) NOT NULL,
    "packagingSnapshot" JSONB,
    "currency" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pi_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "phoneE164" VARCHAR(24) NOT NULL,
    "countryCode" VARCHAR(2),
    "displayName" VARCHAR(180),
    "note" TEXT,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_activities" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "salespersonUserId" UUID,
    "salespersonName" VARCHAR(160) NOT NULL,
    "salespersonPhone" VARCHAR(24),
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "productSkus" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "source" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inquiry_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_intents" (
    "id" UUID NOT NULL,
    "skus" JSONB NOT NULL DEFAULT '[]',
    "skuCount" INTEGER NOT NULL DEFAULT 0,
    "sourcePath" VARCHAR(1000),
    "locale" VARCHAR(16) NOT NULL,
    "sessionHash" VARCHAR(128),
    "countryCode" VARCHAR(2),
    "customerId" UUID,
    "activityId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_sessions" (
    "id" UUID NOT NULL,
    "sessionHash" VARCHAR(128) NOT NULL,
    "countryCode" VARCHAR(2),
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "visitor_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_views" (
    "id" UUID NOT NULL,
    "visitorSessionId" UUID,
    "path" VARCHAR(1000) NOT NULL,
    "referrerHost" VARCHAR(255),
    "countryCode" VARCHAR(2),
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "visitorSessionId" UUID,
    "eventName" VARCHAR(80) NOT NULL,
    "path" VARCHAR(1000),
    "countryCode" VARCHAR(2),
    "metadata" JSONB,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_daily_aggregates" (
    "id" UUID NOT NULL,
    "eventDate" DATE NOT NULL,
    "countryCode" VARCHAR(2) NOT NULL,
    "metricCode" VARCHAR(80) NOT NULL,
    "metricValue" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "country_daily_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(120),
    "requestId" VARCHAR(120),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_deletion_jobs" (
    "id" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "entityType" VARCHAR(100),
    "entityId" VARCHAR(120),
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "file_deletion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" VARCHAR(120),
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE INDEX "admin_users_status_username_idx" ON "admin_users"("status", "username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_userId_expiresAt_idx" ON "admin_sessions"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "role_permissions_permissionCode_idx" ON "role_permissions"("permissionCode");

-- CreateIndex
CREATE UNIQUE INDEX "menus_code_key" ON "menus"("code");

-- CreateIndex
CREATE INDEX "menus_parentId_sortOrder_idx" ON "menus"("parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_types_code_key" ON "dictionary_types"("code");

-- CreateIndex
CREATE INDEX "dictionary_items_typeId_enabled_sortOrder_idx" ON "dictionary_items"("typeId", "enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_items_typeId_code_key" ON "dictionary_items"("typeId", "code");

-- CreateIndex
CREATE INDEX "global_settings_isPublic_idx" ON "global_settings"("isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_sortOrder_idx" ON "categories"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "categories_enabled_visible_idx" ON "categories"("enabled", "visible");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_publishStatus_lifecycleStatus_idx" ON "products"("categoryId", "publishStatus", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "products_publishStatus_isFeatured_sortOrder_idx" ON "products"("publishStatus", "isFeatured", "sortOrder");

-- CreateIndex
CREATE INDEX "products_publishStatus_isNew_sortOrder_idx" ON "products"("publishStatus", "isNew", "sortOrder");

-- CreateIndex
CREATE INDEX "products_publishStatus_lifecycleStatus_sortOrder_idx" ON "products"("publishStatus", "lifecycleStatus", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "tags_code_key" ON "tags"("code");

-- CreateIndex
CREATE INDEX "product_tags_tagId_idx" ON "product_tags"("tagId");

-- CreateIndex
CREATE INDEX "product_images_productId_sortOrder_idx" ON "product_images"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_storageKey_key" ON "file_assets"("storageKey");

-- CreateIndex
CREATE INDEX "file_assets_status_createdAt_idx" ON "file_assets"("status", "createdAt");

-- CreateIndex
CREATE INDEX "file_assets_purpose_createdAt_idx" ON "file_assets"("purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ads_code_key" ON "ads"("code");

-- CreateIndex
CREATE INDEX "ads_placement_enabled_activeFrom_activeTo_idx" ON "ads"("placement", "enabled", "activeFrom", "activeTo");

-- CreateIndex
CREATE UNIQUE INDEX "content_pages_slug_key" ON "content_pages"("slug");

-- CreateIndex
CREATE INDEX "content_pages_status_sortOrder_idx" ON "content_pages"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "faq_items_enabled_sortOrder_idx" ON "faq_items"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "quote_templates_templateType_status_idx" ON "quote_templates"("templateType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_templates_name_version_key" ON "quote_templates"("name", "version");

-- CreateIndex
CREATE INDEX "quote_export_jobs_requestedById_createdAt_idx" ON "quote_export_jobs"("requestedById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "quote_export_jobs_status_createdAt_idx" ON "quote_export_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "quote_export_jobs_purgeState_purgeRequestedAt_idx" ON "quote_export_jobs"("purgeState", "purgeRequestedAt");

-- CreateIndex
CREATE INDEX "pdf_conversion_jobs_status_createdAt_idx" ON "pdf_conversion_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pdf_conversion_jobs_requestedById_createdAt_idx" ON "pdf_conversion_jobs"("requestedById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pi_documents_status_createdAt_idx" ON "pi_documents"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pi_documents_piNo_idx" ON "pi_documents"("piNo");

-- CreateIndex
CREATE UNIQUE INDEX "pi_documents_piNo_revisionNo_key" ON "pi_documents"("piNo", "revisionNo");

-- CreateIndex
CREATE INDEX "pi_items_sku_idx" ON "pi_items"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "pi_items_piDocumentId_lineNo_key" ON "pi_items"("piDocumentId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phoneE164_key" ON "customers"("phoneE164");

-- CreateIndex
CREATE INDEX "customers_countryCode_idx" ON "customers"("countryCode");

-- CreateIndex
CREATE INDEX "customers_lastSeenAt_idx" ON "customers"("lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "inquiry_activities_customerId_occurredAt_idx" ON "inquiry_activities"("customerId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "inquiry_activities_occurredAt_idx" ON "inquiry_activities"("occurredAt" DESC);

-- CreateIndex
CREATE INDEX "inquiry_intents_createdAt_idx" ON "inquiry_intents"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "inquiry_intents_customerId_idx" ON "inquiry_intents"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "visitor_sessions_sessionHash_key" ON "visitor_sessions"("sessionHash");

-- CreateIndex
CREATE INDEX "visitor_sessions_lastSeenAt_idx" ON "visitor_sessions"("lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "visitor_sessions_countryCode_lastSeenAt_idx" ON "visitor_sessions"("countryCode", "lastSeenAt");

-- CreateIndex
CREATE INDEX "page_views_occurredAt_idx" ON "page_views"("occurredAt" DESC);

-- CreateIndex
CREATE INDEX "page_views_countryCode_occurredAt_idx" ON "page_views"("countryCode", "occurredAt");

-- CreateIndex
CREATE INDEX "page_views_path_occurredAt_idx" ON "page_views"("path", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_events_eventName_occurredAt_idx" ON "analytics_events"("eventName", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "analytics_events_occurredAt_idx" ON "analytics_events"("occurredAt" DESC);

-- CreateIndex
CREATE INDEX "country_daily_aggregates_metricCode_eventDate_idx" ON "country_daily_aggregates"("metricCode", "eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "country_daily_aggregates_eventDate_countryCode_metricCode_key" ON "country_daily_aggregates"("eventDate", "countryCode", "metricCode");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "file_deletion_jobs_status_runAfter_idx" ON "file_deletion_jobs"("status", "runAfter");

-- CreateIndex
CREATE INDEX "file_deletion_jobs_storageKey_idx" ON "file_deletion_jobs"("storageKey");

-- CreateIndex
CREATE INDEX "outbox_events_status_runAfter_idx" ON "outbox_events"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "menus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_translations" ADD CONSTRAINT "menu_translations_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_items" ADD CONSTRAINT "dictionary_items_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "dictionary_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_item_translations" ADD CONSTRAINT "dictionary_item_translations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "dictionary_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_coverFileAssetId_fkey" FOREIGN KEY ("coverFileAssetId") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_translations" ADD CONSTRAINT "tag_translations_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_desktopAssetId_fkey" FOREIGN KEY ("desktopAssetId") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_mobileAssetId_fkey" FOREIGN KEY ("mobileAssetId") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_translations" ADD CONSTRAINT "ad_translations_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_page_translations" ADD CONSTRAINT "content_page_translations_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "content_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_translations" ADD CONSTRAINT "faq_translations_faqId_fkey" FOREIGN KEY ("faqId") REFERENCES "faq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_templates" ADD CONSTRAINT "quote_templates_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_export_jobs" ADD CONSTRAINT "quote_export_jobs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "quote_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_export_jobs" ADD CONSTRAINT "quote_export_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_conversion_jobs" ADD CONSTRAINT "pdf_conversion_jobs_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_conversion_jobs" ADD CONSTRAINT "pdf_conversion_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pi_documents" ADD CONSTRAINT "pi_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pi_items" ADD CONSTRAINT "pi_items_piDocumentId_fkey" FOREIGN KEY ("piDocumentId") REFERENCES "pi_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_activities" ADD CONSTRAINT "inquiry_activities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_activities" ADD CONSTRAINT "inquiry_activities_salespersonUserId_fkey" FOREIGN KEY ("salespersonUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_intents" ADD CONSTRAINT "inquiry_intents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_visitorSessionId_fkey" FOREIGN KEY ("visitorSessionId") REFERENCES "visitor_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_visitorSessionId_fkey" FOREIGN KEY ("visitorSessionId") REFERENCES "visitor_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

