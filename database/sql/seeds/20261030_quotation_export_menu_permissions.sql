-- Quotation Excel export menu and RBAC reference data (docs/36).
--
-- This is an idempotent data repair script, not a schema migration. It is safe
-- to run repeatedly against an existing database. The whole script is one
-- transaction: missing parent/role prerequisites or an incomplete result abort
-- every change.
--
-- Stable keys:
--   menu:       products.quotation-export under catalog
--   permission: quotation.export.read
--               quotation.export.create
--               quotation.export.unpublished

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'catalog') THEN
    RAISE EXCEPTION 'Cannot install quotation export menu: parent menu "catalog" is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'super_admin') THEN
    RAISE EXCEPTION 'Cannot grant quotation export permissions: role "super_admin" is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'catalog_manager') THEN
    RAISE EXCEPTION 'Cannot grant quotation export permissions: role "catalog_manager" is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "menus"
    WHERE "route" = '/products/quotation-export'
      AND "code" <> 'products.quotation-export'
  ) THEN
    RAISE EXCEPTION 'Cannot install quotation export menu: its route is owned by another menu';
  END IF;
END
$guard$;

INSERT INTO "permissions" ("id", "code", "nameKey", "module")
VALUES
  (
    md5('b2b:permission:quotation.export.read')::uuid,
    'quotation.export.read',
    'permission.quotation.export.read',
    'quotation'
  ),
  (
    md5('b2b:permission:quotation.export.create')::uuid,
    'quotation.export.create',
    'permission.quotation.export.create',
    'quotation'
  ),
  (
    md5('b2b:permission:quotation.export.unpublished')::uuid,
    'quotation.export.unpublished',
    'permission.quotation.export.unpublished',
    'quotation'
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
  md5('b2b:menu:products.quotation-export')::uuid,
  'products.quotation-export',
  parent."id",
  '/products/quotation-export',
  'download',
  'quotation.export.read',
  23,
  true,
  true,
  false,
  CURRENT_TIMESTAMP
FROM "menus" AS parent
WHERE parent."code" = 'catalog'
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

-- Match the release seed's behaviour: add a missing locale but do not overwrite
-- a label that an administrator has deliberately customised.
INSERT INTO "menu_translations" ("menuId", "locale", "label")
SELECT menu."id", 'zh-CN', '报价单导出'
FROM "menus" AS menu
WHERE menu."code" = 'products.quotation-export'
ON CONFLICT ("menuId", "locale") DO NOTHING;

INSERT INTO "menu_translations" ("menuId", "locale", "label")
SELECT menu."id", 'en-US', 'Quotation Export'
FROM "menus" AS menu
WHERE menu."code" = 'products.quotation-export'
ON CONFLICT ("menuId", "locale") DO NOTHING;

-- Super administrators receive all three capabilities. Catalogue managers can
-- view/create exports but never receive access to unpublished products here.
INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT role."id", grant_row."permissionCode"
FROM (
  VALUES
    ('super_admin', 'quotation.export.read'),
    ('super_admin', 'quotation.export.create'),
    ('super_admin', 'quotation.export.unpublished'),
    ('catalog_manager', 'quotation.export.read'),
    ('catalog_manager', 'quotation.export.create')
) AS grant_row("roleCode", "permissionCode")
JOIN "roles" AS role ON role."code" = grant_row."roleCode"
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;

DO $verify$
DECLARE
  menu_count integer;
  permission_count integer;
  translation_count integer;
  super_admin_grant_count integer;
  catalog_manager_grant_count integer;
BEGIN
  SELECT count(*) INTO menu_count
  FROM "menus"
  WHERE "code" = 'products.quotation-export'
    AND "route" = '/products/quotation-export'
    AND "permissionCode" = 'quotation.export.read'
    AND "visible" = true
    AND "enabled" = true;
  IF menu_count <> 1 THEN
    RAISE EXCEPTION 'Quotation export menu verification failed: expected 1 active menu, found %', menu_count;
  END IF;

  SELECT count(*) INTO permission_count
  FROM "permissions"
  WHERE "code" IN (
    'quotation.export.read',
    'quotation.export.create',
    'quotation.export.unpublished'
  );
  IF permission_count <> 3 THEN
    RAISE EXCEPTION 'Quotation export permission verification failed: expected 3 permissions, found %', permission_count;
  END IF;

  SELECT count(*) INTO translation_count
  FROM "menu_translations" AS translation
  JOIN "menus" AS menu ON menu."id" = translation."menuId"
  WHERE menu."code" = 'products.quotation-export'
    AND translation."locale" IN ('zh-CN', 'en-US');
  IF translation_count <> 2 THEN
    RAISE EXCEPTION 'Quotation export translation verification failed: expected 2 locales, found %', translation_count;
  END IF;

  SELECT count(*) INTO super_admin_grant_count
  FROM "role_permissions" AS grant_row
  JOIN "roles" AS role ON role."id" = grant_row."roleId"
  WHERE role."code" = 'super_admin'
    AND grant_row."permissionCode" IN (
      'quotation.export.read',
      'quotation.export.create',
      'quotation.export.unpublished'
    );
  IF super_admin_grant_count <> 3 THEN
    RAISE EXCEPTION 'Quotation export super_admin grants verification failed: expected 3, found %', super_admin_grant_count;
  END IF;

  SELECT count(*) INTO catalog_manager_grant_count
  FROM "role_permissions" AS grant_row
  JOIN "roles" AS role ON role."id" = grant_row."roleId"
  WHERE role."code" = 'catalog_manager'
    AND grant_row."permissionCode" IN (
      'quotation.export.read',
      'quotation.export.create'
    );
  IF catalog_manager_grant_count <> 2 THEN
    RAISE EXCEPTION 'Quotation export catalog_manager grants verification failed: expected 2, found %', catalog_manager_grant_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "role_permissions" AS grant_row
    JOIN "roles" AS role ON role."id" = grant_row."roleId"
    WHERE role."code" = 'catalog_manager'
      AND grant_row."permissionCode" = 'quotation.export.unpublished'
  ) THEN
    RAISE EXCEPTION 'Unsafe grant detected: catalog_manager must not receive quotation.export.unpublished';
  END IF;
END
$verify$;

COMMIT;

-- Expected result after COMMIT: one active menu, two translations, three
-- permissions, three super_admin grants and two catalog_manager grants.
--
-- Rollback for this repair only (run as a separate transaction after review):
--   DELETE FROM "menus" WHERE "code" = 'products.quotation-export';
--   DELETE FROM "permissions" WHERE "code" LIKE 'quotation.export.%';
-- Deleting a menu cascades its translations; permission deletion cascades role
-- grants. Do not use the rollback after other features depend on these records.
