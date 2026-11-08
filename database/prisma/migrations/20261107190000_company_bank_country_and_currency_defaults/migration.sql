-- DOC-44: bank account opening country and per-currency default protection.
--
-- Compatibility:
-- * bankCountryCode is nullable for historical accounts; new accounts are
--   required to provide it through the API/schema.
-- * currencyCode remains nullable for historical data. Accounts with no
--   currency cannot be a default or participate in PI/CI matching.
-- * This migration does not guess a historical account's currency.

ALTER TABLE "bank_account_profiles"
  ADD COLUMN "bankCountryCode" VARCHAR(2);

-- An account without a currency must never be the default. Clearing this flag
-- is lossless and is the documented migration rule for legacy rows.
UPDATE "bank_account_profiles"
SET "isDefault" = false
WHERE "currencyCode" IS NULL
  AND "isDefault" = true;

-- Fail before creating the unique index if reviewed duplicate defaults remain.
DO $$
DECLARE
  duplicate_company uuid;
  duplicate_currency varchar(3);
BEGIN
  SELECT "companyProfileId", "currencyCode"
  INTO duplicate_company, duplicate_currency
  FROM "bank_account_profiles"
  WHERE "isDefault" = true
    AND "currencyCode" IS NOT NULL
  GROUP BY "companyProfileId", "currencyCode"
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_company IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate default bank accounts remain for company % currency %. Resolve them before migrating.',
      duplicate_company,
      duplicate_currency;
  END IF;
END $$;

CREATE UNIQUE INDEX "uq_bank_account_default_per_currency"
  ON "bank_account_profiles" ("companyProfileId", "currencyCode")
  WHERE "isDefault" = true
    AND "currencyCode" IS NOT NULL;

CREATE INDEX "bank_account_profiles_companyProfileId_currencyCode_enabled_idx"
  ON "bank_account_profiles" ("companyProfileId", "currencyCode", "enabled");

-- Rollback (manual, only after review):
-- DROP INDEX "uq_bank_account_default_per_currency";
-- DROP INDEX "bank_account_profiles_companyProfileId_currencyCode_enabled_idx";
-- ALTER TABLE "bank_account_profiles" DROP COLUMN "bankCountryCode";
