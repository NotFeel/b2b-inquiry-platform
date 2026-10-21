-- Harden the ProductTag → Tag foreign key (docs/23 §6.5, §9 phase C).
--
-- Before: ON DELETE CASCADE. Deleting a tag would silently remove every
-- `product_tags` row attached to it, i.e. products would lose their labels with
-- no warning. The service already refuses to delete a referenced tag
-- (TAG_IN_USE), but the cascade made the database an active participant in data
-- loss if any other code path ever deleted a tag row.
--
-- After: ON DELETE RESTRICT. A referenced tag can no longer be deleted by any
-- path, with or without the service check. `TagTranslation` keeps CASCADE: a
-- tag's own translations belong to it and are deleted with it.
--
-- This is a tightening change: it cannot fail on existing data (every current
-- `product_tags.tagId` already references an existing tag), and it does not
-- rewrite any rows.
ALTER TABLE "product_tags" DROP CONSTRAINT IF EXISTS "product_tags_tagId_fkey";

ALTER TABLE "product_tags"
  ADD CONSTRAINT "product_tags_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "tags"("id")
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

-- Rollback (only if the previous behaviour is genuinely required again):
--   ALTER TABLE "product_tags" DROP CONSTRAINT IF EXISTS "product_tags_tagId_fkey";
--   ALTER TABLE "product_tags"
--     ADD CONSTRAINT "product_tags_tagId_fkey"
--     FOREIGN KEY ("tagId") REFERENCES "tags"("id")
--     ON UPDATE CASCADE
--     ON DELETE CASCADE;
-- No data backfill is involved in either direction.
