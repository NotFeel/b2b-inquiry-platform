-- Add stable seed/management keys and category grouping without creating a
-- duplicate FAQ model. Existing seeded rows are mapped by their original
-- English questions; any unrecognised administrator-created row receives a
-- deterministic legacy code and the default category.
ALTER TABLE "faq_items"
ADD COLUMN "code" VARCHAR(100),
ADD COLUMN "category" VARCHAR(40) NOT NULL DEFAULT 'products';

UPDATE "faq_items" AS item
SET "code" = 'faq.products.pricing',
    "category" = 'products'
FROM "faq_translations" AS translation
WHERE translation."faqId" = item."id"
  AND translation."locale" = 'en-US'
  AND translation."question" = 'Do you publish prices on the website?'
  AND item."code" IS NULL;

UPDATE "faq_items" AS item
SET "code" = 'faq.wholesale.packaging',
    "category" = 'wholesale'
FROM "faq_translations" AS translation
WHERE translation."faqId" = item."id"
  AND translation."locale" = 'en-US'
  AND translation."question" = 'Can you customise packaging or print our logo?'
  AND item."code" IS NULL;

UPDATE "faq_items" AS item
SET "code" = 'faq.orders.lead_time',
    "category" = 'orders'
FROM "faq_translations" AS translation
WHERE translation."faqId" = item."id"
  AND translation."locale" = 'en-US'
  AND translation."question" = 'What is the typical lead time?'
  AND item."code" IS NULL;

UPDATE "faq_items"
SET "code" = 'faq.legacy.' || replace("id"::text, '-', '')
WHERE "code" IS NULL;

ALTER TABLE "faq_items"
ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "faq_items_code_key" ON "faq_items"("code");
CREATE INDEX "faq_items_enabled_category_sortOrder_idx"
ON "faq_items"("enabled", "category", "sortOrder");

-- Rollback is intentionally code-first. After deploying the previous API/admin
-- build, export code/category for reference, then:
--   DROP INDEX "faq_items_enabled_category_sortOrder_idx";
--   DROP INDEX "faq_items_code_key";
--   ALTER TABLE "faq_items" DROP COLUMN "category", DROP COLUMN "code";
