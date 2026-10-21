# Dictionary Management Skill

## When to load

Load this skill for dictionary type/item CRUD, dictionary option APIs, locale labels, product status dictionary integration, or dictionary data migrations.

Read first:
- `AGENTS.md`
- `docs/20-dictionary-management-two-level-model.md`
- `docs/07-backend-standard.md`
- `.agents/skills/database-migration/SKILL.md`

## Mandatory model rules

1. Use the existing two-level model: `DictionaryType` (type) → `DictionaryItem` (item) → `DictionaryItemTranslation` (localized label). Do not create a parallel dictionary model before auditing current schema/data/API.
2. `DictionaryType.code` identifies the type; `DictionaryItem.code` is the stable machine value within that type; localized `label` is display-only. Never use a label or `DictionaryItem.value` as a business key.
3. Validate item type membership server-side. A lifecycle-status item cannot be used as a publish-status item even if it exists.
4. Do not delete a locked type/item, a type with child items, or an item referenced by business data. Use 409 conflicts and preserve historical readability.
5. Normal business option endpoints return enabled items by default. Administrative listing can include disabled items. Editing historical data must be able to show an existing disabled value without silently clearing it.
6. On translation, enabled, sorting, create or delete mutation, invalidate caches by typeCode and locale.
7. Use shared locale fallback: requested locale → `en-US` → `zh-CN` → stable item code; never render a blank label.
8. Protect type/item codes from casual editing after creation. Code changes require a dedicated migration of every reference.
9. System workflow dictionaries (such as product publish/lifecycle status) must have fixed, reviewed codes or an explicitly designed workflow engine. Adding an item alone must never be represented as implementing a new workflow state.
10. Use backend authorization on every endpoint, DTO validation, transaction handling, unique constraints, audit events and meaningful 400/403/404/409/422 responses.

## UI requirements

- The Dictionary page must show types separately from items, preferably master/detail on desktop and stacked navigation on mobile.
- Provide search, enabled filter, item counts, create/edit, add item, sort, translations, lock indicator and usage/deletion protections.
- Locked actions must be hidden/disabled with a reason, not shown as normal destructive actions.
- Use real API data. Do not hardcode options in product, PI, payment terms or inquiry forms.
- Shared option abstraction must expose `loading`, `error`, `empty`, retry, locale and `includeDisabled` handling.

## Migration rules

- Audit current typeId/itemCode/reference distribution before changing data.
- Never guess mappings for ambiguous codes such as `manual`, `website_click` or `whatsapp_webhook`.
- Provide backup, mapping report, pre/post counts, unmatched-row failure, transactional migration where applicable and rollback steps.
- Product status enum-to-dictionary migration must use expand/backfill/verify/switch/contract stages; do not remove enums in the same unverified migration that introduces dictionary relations.

## Testing required

Test duplicate codes, invalid locales, missing translations, disabled items, locked items, referenced item deletion, wrong type ID, insufficient permissions, stale cache, API errors, mobile layout, and product status data parity after migration. Run lint, typecheck, tests and build as required by `AGENTS.md`.
