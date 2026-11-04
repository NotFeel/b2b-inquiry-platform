-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'CONVERTED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "pi_documents" ADD COLUMN     "orderId" UUID;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "contactName" VARCHAR(160),
ADD COLUMN     "defaultShippingAddress" JSONB,
ADD COLUMN     "email" VARCHAR(254);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "quotationNo" VARCHAR(40) NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "customerId" UUID,
    "createdById" UUID,
    "quotedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMPTZ(6),
    "currencyCode" VARCHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(24,12) NOT NULL,
    "exchangeRateDate" DATE NOT NULL,
    "exchangeRateSource" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "exchangeRateEnteredById" UUID,
    "roundingMode" VARCHAR(16) NOT NULL DEFAULT 'CEIL_2',
    "calculationVersion" VARCHAR(24) NOT NULL DEFAULT '1',
    "subtotalCny" DECIMAL(24,8) NOT NULL,
    "freightCny" DECIMAL(24,8) NOT NULL,
    "deliveryFeeCny" DECIMAL(24,8) NOT NULL,
    "otherFeesCny" DECIMAL(24,8) NOT NULL,
    "totalAmountCny" DECIMAL(24,8) NOT NULL,
    "totalAmountForeignExact" DECIMAL(30,12) NOT NULL,
    "totalAmountForeign" DECIMAL(24,2) NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "calculationSnapshot" JSONB NOT NULL,
    "convertedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID,
    "skuSnapshot" VARCHAR(64) NOT NULL,
    "productNameSnapshot" VARCHAR(240) NOT NULL,
    "descriptionSnapshot" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(24) NOT NULL DEFAULT 'pcs',
    "costCny" DECIMAL(18,4) NOT NULL,
    "markupPercent" DECIMAL(8,4) NOT NULL,
    "unitSalePriceCny" DECIMAL(24,8) NOT NULL,
    "lineAmountCny" DECIMAL(24,8) NOT NULL,
    "cartonCount" INTEGER,
    "unitsPerCarton" INTEGER,
    "cartonLengthCm" DECIMAL(12,3),
    "cartonWidthCm" DECIMAL(12,3),
    "cartonHeightCm" DECIMAL(12,3),
    "cartonGrossWeightKg" DECIMAL(12,6),
    "volumetricDivisor" INTEGER,
    "totalVolumeWeightKg" DECIMAL(20,8) NOT NULL,
    "totalGrossWeightKg" DECIMAL(20,8) NOT NULL,
    "freightAllocationBasis" DECIMAL(20,8) NOT NULL,
    "allocatedFreightCny" DECIMAL(24,8) NOT NULL,
    "allocatedFreightForeign" DECIMAL(24,2) NOT NULL,
    "unitSalePriceForeign" DECIMAL(24,8) NOT NULL,
    "lineAmountForeign" DECIMAL(24,2) NOT NULL,
    "productDataSnapshot" JSONB NOT NULL,
    "packagingSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_fees" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "feeTypeCode" VARCHAR(60) NOT NULL,
    "nameSnapshot" VARCHAR(160) NOT NULL,
    "amountCny" DECIMAL(24,8) NOT NULL,
    "amountForeign" DECIMAL(24,2) NOT NULL,
    "isFreight" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "orderNo" VARCHAR(40) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "sourceQuotationId" UUID,
    "sourceQuotationRevision" INTEGER,
    "customerId" UUID,
    "createdById" UUID,
    "orderDate" DATE NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currencyCode" VARCHAR(3) NOT NULL,
    "exchangeRate" DECIMAL(24,12) NOT NULL,
    "exchangeRateDate" DATE NOT NULL,
    "exchangeRateSource" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "roundingMode" VARCHAR(16) NOT NULL DEFAULT 'CEIL_2',
    "calculationVersion" VARCHAR(24) NOT NULL DEFAULT '1',
    "subtotalCny" DECIMAL(24,8) NOT NULL,
    "freightCny" DECIMAL(24,8) NOT NULL,
    "deliveryFeeCny" DECIMAL(24,8) NOT NULL,
    "otherFeesCny" DECIMAL(24,8) NOT NULL,
    "totalAmountCny" DECIMAL(24,8) NOT NULL,
    "totalAmountForeignExact" DECIMAL(30,12) NOT NULL,
    "totalAmountForeign" DECIMAL(24,2) NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "billingAddressSnapshot" JSONB,
    "shippingAddressSnapshot" JSONB NOT NULL,
    "calculationSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID,
    "skuSnapshot" VARCHAR(64) NOT NULL,
    "productNameSnapshot" VARCHAR(240) NOT NULL,
    "descriptionSnapshot" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(24) NOT NULL DEFAULT 'pcs',
    "costCny" DECIMAL(18,4) NOT NULL,
    "markupPercent" DECIMAL(8,4) NOT NULL,
    "unitSalePriceCny" DECIMAL(24,8) NOT NULL,
    "lineAmountCny" DECIMAL(24,8) NOT NULL,
    "cartonCount" INTEGER,
    "unitsPerCarton" INTEGER,
    "cartonLengthCm" DECIMAL(12,3),
    "cartonWidthCm" DECIMAL(12,3),
    "cartonHeightCm" DECIMAL(12,3),
    "cartonGrossWeightKg" DECIMAL(12,6),
    "volumetricDivisor" INTEGER,
    "totalVolumeWeightKg" DECIMAL(20,8) NOT NULL,
    "totalGrossWeightKg" DECIMAL(20,8) NOT NULL,
    "freightAllocationBasis" DECIMAL(20,8) NOT NULL,
    "allocatedFreightCny" DECIMAL(24,8) NOT NULL,
    "allocatedFreightForeign" DECIMAL(24,2) NOT NULL,
    "unitSalePriceForeign" DECIMAL(24,8) NOT NULL,
    "lineAmountForeign" DECIMAL(24,2) NOT NULL,
    "productDataSnapshot" JSONB NOT NULL,
    "packagingSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_fees" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "feeTypeCode" VARCHAR(60) NOT NULL,
    "nameSnapshot" VARCHAR(160) NOT NULL,
    "amountCny" DECIMAL(24,8) NOT NULL,
    "amountForeign" DECIMAL(24,2) NOT NULL,
    "isFreight" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotationNo_key" ON "quotations"("quotationNo");

-- CreateIndex
CREATE INDEX "quotations_status_createdAt_idx" ON "quotations"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "quotations_customerId_createdAt_idx" ON "quotations"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "quotation_items_productId_idx" ON "quotation_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_items_quotationId_lineNo_key" ON "quotation_items"("quotationId", "lineNo");

-- CreateIndex
CREATE INDEX "quotation_fees_quotationId_isFreight_idx" ON "quotation_fees"("quotationId", "isFreight");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_fees_quotationId_lineNo_key" ON "quotation_fees"("quotationId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "orders_sourceQuotationId_key" ON "orders"("sourceQuotationId");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_lineNo_key" ON "order_items"("orderId", "lineNo");

-- CreateIndex
CREATE INDEX "order_fees_orderId_isFreight_idx" ON "order_fees"("orderId", "isFreight");

-- CreateIndex
CREATE UNIQUE INDEX "order_fees_orderId_lineNo_key" ON "order_fees"("orderId", "lineNo");

-- AddForeignKey
ALTER TABLE "pi_documents" ADD CONSTRAINT "pi_documents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_exchangeRateEnteredById_fkey" FOREIGN KEY ("exchangeRateEnteredById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_fees" ADD CONSTRAINT "quotation_fees_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sourceQuotationId_fkey" FOREIGN KEY ("sourceQuotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

