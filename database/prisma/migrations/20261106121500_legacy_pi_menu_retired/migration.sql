-- The legacy PI page stays reachable for historical bookmarks, but the sidebar
-- now points to the unified Commercial Documents workspace (docs/41 §5.1).
-- This is a navigation change only: no PI rows, files or permissions are removed.
UPDATE "menus"
SET "enabled" = false, "updatedAt" = now()
WHERE "code" = 'pi-documents';
