# Skill: Product Slug & Admin Navigation i18n

## When to use
Load this skill whenever changing product slug generation/validation, product create/edit routes, Admin Shell locale behavior, sidebar, menu groups, breadcrumbs, MenuTranslation data, locale switching, or navigation cache.

## Mandatory references
- `AGENTS.md`
- `docs/26-product-slug-and-admin-navigation-i18n.md`
- `docs/24-product-management-crud-and-image-storage.md`
- `docs/19-menu-management-crud-and-submenu-design.md`

## Product slug rules
1. Keep `Product.slug` unique; review actual schema and migration before changes. Do not remove the unique constraint.
2. Support manual slug plus an explicit generator strategy: English name or English name + six-digit random suffix. New product defaults to suffix enabled, but user can opt out.
3. Generate random digits on the server using `node:crypto` (`randomInt`), check candidates, and handle the database unique-constraint race. A pre-check alone is not sufficient.
4. Never silently overwrite a slug when the name changes, and never auto-regenerate an existing product slug on edit load or locale tab switch.
5. Surface manual slug conflicts as a `409` field error; don't silently replace a manually entered value.
6. Do not change published slugs without the documented warning and redirect/block policy.

## Admin navigation i18n rules
1. The locale segment in the URL is the single source of truth for admin UI locale; share it through the Admin Shell to Sidebar, Header, Breadcrumb, page labels, and navigation query.
2. Use existing `MenuTranslation(menuId, locale, label)` as the database source for menu labels. Do not add duplicate translation tables or hard-code Chinese/English labels into Sidebar.
3. Ensure every enabled/visible menu, including route-less group/parent rows, has non-empty `zh-CN` and `en-US` translations. Use an idempotent seed/backfill against existing menu IDs/codes; never create duplicate menu records to fix a translation.
4. In `en-US`, never silently fall back to Chinese. Missing translations must be observable, generate an actionable warning, and fail test/CI completeness checks. Runtime fallback must remain non-Chinese.
5. Page titles, breadcrumbs for non-menu routes, buttons, helper text, and empty/error states use the central frontend locale resources.
6. Locale switch must update route prefix, preserve valid path/query, reload matching resources and navigation, and protect unsaved forms.
7. Cache keys must include locale and authorization/user permission scope/version. Translation edits invalidate relevant locale caches; role changes invalidate affected authorization caches.
8. Menu visibility is not API authorization. Preserve existing server-side permission filtering.

## Required verification
- Unit tests: slug normalization, random suffix length, empty base fallback, max length, strategy selection.
- Integration tests: same-name products, manual collision, DB uniqueness race, editing existing product without automatic slug change.
- i18n tests: all active menus have both locales, `/en-US` sidebar and breadcrumb are English, `/zh-CN` is Chinese, deep links/refresh/switching work, cache does not mix locales or authorization scopes.
- Run the repository lint, typecheck, tests, build, and any menu translation coverage script. Report actual results; do not claim checks that were not run.
