-- Grant the new commercial-document edit capability to the existing "sales"
-- default role. Reference-only seeding only auto-grants newly created
-- permission codes, so a grant change to an existing permission needs this
-- explicit, idempotent data migration. Administrators can still revoke it in
-- Roles & permissions afterwards.
INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT r."id", p."code"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'sales'
  AND p."code" = 'commercial_document.update'
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
