-- DOC-45 stage C: database-backed singleton protection for homepage settings.
--
-- Stage B introduced the row, but only a UUID primary key. A fixed key and a
-- UNIQUE index are required so `upsert({ where: { configKey } })` can safely
-- serialize concurrent first reads instead of racing on findFirst + create.

ALTER TABLE "homepage_display_configs"
  ADD COLUMN "configKey" VARCHAR(40) NOT NULL DEFAULT 'default';

CREATE UNIQUE INDEX "homepage_display_configs_configKey_key"
  ON "homepage_display_configs"("configKey");

-- Rollback (manual, after application rollback): the column is additive and
-- contains no business data. Drop the unique index and column only when no
-- deployed application reads `configKey`.
-- DROP INDEX "homepage_display_configs_configKey_key";
-- ALTER TABLE "homepage_display_configs" DROP COLUMN "configKey";
