-- Formal orders now receive a system-generated, unique contract number.
-- Historical NULL values stay NULL (no rewriting). Duplicate non-NULL values
-- would make the unique index ambiguous, so fail the migration with a clear
-- message and let an operator resolve them intentionally.
DO $$
DECLARE
  duplicate_value text;
BEGIN
  SELECT "contractNo"
  INTO duplicate_value
  FROM "orders"
  WHERE "contractNo" IS NOT NULL
  GROUP BY "contractNo"
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_value IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create unique index on orders.contractNo: duplicate value % exists. Resolve duplicates with an audited data fix before migrating.',
      duplicate_value;
  END IF;
END $$;

CREATE UNIQUE INDEX "orders_contractNo_key" ON "orders"("contractNo");

-- Rollback (manual): DROP INDEX "orders_contractNo_key";
