-- Store the CBM and KG freight quotes together and keep one divisor snapshot
-- per quotation/order. Existing per-item divisor columns remain for legacy rows.
CREATE TYPE "FreightBillingMethod" AS ENUM ('CBM', 'KG');
CREATE TYPE "KgChargeableBasis" AS ENUM ('VOLUME_WEIGHT', 'GROSS_WEIGHT');

ALTER TABLE "quotations"
  ADD COLUMN "freightBillingMethod" "FreightBillingMethod",
  ADD COLUMN "freightCurrencyCode" VARCHAR(3),
  ADD COLUMN "cbmRatePerCbm" DECIMAL(24,8),
  ADD COLUMN "orderTotalCbm" DECIMAL(30,15),
  ADD COLUMN "cbmFreightAmount" DECIMAL(24,2),
  ADD COLUMN "kgRatePerKg" DECIMAL(24,8),
  ADD COLUMN "volumetricDivisorItemId" UUID,
  ADD COLUMN "volumetricDivisorCode" VARCHAR(100),
  ADD COLUMN "volumetricDivisorValue" INTEGER,
  ADD COLUMN "orderTotalVolumeWeightKg" DECIMAL(24,12),
  ADD COLUMN "orderTotalGrossWeightKg" DECIMAL(24,12),
  ADD COLUMN "chargeableWeightKg" DECIMAL(24,12),
  ADD COLUMN "kgChargeableBasis" "KgChargeableBasis",
  ADD COLUMN "kgFreightAmount" DECIMAL(24,2),
  ADD COLUMN "selectedFreightAmount" DECIMAL(24,2),
  ADD COLUMN "freightAllocationSnapshot" JSONB;

ALTER TABLE "orders"
  ADD COLUMN "freightBillingMethod" "FreightBillingMethod",
  ADD COLUMN "freightCurrencyCode" VARCHAR(3),
  ADD COLUMN "cbmRatePerCbm" DECIMAL(24,8),
  ADD COLUMN "orderTotalCbm" DECIMAL(30,15),
  ADD COLUMN "cbmFreightAmount" DECIMAL(24,2),
  ADD COLUMN "kgRatePerKg" DECIMAL(24,8),
  ADD COLUMN "volumetricDivisorItemId" UUID,
  ADD COLUMN "volumetricDivisorCode" VARCHAR(100),
  ADD COLUMN "volumetricDivisorValue" INTEGER,
  ADD COLUMN "orderTotalVolumeWeightKg" DECIMAL(24,12),
  ADD COLUMN "orderTotalGrossWeightKg" DECIMAL(24,12),
  ADD COLUMN "chargeableWeightKg" DECIMAL(24,12),
  ADD COLUMN "kgChargeableBasis" "KgChargeableBasis",
  ADD COLUMN "kgFreightAmount" DECIMAL(24,2),
  ADD COLUMN "selectedFreightAmount" DECIMAL(24,2),
  ADD COLUMN "freightAllocationSnapshot" JSONB;

ALTER TABLE "quotation_items"
  ADD COLUMN "cartonVolumeCbm" DECIMAL(30,15),
  ADD COLUMN "totalCbm" DECIMAL(30,15);

ALTER TABLE "order_items"
  ADD COLUMN "cartonVolumeCbm" DECIMAL(30,15),
  ADD COLUMN "totalCbm" DECIMAL(30,15);

-- Widen the existing item snapshots so division by the configured integer
-- divisor and CBM allocation can retain calculation precision in NUMERIC.
ALTER TABLE "quotation_items"
  ALTER COLUMN "totalVolumeWeightKg" TYPE DECIMAL(24,12),
  ALTER COLUMN "totalGrossWeightKg" TYPE DECIMAL(24,12),
  ALTER COLUMN "freightAllocationBasis" TYPE DECIMAL(30,15);
ALTER TABLE "order_items"
  ALTER COLUMN "totalVolumeWeightKg" TYPE DECIMAL(24,12),
  ALTER COLUMN "totalGrossWeightKg" TYPE DECIMAL(24,12),
  ALTER COLUMN "freightAllocationBasis" TYPE DECIMAL(30,15);

CREATE INDEX "quotations_volumetricDivisorItemId_idx"
  ON "quotations"("volumetricDivisorItemId");
CREATE INDEX "orders_volumetricDivisorItemId_idx"
  ON "orders"("volumetricDivisorItemId");

ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_volumetricDivisorItemId_fkey"
    FOREIGN KEY ("volumetricDivisorItemId") REFERENCES "dictionary_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_volumetricDivisorItemId_fkey"
    FOREIGN KEY ("volumetricDivisorItemId") REFERENCES "dictionary_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- This is an additive migration. Roll back the application first. Only drop
-- these columns/types after confirming no quotation/order uses the new freight
-- snapshots; keep the legacy per-item divisor columns and their historical data.
-- SELECT count(*) FROM "quotations" WHERE "freightBillingMethod" IS NOT NULL;
-- SELECT count(*) FROM "orders" WHERE "freightBillingMethod" IS NOT NULL;
-- The item weight/allocation columns are widened. Before narrowing them back to
-- their previous scales (20,8), verify no stored row needs the added precision:
-- SELECT count(*) FROM "quotation_items" WHERE "totalVolumeWeightKg" <> round("totalVolumeWeightKg", 8) OR "totalGrossWeightKg" <> round("totalGrossWeightKg", 8) OR "freightAllocationBasis" <> round("freightAllocationBasis", 8);
-- SELECT count(*) FROM "order_items" WHERE "totalVolumeWeightKg" <> round("totalVolumeWeightKg", 8) OR "totalGrossWeightKg" <> round("totalGrossWeightKg", 8) OR "freightAllocationBasis" <> round("freightAllocationBasis", 8);
