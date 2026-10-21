-- Reference data for structured content operations (menus, permissions,
-- credential types and the two homepage section records). The statements are
-- idempotent so this migration can be replayed in test environments.

INSERT INTO permissions (id, code, "nameKey", module, "createdAt")
SELECT gen_random_uuid(), v.code, 'permission.' || v.code, 'content', now()
FROM (VALUES
  ('content.factory-media.read'),
  ('content.factory-media.create'),
  ('content.factory-media.update'),
  ('content.factory-media.publish'),
  ('content.factory-media.delete'),
  ('content.factory-process.read'),
  ('content.factory-process.create'),
  ('content.factory-process.update'),
  ('content.factory-process.publish'),
  ('content.factory-process.delete'),
  ('content.credentials.read'),
  ('content.credentials.create'),
  ('content.credentials.update'),
  ('content.credentials.publish'),
  ('content.credentials.delete'),
  ('content.home-sections.read'),
  ('content.home-sections.create'),
  ('content.home-sections.update'),
  ('content.home-sections.publish'),
  ('content.home-sections.delete')
) AS v(code)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);

INSERT INTO role_permissions ("roleId", "permissionCode")
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES
  ('content.factory-media.read'),
  ('content.factory-media.create'),
  ('content.factory-media.update'),
  ('content.factory-media.publish'),
  ('content.factory-media.delete'),
  ('content.factory-process.read'),
  ('content.factory-process.create'),
  ('content.factory-process.update'),
  ('content.factory-process.publish'),
  ('content.factory-process.delete'),
  ('content.credentials.read'),
  ('content.credentials.create'),
  ('content.credentials.update'),
  ('content.credentials.publish'),
  ('content.credentials.delete'),
  ('content.home-sections.read'),
  ('content.home-sections.create'),
  ('content.home-sections.update'),
  ('content.home-sections.publish'),
  ('content.home-sections.delete')
) AS v(code)
WHERE r.code = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp."roleId" = r.id AND rp."permissionCode" = v.code
  );

INSERT INTO role_permissions ("roleId", "permissionCode")
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES
  ('content.factory-media.read'),
  ('content.factory-media.create'),
  ('content.factory-media.update'),
  ('content.factory-media.publish'),
  ('content.factory-process.read'),
  ('content.factory-process.create'),
  ('content.factory-process.update'),
  ('content.factory-process.publish'),
  ('content.credentials.read'),
  ('content.credentials.create'),
  ('content.credentials.update'),
  ('content.credentials.publish'),
  ('content.home-sections.read'),
  ('content.home-sections.create'),
  ('content.home-sections.update'),
  ('content.home-sections.publish')
) AS v(code)
WHERE r.code = 'catalog_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp."roleId" = r.id AND rp."permissionCode" = v.code
  );

INSERT INTO role_permissions ("roleId", "permissionCode")
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES
  ('content.factory-media.read'),
  ('content.factory-process.read'),
  ('content.credentials.read'),
  ('content.home-sections.read')
) AS v(code)
WHERE r.code = 'viewer'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp."roleId" = r.id AND rp."permissionCode" = v.code
  );

INSERT INTO menus (
  id, code, "parentId", route, icon, "permissionCode",
  "sortOrder", visible, enabled, external, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), v.code, parent.id, v.route, v.icon, v.permission,
  v.sort_order, true, true, false, now(), now()
FROM (VALUES
  ('content.factory-media', '/content/factory-media', 'image', 'content.factory-media.read', 53),
  ('content.factory-process', '/content/factory-process', 'swap', 'content.factory-process.read', 54),
  ('content.credentials', '/content/credentials', 'document', 'content.credentials.read', 55),
  ('content.home-sections', '/content/home-sections', 'grid', 'content.home-sections.read', 56)
) AS v(code, route, icon, permission, sort_order)
CROSS JOIN (SELECT id FROM menus WHERE code = 'content-management') parent
WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.code = v.code);

