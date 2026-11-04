-- Preserve existing whole-centimetre values while enabling precise carton measurements.
-- ALTER TYPE rewrites the affected table and takes a write lock; schedule with the normal
-- product-catalog migration window. Integer values cast exactly to DECIMAL(12,3).
-- Rollback is lossless only if this query returns zero:
-- SELECT count(*) FROM "products"
-- WHERE "cartonLengthCm" <> trunc("cartonLengthCm")
--    OR "cartonWidthCm" <> trunc("cartonWidthCm")
--    OR "cartonHeightCm" <> trunc("cartonHeightCm");
-- If zero, rollback with:
-- ALTER TABLE "products"
--   ALTER COLUMN "cartonLengthCm" TYPE INTEGER USING "cartonLengthCm"::INTEGER,
--   ALTER COLUMN "cartonWidthCm" TYPE INTEGER USING "cartonWidthCm"::INTEGER,
--   ALTER COLUMN "cartonHeightCm" TYPE INTEGER USING "cartonHeightCm"::INTEGER;
ALTER TABLE "products"
  ALTER COLUMN "cartonLengthCm" TYPE DECIMAL(12, 3)
    USING "cartonLengthCm"::DECIMAL(12, 3),
  ALTER COLUMN "cartonWidthCm" TYPE DECIMAL(12, 3)
    USING "cartonWidthCm"::DECIMAL(12, 3),
  ALTER COLUMN "cartonHeightCm" TYPE DECIMAL(12, 3)
    USING "cartonHeightCm"::DECIMAL(12, 3);
