-- Remove the Excel-to-PDF navigation entry without deleting its menu record,
-- translations, permissions or any historical conversion data.
UPDATE "menus"
SET "enabled" = false,
    "visible" = false
WHERE "code" = 'pdf-conversions';

-- Rollback (only when restoring the previous application build):
-- UPDATE "menus" SET "enabled" = true, "visible" = true
-- WHERE "code" = 'pdf-conversions';
