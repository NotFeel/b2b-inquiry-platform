-- Excel-to-PDF menu and RBAC reference data (docs/38).
--
-- Idempotent repair script for existing databases. It never grants this
-- conversion capability to an ordinary business role: only super_admin is
-- granted the five permissions here. Retry/delete remain administrator-only by
-- default and can be delegated later through the normal role management flow.

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'quotes-files') THEN
    RAISE EXCEPTION 'Cannot install Excel-to-PDF menu: parent menu "quotes-files" is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'super_admin') THEN
    RAISE EXCEPTION 'Cannot grant Excel-to-PDF permissions: role "super_admin" is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "menus"
    WHERE "route" = '/tools/excel-to-pdf'
      AND "code" <> 'excel-pdf'
  ) THEN
    RAISE EXCEPTION 'Cannot install Excel-to-PDF menu: its route is owned by another menu';
  END IF;
END
$guard$;

INSERT INTO "permissions" ("id", "code", "nameKey", "module")
VALUES
  (
    md5('b2b:permission:excel_pdf.read')::uuid,
    'excel_pdf.read',
    'permission.excel_pdf.read',
    'excel-pdf'
  ),
  (
    md5('b2b:permission:excel_pdf.create')::uuid,
    'excel_pdf.create',
    'permission.excel_pdf.create',
    'excel-pdf'
  ),
  (
    md5('b2b:permission:excel_pdf.download')::uuid,
    'excel_pdf.download',
    'permission.excel_pdf.download',
    'excel-pdf'
  ),
  (
    md5('b2b:permission:excel_pdf.retry')::uuid,
    'excel_pdf.retry',
    'permission.excel_pdf.retry',
    'excel-pdf'
  ),
  (
    md5('b2b:permission:excel_pdf.delete')::uuid,
    'excel_pdf.delete',
    'permission.excel_pdf.delete',
    'excel-pdf'
  )
ON CONFLICT ("code") DO UPDATE
SET "nameKey" = EXCLUDED."nameKey",
    "module" = EXCLUDED."module";

INSERT INTO "menus" (
  "id",
  "code",
  "parentId",
  "route",
  "icon",
  "permissionCode",
  "sortOrder",
  "visible",
  "enabled",
  "external",
  "updatedAt"
)
SELECT
  md5('b2b:menu:excel-pdf')::uuid,
  'excel-pdf',
  parent."id",
  '/tools/excel-to-pdf',
  'file',
  'excel_pdf.read',
  43,
  true,
  true,
  false,
  CURRENT_TIMESTAMP
FROM "menus" AS parent
WHERE parent."code" = 'quotes-files'
ON CONFLICT ("code") DO UPDATE
SET "parentId" = EXCLUDED."parentId",
    "route" = EXCLUDED."route",
    "icon" = EXCLUDED."icon",
    "permissionCode" = EXCLUDED."permissionCode",
    "sortOrder" = EXCLUDED."sortOrder",
    "visible" = true,
    "enabled" = true,
    "external" = false,
    "updatedAt" = CURRENT_TIMESTAMP;

-- Add missing locale labels without overwriting labels edited by operators.
INSERT INTO "menu_translations" ("menuId", "locale", "label")
SELECT menu."id", 'zh-CN', 'Excel 转 PDF'
FROM "menus" AS menu
WHERE menu."code" = 'excel-pdf'
ON CONFLICT ("menuId", "locale") DO NOTHING;

INSERT INTO "menu_translations" ("menuId", "locale", "label")
SELECT menu."id", 'en-US', 'Excel to PDF'
FROM "menus" AS menu
WHERE menu."code" = 'excel-pdf'
ON CONFLICT ("menuId", "locale") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT role."id", permission."code"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'super_admin'
  AND permission."code" IN (
    'excel_pdf.read',
    'excel_pdf.create',
    'excel_pdf.download',
    'excel_pdf.retry',
    'excel_pdf.delete'
  )
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;

DO $verify$
DECLARE
  menu_count integer;
  permission_count integer;
  translation_count integer;
  grant_count integer;
BEGIN
  SELECT count(*) INTO menu_count
  FROM "menus"
  WHERE "code" = 'excel-pdf'
    AND "route" = '/tools/excel-to-pdf'
    AND "permissionCode" = 'excel_pdf.read'
    AND "visible" = true
    AND "enabled" = true;
  IF menu_count <> 1 THEN
    RAISE EXCEPTION 'Excel-to-PDF menu verification failed: expected 1 active menu, found %', menu_count;
  END IF;

  SELECT count(*) INTO permission_count
  FROM "permissions"
  WHERE "code" IN (
    'excel_pdf.read',
    'excel_pdf.create',
    'excel_pdf.download',
    'excel_pdf.retry',
    'excel_pdf.delete'
  );
  IF permission_count <> 5 THEN
    RAISE EXCEPTION 'Excel-to-PDF permission verification failed: expected 5, found %', permission_count;
  END IF;

  SELECT count(*) INTO translation_count
  FROM "menu_translations" AS translation
  JOIN "menus" AS menu ON menu."id" = translation."menuId"
  WHERE menu."code" = 'excel-pdf'
    AND translation."locale" IN ('zh-CN', 'en-US')
    AND length(trim(translation."label")) > 0;
  IF translation_count <> 2 THEN
    RAISE EXCEPTION 'Excel-to-PDF translation verification failed: expected 2, found %', translation_count;
  END IF;

  SELECT count(*) INTO grant_count
  FROM "role_permissions" AS grant_row
  JOIN "roles" AS role ON role."id" = grant_row."roleId"
  WHERE role."code" = 'super_admin'
    AND grant_row."permissionCode" IN (
      'excel_pdf.read',
      'excel_pdf.create',
      'excel_pdf.download',
      'excel_pdf.retry',
      'excel_pdf.delete'
    );
  IF grant_count <> 5 THEN
    RAISE EXCEPTION 'Excel-to-PDF super_admin grant verification failed: expected 5, found %', grant_count;
  END IF;
END
$verify$;

COMMIT;

-- Expected result: one active menu, two translations, five permissions and five
-- super_admin grants. Ordinary roles are intentionally unchanged.
--
-- Rollback for this repair only (after confirming no role still uses the
-- capability and no conversion history must retain the menu):
--   DELETE FROM "menus" WHERE "code" = 'excel-pdf';
--   DELETE FROM "permissions" WHERE "code" LIKE 'excel_pdf.%';
-- Menu translations and role grants cascade from those parent records. Do not
-- run the rollback after production depends on the records; prefer disabling the
-- feature with EXCEL_PDF_ENABLED=false and retaining audit/history instead.