INSERT INTO menu_translations ("menuId", locale, label)
SELECT m.id, v.locale, v.label
FROM menus m
JOIN (VALUES
  ('content.factory-media', 'zh-CN', '工厂媒体'),
  ('content.factory-media', 'en-US', 'Factory media'),
  ('content.factory-process', 'zh-CN', '生产流程'),
  ('content.factory-process', 'en-US', 'Factory process'),
  ('content.credentials', 'zh-CN', '证书与荣誉'),
  ('content.credentials', 'en-US', 'Certificates & awards'),
  ('content.home-sections', 'zh-CN', '首页区块'),
  ('content.home-sections', 'en-US', 'Homepage sections')
) AS v(code, locale, label) ON v.code = m.code
WHERE NOT EXISTS (
  SELECT 1 FROM menu_translations mt
  WHERE mt."menuId" = m.id AND mt.locale = v.locale
);

INSERT INTO dictionary_types (
  id, code, "nameKey", description, "systemLocked", enabled, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), 'credential_type', 'dictionary.credential_type',
  'Certificate, report, award and exhibition types', false, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM dictionary_types dt WHERE dt.code = 'credential_type');

INSERT INTO dictionary_items (
  id, "typeId", code, value, "sortOrder", enabled, "systemLocked", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), dt.id, v.code, NULL, v.sort_order, true, false, now(), now()
FROM dictionary_types dt
JOIN (VALUES
  ('certificate', 10),
  ('test_report', 20),
  ('award', 30),
  ('exhibition', 40),
  ('other', 90)
) AS v(code, sort_order) ON true
WHERE dt.code = 'credential_type'
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_items di
    WHERE di."typeId" = dt.id AND di.code = v.code
  );

INSERT INTO dictionary_item_translations ("itemId", locale, label)
SELECT di.id, v.locale, v.label
FROM dictionary_items di
JOIN dictionary_types dt ON dt.id = di."typeId"
JOIN (VALUES
  ('certificate', 'zh-CN', '证书'),
  ('certificate', 'en-US', 'Certificate'),
  ('test_report', 'zh-CN', '检测/测试报告'),
  ('test_report', 'en-US', 'Test report'),
  ('award', 'zh-CN', '奖项'),
  ('award', 'en-US', 'Award'),
  ('exhibition', 'zh-CN', '展会记录'),
  ('exhibition', 'en-US', 'Exhibition'),
  ('other', 'zh-CN', '其他资质'),
  ('other', 'en-US', 'Other credential')
) AS v(code, locale, label) ON v.code = di.code
WHERE dt.code = 'credential_type'
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_item_translations dit
    WHERE dit."itemId" = di.id AND dit.locale = v.locale
  );

INSERT INTO home_sections (
  id, code, enabled, "displayLimit", "sortOrder", "itemIds", "ctaUrl",
  "adminNote", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), v.code, false, 4, v.sort_order, ARRAY[]::TEXT[], NULL, NULL, now(), now()
FROM (VALUES
  ('home.factory-preview', 10),
  ('home.quality-preview', 20)
) AS v(code, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM home_sections hs WHERE hs.code = v.code);

INSERT INTO home_section_translations ("sectionId", locale, title, description, "ctaLabel")
SELECT hs.id, v.locale, v.title, v.description, v.cta
FROM home_sections hs
JOIN (VALUES
  ('home.factory-preview', 'zh-CN', '工厂实力预览', '精选工厂照片与视频', '了解工厂'),
  ('home.factory-preview', 'en-US', 'Meet our factory', 'Selected factory photos and videos', 'Explore factory'),
  ('home.quality-preview', 'zh-CN', '品质与荣誉预览', '精选证书与奖项', '查看品质'),
  ('home.quality-preview', 'en-US', 'Quality & awards', 'Selected certificates and awards', 'Explore quality')
) AS v(code, locale, title, description, cta) ON v.code = hs.code
WHERE NOT EXISTS (
  SELECT 1 FROM home_section_translations hst
  WHERE hst."sectionId" = hs.id AND hst.locale = v.locale
);
