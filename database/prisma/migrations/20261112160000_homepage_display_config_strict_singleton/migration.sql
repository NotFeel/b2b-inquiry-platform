-- DOC-45 stage C: enforce strict singleton semantics for homepage settings.
--
-- The existing UNIQUE index prevents duplicate rows for the same configKey,
-- while this CHECK ensures that no key other than the fixed singleton key can
-- be persisted. Prisma does not model CHECK constraints, so this constraint is
-- maintained by the versioned migration and recorded in schema.prisma comments.

ALTER TABLE "homepage_display_configs"
  ADD CONSTRAINT "homepage_display_configs_singleton_check"
  CHECK ("configKey" = 'default');

-- Rollback (manual, after application rollback):
-- ALTER TABLE "homepage_display_configs"
--   DROP CONSTRAINT "homepage_display_configs_singleton_check";
