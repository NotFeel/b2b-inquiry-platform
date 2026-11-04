-- Quotation fee options are managed through the existing dictionary tables.
-- Insert defaults only when missing so existing enablement and translations
-- remain under the administrator's control.
INSERT INTO dictionary_types (
  id, code, "nameKey", description, "systemLocked", enabled, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), 'quotation_fee_type', 'dictionary.quotation_fee_type',
  'Order-level quotation fee categories', false, true, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM dictionary_types dt WHERE dt.code = 'quotation_fee_type'
);

INSERT INTO dictionary_items (
  id, "typeId", code, value, "sortOrder", enabled, "systemLocked", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), dt.id, v.code, v.code, v.sort_order, true, false, now(), now()
FROM dictionary_types dt
JOIN (VALUES
  ('packaging', 10),
  ('customs', 20),
  ('other', 30)
) AS v(code, sort_order) ON true
WHERE dt.code = 'quotation_fee_type'
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_items di
    WHERE di."typeId" = dt.id AND di.code = v.code
  );

INSERT INTO dictionary_item_translations ("itemId", locale, label)
SELECT di.id, v.locale, v.label
FROM dictionary_items di
JOIN dictionary_types dt ON dt.id = di."typeId"
JOIN (VALUES
  ('packaging', 'zh-CN', '包装费用'),
  ('packaging', 'en-US', 'Packaging fee'),
  ('customs', 'zh-CN', '清关费用'),
  ('customs', 'en-US', 'Customs clearance fee'),
  ('other', 'zh-CN', '其他费用'),
  ('other', 'en-US', 'Other')
) AS v(code, locale, label) ON v.code = di.code
WHERE dt.code = 'quotation_fee_type'
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_item_translations dit
    WHERE dit."itemId" = di.id AND dit.locale = v.locale
  );
