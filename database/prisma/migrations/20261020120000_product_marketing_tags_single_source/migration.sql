-- Marketing display moves to product tags (后台商品管理页面优化与技术实施方案 §4).
-- The legacy Product booleans (isNew/isFeatured/isPreOrder) stay as a derived,
-- read-only mirror of the tag relation. No column is dropped in this migration.

-- 1. Reference tags (idempotent: the seed may already have created them).
INSERT INTO tags (id, code, "colorToken", enabled, "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.code, v.token, true, now(), now()
FROM (VALUES
  ('featured', 'tag.brand'),
  ('new-arrival', 'tag.info'),
  ('preorder', 'tag.warning')
) AS v(code, token)
WHERE NOT EXISTS (SELECT 1 FROM tags t WHERE t.code = v.code);

-- 2. Bilingual labels for the reference tags.
INSERT INTO tag_translations ("tagId", locale, label)
SELECT t.id, v.locale, v.label
FROM tags t
JOIN (VALUES
  ('featured', 'en-US', 'Featured'),
  ('featured', 'zh-CN', '精选'),
  ('new-arrival', 'en-US', 'New arrival'),
  ('new-arrival', 'zh-CN', '新品'),
  ('preorder', 'en-US', 'Pre-order'),
  ('preorder', 'zh-CN', '预售')
) AS v(code, locale, label) ON v.code = t.code
WHERE NOT EXISTS (
  SELECT 1 FROM tag_translations tt
  WHERE tt."tagId" = t.id AND tt.locale = v.locale
);

-- 3. Backfill tag links for products whose legacy boolean is still true.
INSERT INTO product_tags ("productId", "tagId")
SELECT p.id, t.id
FROM products p
CROSS JOIN tags t
WHERE (
    (p."isFeatured" AND t.code = 'featured')
    OR (p."isNew" AND t.code = 'new-arrival')
    OR (p."isPreOrder" AND t.code = 'preorder')
  )
  AND NOT EXISTS (
    SELECT 1 FROM product_tags pt
    WHERE pt."productId" = p.id AND pt."tagId" = t.id
  );

-- 4. Recompute the derived booleans from the tag relation so the two can never
--    drift again. A tag that was already present wins over a stale boolean.
UPDATE products p
SET
  "isFeatured" = EXISTS (
    SELECT 1 FROM product_tags pt
    JOIN tags t ON t.id = pt."tagId"
    WHERE pt."productId" = p.id AND t.code = 'featured'
  ),
  "isNew" = EXISTS (
    SELECT 1 FROM product_tags pt
    JOIN tags t ON t.id = pt."tagId"
    WHERE pt."productId" = p.id AND t.code = 'new-arrival'
  ),
  "isPreOrder" = p."lifecycleStatus" = 'PREORDER' AND EXISTS (
    SELECT 1 FROM product_tags pt
    JOIN tags t ON t.id = pt."tagId"
    WHERE pt."productId" = p.id AND t.code = 'preorder'
  );
