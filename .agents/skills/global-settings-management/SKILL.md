# Skill: Global Settings Management

## When to use
Use this skill for the admin global settings page, application-level key-value settings, public site configuration, and any setting API or metadata/database migration.

## Required reading
- `AGENTS.md`
- `docs/21-global-settings-management.md`
- `docs/07-backend-standard.md`
- `docs/06-admin-public-ui-standard.md`
- `docs/13-security-privacy.md` if present

## Mandatory rules
1. Inspect the actual Prisma schema, migrations, seed data, settings APIs, public config DTOs, cache behavior, and all references to existing setting keys before editing.
2. Never rebuild or truncate `global_settings`; preserve every current key and JSON value through an additive, versioned migration.
3. Keep `GlobalSetting` as the authoritative value store. Add only necessary metadata and translation support; do not create a second competing key-value store.
4. Treat `isPublic`, `isSecret`, `isSystem`, `isEditable`, and `isDeletable` as server-enforced policies. Never trust client-supplied flags to grant more privilege.
5. Public and secret are mutually exclusive. Never return secret plaintext from list/detail endpoints; secrets are write-only and redacted from logs, audits, errors, exports, and public config responses.
6. Public config is returned only through a server-defined allowlist DTO. Do not provide arbitrary public lookup by key. Never expose product prices through settings, SSR, cached payloads, or SEO output.
7. Enforce `settings.read`, `settings.create`, `settings.update`, and `settings.delete` at each backend endpoint. Hidden UI controls are not authorization.
8. Validate `value` against `valueType` and server-side constraints. Keys are unique and stable; key rename should be a separate controlled migration, not ordinary editing.
9. Protect system/built-in and referenced settings from deletion. If usage cannot be reliably checked, prefer marking obsolete over physical deletion.
10. Persist setting and translation changes transactionally. Apply audit logging and invalidation of server, public config, ISR/CDN, and client caches after updates.
11. Use revision/updatedAt conflict handling to avoid silent lost updates. Return actionable validation and conflict errors.
12. Infrastructure secrets (DB credentials, app signing/encryption keys) remain in deployment secret management, not ordinary editable settings.
13. Provide loading, empty, error/retry, pending-save, unsaved-change, success, and conflict states. Use existing UI components/design tokens and zh-CN/en-US translation resources.
14. Add migration tests, authorization tests, secret redaction tests, public allowlist tests, validation tests, CRUD tests, and responsive checks.
15. Report changed files, migrations, commands and actual test results; never claim tests passed unless run.
