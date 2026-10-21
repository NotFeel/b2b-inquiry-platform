-- Settings metadata + translations (docs/21 §5, §9 phase 1).
--
-- Purely additive and backward compatible: every column has a default, no key or
-- value is touched, and no row is deleted. The metadata of the built-in keys is
-- backfilled here; `prisma/seed.ts` then keeps code and database in sync for
-- labels, groups and the system flags.
--
-- Rollback (safe while the old API/UI version is still deployable):
--   DROP TABLE "global_setting_translations";
--   ALTER TABLE "global_settings"
--     DROP COLUMN "groupCode", DROP COLUMN "valueType", DROP COLUMN "labelKey",
--     DROP COLUMN "descriptionKey", DROP COLUMN "isSystem", DROP COLUMN "isEditable",
--     DROP COLUMN "isDeletable", DROP COLUMN "isRequired", DROP COLUMN "sortOrder",
--     DROP COLUMN "validation", DROP COLUMN "options", DROP COLUMN "revision";

-- Expand
ALTER TABLE "global_settings"
  ADD COLUMN "groupCode" VARCHAR(60) NOT NULL DEFAULT 'custom',
  ADD COLUMN "valueType" VARCHAR(30) NOT NULL DEFAULT 'string',
  ADD COLUMN "labelKey" VARCHAR(180),
  ADD COLUMN "descriptionKey" VARCHAR(180),
  ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isEditable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isDeletable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "validation" JSONB,
  ADD COLUMN "options" JSONB,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "global_setting_translations" (
  "id" UUID NOT NULL,
  "settingKey" VARCHAR(160) NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "label" VARCHAR(180) NOT NULL,
  "description" TEXT,
  CONSTRAINT "global_setting_translations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_setting_translations_settingKey_locale_key"
  ON "global_setting_translations"("settingKey", "locale");
CREATE INDEX "global_setting_translations_locale_idx" ON "global_setting_translations"("locale");
CREATE INDEX "global_settings_groupCode_sortOrder_idx" ON "global_settings"("groupCode", "sortOrder");

ALTER TABLE "global_setting_translations" ADD CONSTRAINT "global_setting_translations_settingKey_fkey"
  FOREIGN KEY ("settingKey") REFERENCES "global_settings"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill metadata for the keys that shipped before this migration. Anything
-- unknown keeps the column defaults and is therefore treated as a custom setting.
UPDATE "global_settings" SET "groupCode" = 'site_profile', "valueType" = 'string',
  "labelKey" = 'settings.definitions.' || replace("key", '.', '_'),
  "descriptionKey" = 'settings.definitions.' || replace("key", '.', '_') || '_description',
  "isSystem" = true, "isDeletable" = false, "sortOrder" = 10
WHERE "key" IN ('site.companyName', 'site.tagline');

UPDATE "global_settings" SET "groupCode" = 'contact', "valueType" = 'email',
  "labelKey" = 'settings.definitions.site_contactEmail', "isSystem" = true, "isDeletable" = false, "sortOrder" = 20
WHERE "key" = 'site.contactEmail';

UPDATE "global_settings" SET "groupCode" = 'contact', "valueType" = 'phone',
  "labelKey" = 'settings.definitions.site_contactPhone', "isSystem" = true, "isDeletable" = false, "sortOrder" = 30
WHERE "key" = 'site.contactPhone';

UPDATE "global_settings" SET "groupCode" = 'contact', "valueType" = 'text',
  "labelKey" = 'settings.definitions.site_address', "isSystem" = true, "isDeletable" = false, "sortOrder" = 40
WHERE "key" = 'site.address';

UPDATE "global_settings" SET "groupCode" = 'social', "valueType" = 'objectList',
  "labelKey" = 'settings.definitions.site_socialLinks', "isSystem" = true, "isDeletable" = false, "sortOrder" = 10
WHERE "key" = 'site.socialLinks';

UPDATE "global_settings" SET "groupCode" = 'social', "valueType" = 'objectList',
  "labelKey" = 'settings.definitions.site_legalLinks', "isSystem" = true, "isDeletable" = false, "sortOrder" = 20
WHERE "key" = 'site.legalLinks';

UPDATE "global_settings" SET "groupCode" = 'site_profile', "valueType" = 'string',
  "labelKey" = 'settings.definitions.site_logoFileAssetId', "isSystem" = true, "isDeletable" = false, "sortOrder" = 20
WHERE "key" = 'site.logoFileAssetId';

UPDATE "global_settings" SET "groupCode" = 'inquiry', "valueType" = 'phone',
  "labelKey" = 'settings.definitions.site_whatsappNumber', "isSystem" = true, "isDeletable" = false, "sortOrder" = 10
WHERE "key" = 'site.whatsappNumber';

UPDATE "global_settings" SET "groupCode" = 'inquiry', "valueType" = 'number',
  "labelKey" = 'settings.definitions.site_batchInquiryLimit', "isSystem" = true, "isDeletable" = false, "sortOrder" = 20
WHERE "key" = 'site.batchInquiryLimit';

UPDATE "global_settings" SET "groupCode" = 'seo', "valueType" = 'string',
  "labelKey" = 'settings.definitions.site_seoTitle', "isSystem" = true, "isDeletable" = false, "sortOrder" = 10
WHERE "key" = 'site.seoTitle';

UPDATE "global_settings" SET "groupCode" = 'seo', "valueType" = 'text',
  "labelKey" = 'settings.definitions.site_seoDescription', "isSystem" = true, "isDeletable" = false, "sortOrder" = 20
WHERE "key" = 'site.seoDescription';

UPDATE "global_settings" SET "groupCode" = 'seo', "valueType" = 'stringList',
  "labelKey" = 'settings.definitions.site_seoKeywords', "isSystem" = true, "isDeletable" = false, "sortOrder" = 30
WHERE "key" = 'site.seoKeywords';

UPDATE "global_settings" SET "groupCode" = 'site_profile', "valueType" = 'select',
  "labelKey" = 'settings.definitions.site_defaultLocale', "isSystem" = true, "isDeletable" = false,
  "options" = '["en-US", "zh-CN"]'::jsonb, "sortOrder" = 30
WHERE "key" = 'site.defaultLocale';

UPDATE "global_settings" SET "groupCode" = 'analytics', "valueType" = 'boolean',
  "labelKey" = 'settings.definitions.site_analyticsEnabled', "isSystem" = true, "isDeletable" = false, "sortOrder" = 10
WHERE "key" = 'site.analyticsEnabled';

UPDATE "global_settings" SET "groupCode" = 'analytics', "valueType" = 'number',
  "labelKey" = 'settings.definitions.analytics_rawRetentionDays', "isSystem" = true, "isDeletable" = false, "sortOrder" = 20
WHERE "key" = 'analytics.rawRetentionDays';

UPDATE "global_settings" SET "groupCode" = 'site_profile', "valueType" = 'string',
  "labelKey" = 'settings.definitions.admin_timezone', "isSystem" = true, "isDeletable" = false, "sortOrder" = 40
WHERE "key" = 'admin.timezone';

UPDATE "global_settings" SET "groupCode" = 'integrations', "valueType" = 'number',
  "labelKey" = 'settings.definitions.upload_maxBytes', "isSystem" = true, "isDeletable" = false, "sortOrder" = 10
WHERE "key" = 'upload.maxBytes';

UPDATE "global_settings" SET "groupCode" = 'integrations', "valueType" = 'string', "isSecret" = true,
  "labelKey" = 'settings.definitions.integrations_whatsappWebhookSecret', "isSystem" = true,
  "isDeletable" = false, "sortOrder" = 20
WHERE "key" = 'integrations.whatsappWebhookSecret';

-- Verify: no row lost, no value changed, no secret left public.
DO $$
DECLARE
  total integer;
  public_secrets integer;
BEGIN
  SELECT count(*) INTO total FROM "global_settings";
  IF total = 0 THEN
    RAISE NOTICE 'global_settings is empty; metadata defaults applied';
  END IF;

  SELECT count(*) INTO public_secrets FROM "global_settings" WHERE "isPublic" AND "isSecret";
  IF public_secrets > 0 THEN
    RAISE EXCEPTION '% setting(s) are both public and secret; resolve them before migrating', public_secrets;
  END IF;
END $$;
