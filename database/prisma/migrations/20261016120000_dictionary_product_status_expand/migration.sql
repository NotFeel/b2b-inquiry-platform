-- Stage 1 of the enum -> dictionary migration for product status (docs/20 §8):
-- Expand -> Backfill -> Verify. The `ProductLifecycleStatus` / `PublishStatus`
-- enums and their columns are intentionally kept: they stay authoritative for
-- every read path until the separate switch release, and the contract release
-- (NOT NULL + enum removal) is a different migration that requires its own
-- approval and backup.
--
-- Purely additive: it adds two nullable columns, their indexes and
-- restricted foreign keys, then backfills them from the enum values by joining
-- the seeded dictionary items. Rows that cannot be mapped make the migration
-- fail instead of being silently defaulted.
--
-- Rollback (safe while the switch release has not shipped):
--   ALTER TABLE "products" DROP CONSTRAINT "products_lifecycleStatusItemId_fkey";
--   ALTER TABLE "products" DROP CONSTRAINT "products_publishStatusItemId_fkey";
--   DROP INDEX "products_lifecycleStatusItemId_idx";
--   DROP INDEX "products_publishStatusItemId_idx";
--   ALTER TABLE "products" DROP COLUMN "lifecycleStatusItemId";
--   ALTER TABLE "products" DROP COLUMN "publishStatusItemId";

-- Expand
ALTER TABLE "products" ADD COLUMN "lifecycleStatusItemId" UUID;
ALTER TABLE "products" ADD COLUMN "publishStatusItemId" UUID;

-- Backfill from the enum values through the seeded dictionary items.
-- `lower(enum::text)` maps AVAILABLE -> available etc.
UPDATE "products" p
SET "lifecycleStatusItemId" = i."id"
FROM "dictionary_items" i
JOIN "dictionary_types" t ON t."id" = i."typeId"
WHERE t."code" = 'product_lifecycle'
  AND i."code" = lower(p."lifecycleStatus"::text);

UPDATE "products" p
SET "publishStatusItemId" = i."id"
FROM "dictionary_items" i
JOIN "dictionary_types" t ON t."id" = i."typeId"
WHERE t."code" = 'publish_status'
  AND i."code" = lower(p."publishStatus"::text);

-- Verify: every existing product must now point at an item of the right type.
DO $$
DECLARE
  unmapped integer;
  wrong_type integer;
BEGIN
  SELECT count(*) INTO unmapped
  FROM "products"
  WHERE "lifecycleStatusItemId" IS NULL OR "publishStatusItemId" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'dictionary backfill left % product row(s) unmapped; seed the dictionary types before migrating', unmapped;
  END IF;

  SELECT count(*) INTO wrong_type
  FROM "products" p
  JOIN "dictionary_items" li ON li."id" = p."lifecycleStatusItemId"
  JOIN "dictionary_types" lt ON lt."id" = li."typeId"
  JOIN "dictionary_items" pi ON pi."id" = p."publishStatusItemId"
  JOIN "dictionary_types" pt ON pt."id" = pi."typeId"
  WHERE lt."code" <> 'product_lifecycle' OR pt."code" <> 'publish_status';
  IF wrong_type > 0 THEN
    RAISE EXCEPTION '% product row(s) reference an item from the wrong dictionary type', wrong_type;
  END IF;
END $$;

-- Indexes and restricted foreign keys: a dictionary item that a product still
-- references can never be deleted.
CREATE INDEX "products_lifecycleStatusItemId_idx" ON "products"("lifecycleStatusItemId");
CREATE INDEX "products_publishStatusItemId_idx" ON "products"("publishStatusItemId");

ALTER TABLE "products" ADD CONSTRAINT "products_lifecycleStatusItemId_fkey"
  FOREIGN KEY ("lifecycleStatusItemId") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_publishStatusItemId_fkey"
  FOREIGN KEY ("publishStatusItemId") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
