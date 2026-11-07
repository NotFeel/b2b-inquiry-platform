-- Quotation items snapshot the same export/customs attributes as order items so
-- converting a saved quotation to an order never has to re-read mutable product
-- master data (docs/41 §6.3).
ALTER TABLE "quotation_items"
  ADD COLUMN "hsCodeSnapshot" VARCHAR(20),
  ADD COLUMN "originCountryCodeSnapshot" VARCHAR(2),
  ADD COLUMN "customsDescriptionSnapshot" TEXT,
  ADD COLUMN "netWeightPerUnitKgSnapshot" DECIMAL(18,6);
