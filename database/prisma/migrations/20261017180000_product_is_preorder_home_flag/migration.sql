-- Home-page pre-order curation flag (business decision 2026-10-17).
--
-- `lifecycleStatus = 'PREORDER'` describes what the product is; `isPreOrder`
-- says whether it belongs in the storefront home page's pre-order rail. Keeping
-- them separate lets the catalogue keep selling a pre-order item that is not
-- curated for the home page.
--
-- Additive and behaviour-preserving: the column defaults to false, then every
-- existing PREORDER product is backfilled to true so the home page looks the
-- same right after deploy. The service refuses isPreOrder=true for any other
-- lifecycle.

ALTER TABLE "products"
  ADD COLUMN "isPreOrder" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing pre-order products stay on the home page until an operator
-- deliberately unchecks them.
UPDATE "products"
  SET "isPreOrder" = true
  WHERE "lifecycleStatus" = 'PREORDER';

CREATE INDEX "products_publishStatus_isPreOrder_sortOrder_idx"
  ON "products" ("publishStatus", "isPreOrder", "sortOrder");

-- Verification:
--   SELECT "isPreOrder", "lifecycleStatus", count(*) FROM "products" GROUP BY 1, 2;
--   SELECT count(*) FROM "products" WHERE "isPreOrder" AND "lifecycleStatus" <> 'PREORDER'; -- must be 0

-- Rollback (drops a display flag only; no business data is lost beyond it):
--   DROP INDEX IF EXISTS "products_publishStatus_isPreOrder_sortOrder_idx";
--   ALTER TABLE "products" DROP COLUMN "isPreOrder";
