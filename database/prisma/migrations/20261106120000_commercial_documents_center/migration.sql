-- CreateEnum
CREATE TYPE "CommercialDocumentType" AS ENUM ('PI', 'CI');

-- CreateEnum
CREATE TYPE "CommercialDocumentStatus" AS ENUM ('DRAFT', 'REVIEW', 'ISSUED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DocumentTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "customerType" VARCHAR(16) NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "legalName" VARCHAR(240),
ADD COLUMN     "preferredLanguage" VARCHAR(16) NOT NULL DEFAULT 'en-US',
ADD COLUMN     "taxId" VARCHAR(60),
ADD COLUMN     "website" VARCHAR(500);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "customsDescriptionSnapshot" TEXT,
ADD COLUMN     "hsCodeSnapshot" VARCHAR(20),
ADD COLUMN     "netWeightPerUnitKgSnapshot" DECIMAL(18,6),
ADD COLUMN     "originCountryCodeSnapshot" VARCHAR(2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "buyerCompanyName" VARCHAR(240),
ADD COLUMN     "buyerContactName" VARCHAR(160),
ADD COLUMN     "buyerCountryCode" VARCHAR(2),
ADD COLUMN     "buyerEmail" VARCHAR(254),
ADD COLUMN     "buyerPhoneE164" VARCHAR(24),
ADD COLUMN     "buyerReference" VARCHAR(120),
ADD COLUMN     "buyerSnapshot" JSONB,
ADD COLUMN     "consigneeCountryCode" VARCHAR(2),
ADD COLUMN     "consigneeName" VARCHAR(240),
ADD COLUMN     "consigneeSnapshot" JSONB,
ADD COLUMN     "contractNo" VARCHAR(80),
ADD COLUMN     "notifyPartySnapshot" JSONB,
ADD COLUMN     "tradeSnapshot" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "customsDescription" TEXT,
ADD COLUMN     "exportUnit" VARCHAR(24),
ADD COLUMN     "hsCode" VARCHAR(20),
ADD COLUMN     "netWeightPerUnitKg" DECIMAL(18,6),
ADD COLUMN     "originCountryCode" VARCHAR(2);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "companyName" VARCHAR(240) NOT NULL,
    "contactName" VARCHAR(160),
    "phone" VARCHAR(40),
    "email" VARCHAR(254),
    "taxId" VARCHAR(60),
    "website" VARCHAR(500),
    "address" JSONB NOT NULL,
    "logoAssetId" UUID,
    "stampAssetId" UUID,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account_profiles" (
    "id" UUID NOT NULL,
    "companyProfileId" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "accountHolder" VARCHAR(240) NOT NULL,
    "bankName" VARCHAR(240) NOT NULL,
    "bankAddress" TEXT,
    "accountNumber" VARCHAR(80) NOT NULL,
    "swiftCode" VARCHAR(40),
    "wireRoutingNumber" VARCHAR(40),
    "achRoutingNumber" VARCHAR(40),
    "currencyCode" VARCHAR(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_account_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "documentType" "CommercialDocumentType" NOT NULL,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en-US',
    "paperSize" VARCHAR(16) NOT NULL DEFAULT 'A4',
    "orientation" VARCHAR(16) NOT NULL DEFAULT 'portrait',
    "status" "DocumentTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "draftConfig" JSONB NOT NULL,
    "currentVersionId" UUID,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_template_versions" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocumentTemplateVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "config" JSONB NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "createdById" UUID,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_documents" (
    "id" UUID NOT NULL,
    "documentType" "CommercialDocumentType" NOT NULL,
    "documentNo" VARCHAR(40) NOT NULL,
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "status" "CommercialDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en-US',
    "currency" VARCHAR(3) NOT NULL,
    "issueDate" DATE,
    "validUntil" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "orderId" UUID,
    "templateId" UUID,
    "templateVersionId" UUID,
    "templateVersionNo" INTEGER,
    "createdById" UUID,
    "issuedById" UUID,
    "issuedAt" TIMESTAMPTZ(6),
    "supersedesId" UUID,
    "sellerSnapshot" JSONB NOT NULL,
    "buyerSnapshot" JSONB NOT NULL,
    "consigneeSnapshot" JSONB,
    "notifyPartySnapshot" JSONB,
    "tradeSnapshot" JSONB,
    "shippingSnapshot" JSONB,
    "paymentSnapshot" JSONB,
    "declarationSnapshot" JSONB,
    "signatureSnapshot" JSONB,
    "totalsSnapshot" JSONB NOT NULL,
    "calculationSnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "freightAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "insuranceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pdfFileKey" VARCHAR(500),
    "pdfSha256" VARCHAR(64),
    "pdfSizeBytes" BIGINT,
    "generatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commercial_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_document_items" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID,
    "skuSnapshot" VARCHAR(64) NOT NULL DEFAULT '',
    "descriptionSnapshot" TEXT,
    "hsCodeSnapshot" VARCHAR(20),
    "originCountrySnapshot" VARCHAR(2),
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(24) NOT NULL DEFAULT 'pcs',
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineAmount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "cartons" INTEGER,
    "unitsPerCarton" INTEGER,
    "netWeightKg" DECIMAL(18,6),
    "grossWeightKg" DECIMAL(18,6),
    "cbm" DECIMAL(30,15),
    "packagingSnapshot" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commercial_document_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_render_jobs" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "templateVersionId" UUID,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptId" UUID NOT NULL,
    "fileKey" VARCHAR(500),
    "sha256" VARCHAR(64),
    "sizeBytes" BIGINT,
    "errorCode" VARCHAR(80),
    "requestedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_code_key" ON "company_profiles"("code");

-- CreateIndex
CREATE INDEX "company_profiles_enabled_isDefault_idx" ON "company_profiles"("enabled", "isDefault");

-- CreateIndex
CREATE INDEX "bank_account_profiles_companyProfileId_enabled_sortOrder_idx" ON "bank_account_profiles"("companyProfileId", "enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_code_key" ON "document_templates"("code");

-- CreateIndex
CREATE INDEX "document_templates_documentType_status_isDefault_idx" ON "document_templates"("documentType", "status", "isDefault");

-- CreateIndex
CREATE INDEX "document_template_versions_templateId_publishedAt_idx" ON "document_template_versions"("templateId", "publishedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "document_template_versions_templateId_version_key" ON "document_template_versions"("templateId", "version");

-- CreateIndex
CREATE INDEX "commercial_documents_documentNo_idx" ON "commercial_documents"("documentNo");

-- CreateIndex
CREATE INDEX "commercial_documents_status_createdAt_idx" ON "commercial_documents"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "commercial_documents_orderId_documentType_idx" ON "commercial_documents"("orderId", "documentType");

-- CreateIndex
CREATE INDEX "commercial_documents_supersedesId_idx" ON "commercial_documents"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_documents_documentType_documentNo_revisionNo_key" ON "commercial_documents"("documentType", "documentNo", "revisionNo");

-- CreateIndex
CREATE INDEX "commercial_document_items_documentId_idx" ON "commercial_document_items"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_document_items_documentId_lineNo_key" ON "commercial_document_items"("documentId", "lineNo");

-- CreateIndex
CREATE INDEX "document_render_jobs_status_createdAt_idx" ON "document_render_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "document_render_jobs_documentId_createdAt_idx" ON "document_render_jobs"("documentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_buyerCompanyName_idx" ON "orders"("buyerCompanyName");

-- CreateIndex
CREATE INDEX "orders_buyerCountryCode_idx" ON "orders"("buyerCountryCode");

-- AddForeignKey
ALTER TABLE "bank_account_profiles" ADD CONSTRAINT "bank_account_profiles_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "commercial_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_document_items" ADD CONSTRAINT "commercial_document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "commercial_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_render_jobs" ADD CONSTRAINT "document_render_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "commercial_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_render_jobs" ADD CONSTRAINT "document_render_jobs_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_render_jobs" ADD CONSTRAINT "document_render_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

