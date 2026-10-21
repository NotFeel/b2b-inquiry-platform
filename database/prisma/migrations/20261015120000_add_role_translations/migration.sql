-- Administrator-maintained role names (docs/18 §2.4, §3.3).
--
-- Additive and backward compatible: seeded roles keep resolving through
-- `roles.nameKey` + the i18n dictionary and simply have no rows here, while
-- custom roles created in the back office store their zh-CN / en-US names.
--
-- Rollback: DROP TABLE "role_translations"; (drops display names of custom
-- roles only - no authorization decision depends on this table).

-- CreateTable
CREATE TABLE "role_translations" (
    "roleId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "role_translations_pkey" PRIMARY KEY ("roleId","locale")
);

-- AddForeignKey
ALTER TABLE "role_translations" ADD CONSTRAINT "role_translations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
