import { PrismaClient, type Prisma } from '../generated/client';
import {
  DICTIONARY_TYPES,
  PRODUCT_LIFECYCLE_STATUSES,
  PROTECTED_MENU_CODES,
  PUBLISH_STATUSES,
  SETTING_DEFINITIONS,
  SYSTEM_LOCKED_DICTIONARY_TYPES,
} from '@b2b/contracts';
import { FAQ_SEED } from './faq-content';
import { MENU_SEED, type MenuSeed } from './menu-seed';

// Idempotent reference data: permissions, roles, menus, dictionaries, settings,
// content pages, FAQ entries and tags. Business sample data is only created with
// `--demo` and is clearly marked as demo content (docs/12 §1).
//
// Passwords are never created here: the initial administrator is created by
// `pnpm bootstrap:admin`, which requires an explicit environment input.

const prisma = new PrismaClient();
const withDemoData = process.argv.includes('--demo');
const referenceOnly = process.argv.includes('--reference-only');

/** Depth-first list of every menu declared by the seed, parents included. */
function flattenMenuSeed(menus: MenuSeed[]): MenuSeed[] {
  return menus.flatMap((menu) => [menu, ...flattenMenuSeed(menu.children ?? [])]);
}

const PERMISSIONS: { code: string; module: string; nameKey: string }[] = [
  ['dashboard.read', 'dashboard'],
  ['user.read', 'user'],
  ['user.create', 'user'],
  ['user.update', 'user'],
  ['user.delete', 'user'],
  ['user.role.assign', 'user'],
  ['role.read', 'role'],
  ['role.create', 'role'],
  ['role.update', 'role'],
  ['role.delete', 'role'],
  ['role.permissions.read', 'role'],
  ['role.permissions.update', 'role'],
  ['menu.read', 'menu'],
  ['menu.create', 'menu'],
  ['menu.update', 'menu'],
  ['menu.delete', 'menu'],
  ['dictionary.read', 'dictionary'],
  ['dictionary.option.read', 'dictionary'],
  ['dictionary.update', 'dictionary'],
  ['setting.read', 'setting'],
  ['setting.update', 'setting'],
  ['category.read', 'category'],
  ['category.create', 'category'],
  ['category.update', 'category'],
  ['category.delete', 'category'],
  ['product.read', 'product'],
  ['product.create', 'product'],
  ['product.update', 'product'],
  ['product.delete', 'product'],
  ['product.publish', 'product'],
  ['product.import', 'product'],
  ['product.export', 'product'],
  // Gallery and internal-price capabilities are separate permissions, so a role
  // can maintain the catalogue without being able to delete stored objects or
  // read the internal cost (docs/24 §9).
  ['product.image.upload', 'product'],
  ['product.image.update', 'product'],
  ['product.image.delete', 'product'],
  ['product.cost.read', 'product'],
  ['product.cost.update', 'product'],
  ['tag.read', 'tag'],
  ['tag.create', 'tag'],
  ['tag.update', 'tag'],
  ['tag.delete', 'tag'],
  ['ad.read', 'ad'],
  ['ad.update', 'ad'],
  ['content.read', 'content'],
  ['content.update', 'content'],
  ['content.factory-media.read', 'content'],
  ['content.factory-media.create', 'content'],
  ['content.factory-media.update', 'content'],
  ['content.factory-media.publish', 'content'],
  ['content.factory-media.delete', 'content'],
  ['content.factory-process.read', 'content'],
  ['content.factory-process.create', 'content'],
  ['content.factory-process.update', 'content'],
  ['content.factory-process.publish', 'content'],
  ['content.factory-process.delete', 'content'],
  ['content.credentials.read', 'content'],
  ['content.credentials.create', 'content'],
  ['content.credentials.update', 'content'],
  ['content.credentials.publish', 'content'],
  ['content.credentials.delete', 'content'],
  ['content.home-sections.read', 'content'],
  ['content.home-sections.create', 'content'],
  ['content.home-sections.update', 'content'],
  ['content.home-sections.publish', 'content'],
  ['content.home-sections.delete', 'content'],
  ['file.upload', 'file'],
  ['file.read', 'file'],
  ['file.delete', 'file'],
  ['quote.read', 'quote'],
  ['quote.export', 'quote'],
  ['quote.delete', 'quote'],
  ['pi.read', 'pi'],
  ['pi.create', 'pi'],
  ['pi.update', 'pi'],
  ['pi.export', 'pi'],
  ['lead.read', 'lead'],
  ['lead.create', 'lead'],
  ['lead.update', 'lead'],
  ['customer.read', 'customer'],
  ['customer.create', 'customer'],
  ['customer.export', 'customer'],
  ['analytics.read', 'analytics'],
  ['audit.read', 'audit'],
  ['job.read', 'job'],
].map(([code, module]) => ({
  code: code as string,
  module: module as string,
  nameKey: `permission.${code}`,
}));

const ROLES: {
  code: string;
  nameKey: string;
  description: string;
  permissions: string[] | 'all';
}[] = [
  {
    code: 'super_admin',
    nameKey: 'role.super_admin',
    description: 'Full access. Protected from modification by other roles.',
    permissions: 'all',
  },
  {
    code: 'catalog_manager',
    nameKey: 'role.catalog_manager',
    description: 'Manages categories, products, tags, ads and content.',
    permissions: [
      'dashboard.read',
      'category.read',
      'category.create',
      'category.update',
      'category.delete',
      'product.read',
      'product.create',
      'product.update',
      'product.delete',
      'product.publish',
      'product.import',
      'product.export',
      // The catalogue manager owns the gallery and the internal quotation price;
      // a read-only role keeps `product.read` without any of these.
      'product.image.upload',
      'product.image.update',
      'product.image.delete',
      'product.cost.read',
      'product.cost.update',
      // Business forms (product status, payment terms) read their options from
      // the shared dictionary endpoint (docs/20 §10).
      'dictionary.option.read',
      'tag.read',
      'tag.create',
      'tag.update',
      'tag.delete',
      'ad.read',
      'ad.update',
      'content.read',
      'content.update',
      'content.factory-media.read',
      'content.factory-media.create',
      'content.factory-media.update',
      'content.factory-media.publish',
      'content.factory-process.read',
      'content.factory-process.create',
      'content.factory-process.update',
      'content.factory-process.publish',
      'content.credentials.read',
      'content.credentials.create',
      'content.credentials.update',
      'content.credentials.publish',
      'content.home-sections.read',
      'content.home-sections.create',
      'content.home-sections.update',
      'content.home-sections.publish',
      'file.upload',
      'file.read',
      'file.delete',
      'quote.read',
      'quote.export',
      'pi.read',
      'pi.create',
      'pi.update',
      'pi.export',
      'job.read',
    ],
  },
  {
    code: 'sales',
    nameKey: 'role.sales',
    description: 'Handles WhatsApp inquiries and customer records.',
    permissions: [
      'dashboard.read',
      'product.read',
      'category.read',
      'dictionary.option.read',
      'lead.read',
      'lead.create',
      'lead.update',
      'customer.read',
      'customer.create',
      'analytics.read',
      'pi.read',
      'pi.create',
    ],
  },
  {
    code: 'viewer',
    nameKey: 'role.viewer',
    description: 'Read-only access to catalogue and analytics.',
    permissions: [
      'dashboard.read',
      'category.read',
      'product.read',
      'dictionary.option.read',
      'tag.read',
      'content.read',
      'content.factory-media.read',
      'content.factory-process.read',
      'content.credentials.read',
      'content.home-sections.read',
      'ad.read',
      'analytics.read',
      'job.read',
    ],
  },
];

const DICTIONARIES: {
  code: string;
  nameKey: string;
  systemLocked: boolean;
  items: { code: string; value?: string; labels: Record<string, string> }[];
}[] = [
  {
    code: 'product_lifecycle',
    nameKey: 'dictionary.product_lifecycle',
    systemLocked: true,
    items: [
      { code: 'available', value: 'available', labels: { 'zh-CN': '可用', 'en-US': 'Available' } },
      { code: 'preorder', value: 'preorder', labels: { 'zh-CN': '预售', 'en-US': 'Pre-order' } },
      {
        code: 'discontinued',
        value: 'discontinued',
        labels: { 'zh-CN': '已停产', 'en-US': 'Discontinued' },
      },
    ],
  },
  {
    code: 'publish_status',
    nameKey: 'dictionary.publish_status',
    systemLocked: true,
    items: [
      { code: 'draft', value: 'draft', labels: { 'zh-CN': '草稿', 'en-US': 'Draft' } },
      {
        code: 'published',
        value: 'published',
        labels: { 'zh-CN': '已发布', 'en-US': 'Published' },
      },
      {
        code: 'unpublished',
        value: 'unpublished',
        labels: { 'zh-CN': '已下架', 'en-US': 'Unpublished' },
      },
    ],
  },
  {
    code: 'inquiry_source',
    nameKey: 'dictionary.inquiry_source',
    systemLocked: true,
    items: [
      {
        code: 'manual',
        value: 'manual',
        labels: { 'zh-CN': '业务员登记', 'en-US': 'Manual entry' },
      },
      {
        code: 'website_click',
        value: 'website_click',
        labels: { 'zh-CN': '网站跳转', 'en-US': 'Website click' },
      },
      {
        code: 'whatsapp_webhook',
        value: 'whatsapp_webhook',
        labels: { 'zh-CN': 'WhatsApp Webhook', 'en-US': 'WhatsApp webhook' },
      },
    ],
  },
  {
    code: 'ad_placement',
    nameKey: 'dictionary.ad_placement',
    systemLocked: true,
    items: [
      {
        code: 'home-hero',
        value: 'home-hero',
        labels: { 'zh-CN': '首页主视觉', 'en-US': 'Home hero' },
      },
      {
        code: 'catalog-top',
        value: 'catalog-top',
        labels: { 'zh-CN': '目录顶部', 'en-US': 'Catalog top' },
      },
      { code: 'sidebar', value: 'sidebar', labels: { 'zh-CN': '侧边栏', 'en-US': 'Sidebar' } },
    ],
  },
  {
    code: 'payment_terms',
    nameKey: 'dictionary.payment_terms',
    systemLocked: false,
    items: [
      {
        code: 'tt-30',
        value: 'T/T 30% deposit, 70% before shipment',
        labels: { 'zh-CN': 'T/T 30% 定金', 'en-US': 'T/T 30% deposit' },
      },
      {
        code: 'lc-at-sight',
        value: 'L/C at sight',
        labels: { 'zh-CN': '即期信用证', 'en-US': 'L/C at sight' },
      },
    ],
  },
  {
    // Purely configurable options: the product form offers these as suggestions
    // while `Product.packaging` stays free text, so historical values keep
    // working (docs/20 §7.5).
    code: 'packaging_type',
    nameKey: 'dictionary.packaging_type',
    systemLocked: false,
    items: [
      { code: 'carton', labels: { 'zh-CN': '纸箱', 'en-US': 'Carton' } },
      { code: 'pallet', labels: { 'zh-CN': '托盘', 'en-US': 'Pallet' } },
      { code: 'wooden-case', labels: { 'zh-CN': '木箱', 'en-US': 'Wooden case' } },
      { code: 'custom', labels: { 'zh-CN': '定制包装', 'en-US': 'Custom packaging' } },
    ],
  },
  {
    code: 'credential_type',
    nameKey: 'dictionary.credential_type',
    systemLocked: false,
    items: [
      { code: 'certificate', labels: { 'zh-CN': '证书', 'en-US': 'Certificate' } },
      { code: 'test_report', labels: { 'zh-CN': '检测/测试报告', 'en-US': 'Test report' } },
      { code: 'award', labels: { 'zh-CN': '奖项', 'en-US': 'Award' } },
      { code: 'exhibition', labels: { 'zh-CN': '展会记录', 'en-US': 'Exhibition' } },
      { code: 'other', labels: { 'zh-CN': '其他资质', 'en-US': 'Other credential' } },
    ],
  },
];

const CONTENT_PAGES = [
  {
    slug: 'about',
    pageType: 'about',
    sortOrder: 10,
    translations: {
      'en-US': {
        title: 'About us',
        bodyHtml:
          '<p>We are a manufacturer and exporter serving B2B buyers worldwide. Our team supports OEM/ODM projects, packaging customisation and consolidated shipments.</p><p>Share your requirements on WhatsApp and a sales engineer will reply with specifications and a quotation.</p>',
        seoTitle: 'About our factory and export service',
        seoDescription: 'Manufacturer and exporter supporting OEM/ODM projects for B2B buyers.',
      },
      'zh-CN': {
        title: '关于我们',
        bodyHtml:
          '<p>我们是服务全球 B2B 买家的制造商与出口商，支持 OEM/ODM、包装定制与拼柜发货。</p>',
        seoTitle: '关于工厂与出口服务',
        seoDescription: '面向 B2B 买家的制造商与出口商。',
      },
    },
  },
  {
    slug: 'contact',
    pageType: 'contact',
    sortOrder: 20,
    translations: {
      'en-US': {
        title: 'Contact us',
        bodyHtml:
          '<p>Send us your target specifications, quantity and destination port. We reply within one business day.</p>',
        seoTitle: 'Contact our export sales team',
        seoDescription: 'Reach our export sales team for quotations and product details.',
      },
      'zh-CN': {
        title: '联系我们',
        bodyHtml: '<p>请提供目标规格、数量与目的港，我们会在一个工作日内回复。</p>',
        seoTitle: '联系出口销售团队',
        seoDescription: '获取报价与产品细节。',
      },
    },
  },
];

async function seedPermissionsAndRoles(options: { referenceOnly?: boolean } = {}) {
  const result = await prisma.$transaction(async (tx) => {
    // Record which permissions do not exist before this atomic sync. In the
    // production reference-only mode, only grants associated with newly added
    // permission codes are added to existing non-super-admin roles. This lets
    // a release grant a new feature to its default roles without rebuilding
    // their complete permission sets or restoring previously removed grants.
    const existingPermissionCodes = new Set(
      (await tx.permission.findMany({ select: { code: true } })).map(
        (permission) => permission.code,
      ),
    );
    const newPermissionCodes = new Set(
      PERMISSIONS.filter((permission) => !existingPermissionCodes.has(permission.code)).map(
        (permission) => permission.code,
      ),
    );

    for (const permission of PERMISSIONS) {
      await tx.permission.upsert({
        where: { code: permission.code },
        create: permission,
        update: { module: permission.module, nameKey: permission.nameKey },
      });
    }

    let grantsAdded = 0;
    for (const role of ROLES) {
      const existingRole = await tx.role.findUnique({
        where: { code: role.code },
        select: { id: true },
      });
      const codes = role.permissions === 'all' ? PERMISSIONS.map((p) => p.code) : role.permissions;
      const record = await tx.role.upsert({
        where: { code: role.code },
        create: {
          code: role.code,
          nameKey: role.nameKey,
          description: role.description,
          isSystem: role.code === 'super_admin',
        },
        update: { nameKey: role.nameKey, description: role.description },
      });

      if (!options.referenceOnly) {
        // The full bootstrap/development seed keeps its original authoritative
        // behaviour. Production releases use referenceOnly to avoid deleting
        // manually assigned role permissions.
        await tx.rolePermission.deleteMany({ where: { roleId: record.id } });
      }

      const roleCodes =
        options.referenceOnly && existingRole && role.permissions !== 'all'
          ? codes.filter((code) => newPermissionCodes.has(code))
          : codes;
      const created = await tx.rolePermission.createMany({
        data: roleCodes.map((code) => ({ roleId: record.id, permissionCode: code })),
        skipDuplicates: true,
      });
      grantsAdded += created.count;
    }
    return { newPermissions: newPermissionCodes.size, grantsAdded };
  }, { maxWait: 10_000, timeout: 60_000 });

  console.log(
    `seeded ${PERMISSIONS.length} permissions and ${ROLES.length} roles; ${result.newPermissions} new permission codes, ${result.grantsAdded} role grants added`,
  );
}

async function seedMenus(
  options: { preserveExistingTranslations?: boolean; disableStaleMenus?: boolean } = {},
) {
  const seededCodes = new Set<string>();

  // Every seeded menu is part of the navigation skeleton and must be declared in
  // PROTECTED_MENU_CODES, otherwise the API would allow deleting a menu the next
  // seed run recreates (docs/19 §4.5, §8.1).
  const undeclared = flattenMenuSeed(MENU_SEED).filter(
    (menu) => !PROTECTED_MENU_CODES.includes(menu.code),
  );
  if (undeclared.length > 0) {
    throw new Error(
      `Menu seed codes missing from PROTECTED_MENU_CODES: ${undeclared.map((menu) => menu.code).join(', ')}`,
    );
  }

  const upsertMenu = async (menu: MenuSeed, parentId: string | null): Promise<void> => {
    seededCodes.add(menu.code);
    const record = await prisma.menu.upsert({
      where: { code: menu.code },
      create: {
        code: menu.code,
        parentId,
        route: menu.route,
        icon: menu.icon,
        permissionCode: menu.permissionCode,
        sortOrder: menu.sortOrder,
      },
      update: {
        parentId,
        route: menu.route,
        icon: menu.icon,
        permissionCode: menu.permissionCode,
        sortOrder: menu.sortOrder,
        enabled: true,
      },
    });
    for (const [locale, label] of Object.entries(menu.labels)) {
      const where = { menuId_locale: { menuId: record.id, locale } };
      if (options.preserveExistingTranslations) {
        const existingTranslation = await prisma.menuTranslation.findUnique({ where });
        // The release seed adds missing locale labels but does not overwrite a
        // label an administrator has deliberately edited in the live database.
        if (existingTranslation) continue;
      }
      await prisma.menuTranslation.upsert({
        where,
        create: { menuId: record.id, locale, label },
        update: { label },
      });
    }
    for (const child of menu.children ?? []) {
      await upsertMenu(child, record.id);
    }
  };
  for (const menu of MENU_SEED) {
    await upsertMenu(menu, null);
  }

  // Full bootstrap can disable stale seeded entries. Production reference sync
  // leaves administrator-created/custom menu entries untouched.
  let disabledCodes: string[] = [];
  if (options.disableStaleMenus !== false) {
    const stale = await prisma.menu.findMany({ select: { id: true, code: true, enabled: true } });
    const orphans = stale.filter((menu) => !seededCodes.has(menu.code) && menu.enabled);
    for (const orphan of orphans) {
      await prisma.menu.update({ where: { id: orphan.id }, data: { enabled: false } });
      disabledCodes.push(orphan.code);
    }
  }

  console.log(
    `seeded ${MENU_SEED.length} menu groups${disabledCodes.length > 0 ? ` (disabled ${disabledCodes.length} stale: ${disabledCodes.join(', ')})` : ''}`,
  );
}

async function seedDictionaries(options: { systemLockedOnly?: boolean } = {}) {
  // The two product-status types must mirror the Prisma enums exactly, otherwise
  // the staged enum → dictionary migration could not backfill (docs/20 §7.4, §8).
  const enumParity: { type: string; codes: readonly string[] }[] = [
    { type: DICTIONARY_TYPES.productLifecycle, codes: PRODUCT_LIFECYCLE_STATUSES },
    { type: DICTIONARY_TYPES.productPublishStatus, codes: PUBLISH_STATUSES },
  ];
  for (const { type, codes } of enumParity) {
    const seeded = DICTIONARIES.find((candidate) => candidate.code === type);
    const seededCodes = (seeded?.items ?? []).map((item) => item.code).sort();
    if (seededCodes.join(',') !== [...codes].sort().join(',')) {
      throw new Error(
        `Dictionary type ${type} must mirror the Prisma enum: expected ${[...codes].sort().join(',')}, got ${seededCodes.join(',')}`,
      );
    }
  }
  for (const lockedType of SYSTEM_LOCKED_DICTIONARY_TYPES) {
    const seeded = DICTIONARIES.find((candidate) => candidate.code === lockedType);
    if (!seeded || !seeded.systemLocked) {
      throw new Error(
        `Dictionary type ${lockedType} drives application behaviour and must be seeded as systemLocked.`,
      );
    }
  }

  const dictionaries = options.systemLockedOnly
    ? DICTIONARIES.filter((type) => type.systemLocked)
    : DICTIONARIES;

  for (const type of dictionaries) {
    const record = await prisma.dictionaryType.upsert({
      where: { code: type.code },
      create: {
        code: type.code,
        nameKey: type.nameKey,
        systemLocked: type.systemLocked,
      },
      update: {
        nameKey: type.nameKey,
        systemLocked: type.systemLocked,
        ...(type.systemLocked ? { enabled: true } : {}),
      },
    });
    let sortOrder = 10;
    for (const item of type.items) {
      const itemRecord = await prisma.dictionaryItem.upsert({
        where: { typeId_code: { typeId: record.id, code: item.code } },
        create: {
          typeId: record.id,
          code: item.code,
          // `value` is a compatibility field with business meaning only where it
          // is explicitly set (payment terms); elsewhere the code is the value.
          value: item.value ?? null,
          sortOrder,
          systemLocked: type.systemLocked,
        },
        update: {
          value: item.value ?? null,
          systemLocked: type.systemLocked,
          ...(type.systemLocked ? { enabled: true } : {}),
        },
      });
      for (const [locale, label] of Object.entries(item.labels)) {
        await prisma.dictionaryItemTranslation.upsert({
          where: { itemId_locale: { itemId: itemRecord.id, locale } },
          create: { itemId: itemRecord.id, locale, label },
          update: { label },
        });
      }
      sortOrder += 10;
    }
  }

  // Legacy rows duplicated the code into `value`; clear exactly those so the
  // field means "extra business payload" everywhere. Values an administrator
  // entered (or that the seed sets explicitly, such as payment terms) are left
  // alone (docs/20 §3.2).
  const cleared = options.systemLockedOnly
    ? 0
    : await prisma.$executeRaw`
        UPDATE "dictionary_items" SET "value" = NULL
        WHERE "value" IS NOT NULL AND "value" = "code"
      `;

  console.log(
    `seeded ${dictionaries.length} dictionary types (cleared ${cleared} duplicated legacy values)`,
  );
}

async function seedSettings() {
  const defaults: {
    key: string;
    value: Prisma.InputJsonValue;
    isPublic: boolean;
    isSecret?: boolean;
  }[] = [
    {
      key: 'site.companyName',
      value: process.env.SITE_COMPANY_NAME ?? 'Your Company',
      isPublic: true,
    },
    { key: 'site.tagline', value: 'Product catalogue and WhatsApp quotation', isPublic: true },
    {
      key: 'site.contactEmail',
      value: process.env.SITE_CONTACT_EMAIL ?? 'sales@example.com',
      isPublic: true,
    },
    {
      key: 'site.contactPhone',
      value: process.env.SITE_CONTACT_PHONE ?? '+86 000 0000 0000',
      isPublic: true,
    },
    {
      key: 'site.address',
      value: process.env.SITE_ADDRESS ?? 'Add your company address in Settings',
      isPublic: true,
    },
    { key: 'site.socialLinks', value: [], isPublic: true },
    { key: 'site.legalLinks', value: [], isPublic: true },
    {
      key: 'site.whatsappNumber',
      value: process.env.WHATSAPP_BUSINESS_NUMBER ?? '',
      isPublic: true,
    },
    {
      key: 'site.batchInquiryLimit',
      value: Number(process.env.WHATSAPP_MAX_SELECTED_SKUS ?? 20),
      isPublic: true,
    },
    { key: 'site.defaultLocale', value: 'en-US', isPublic: true },
    {
      key: 'site.seoTitle',
      value: 'Wholesale product catalogue',
      isPublic: true,
    },
    {
      key: 'site.seoDescription',
      value: 'Browse our range and request a quotation on WhatsApp.',
      isPublic: true,
    },
    { key: 'site.seoKeywords', value: ['wholesale', 'B2B', 'supplier'], isPublic: true },
    { key: 'site.analyticsEnabled', value: true, isPublic: true },
    { key: 'admin.timezone', value: process.env.SITE_TIMEZONE ?? 'UTC', isPublic: false },
    {
      key: 'upload.maxBytes',
      value: Number(process.env.UPLOAD_MAX_BYTES ?? 10_485_760),
      isPublic: false,
    },
    {
      key: 'analytics.rawRetentionDays',
      value: Number(process.env.ANALYTICS_RAW_RETENTION_DAYS ?? 90),
      isPublic: false,
    },
  ];

  for (const setting of defaults) {
    const existing = await prisma.globalSetting.findUnique({ where: { key: setting.key } });
    if (existing) continue;
    await prisma.globalSetting.create({
      data: {
        key: setting.key,
        value: setting.value,
        isPublic: setting.isPublic,
        isSecret: setting.isSecret ?? false,
      },
    });
  }

  // Mirror the code registry into the database so the API can filter, validate
  // and protect built-in settings without guessing. Values are never touched
  // here (docs/21 §9 phase 1: additive metadata only).
  for (const definition of SETTING_DEFINITIONS) {
    await prisma.globalSetting.updateMany({
      where: { key: definition.key },
      data: {
        groupCode: definition.groupCode,
        valueType: definition.type,
        labelKey: definition.labelKey,
        isSystem: true,
        isEditable: true,
        isDeletable: definition.isDeletable ?? false,
        isRequired: Boolean(definition.isRequired),
        sortOrder: definition.sortOrder,
      },
    });
  }

  console.log(
    `seeded ${defaults.length} default settings and synced ${SETTING_DEFINITIONS.length} registry definitions (existing values preserved)`,
  );
}

async function seedContent() {
  for (const page of CONTENT_PAGES) {
    const record = await prisma.contentPage.upsert({
      where: { slug: page.slug },
      create: {
        slug: page.slug,
        pageType: page.pageType,
        status: 'PUBLISHED',
        sortOrder: page.sortOrder,
      },
      update: { pageType: page.pageType, sortOrder: page.sortOrder },
    });
    for (const [locale, translation] of Object.entries(page.translations)) {
      await prisma.contentPageTranslation.upsert({
        where: { pageId_locale: { pageId: record.id, locale } },
        create: {
          pageId: record.id,
          locale,
          title: translation.title,
          bodyHtml: translation.bodyHtml,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        },
        update: {
          title: translation.title,
          bodyHtml: translation.bodyHtml,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        },
      });
    }
  }

  for (const item of FAQ_SEED) {
    const record = await prisma.faqItem.upsert({
      where: { code: item.code },
      create: {
        code: item.code,
        category: item.category,
        sortOrder: item.sortOrder,
        enabled: true,
      },
      update: { category: item.category, sortOrder: item.sortOrder },
    });
    const current = await prisma.faqTranslation.findUnique({
      where: { faqId_locale: { faqId: record.id, locale: 'en-US' } },
    });
    // Upgrade only untouched legacy seed copy. If an administrator has edited
    // the question, the reviewed database content wins over the starter seed.
    if (!current || (item.legacyQuestion && current.question === item.legacyQuestion)) {
      await prisma.faqTranslation.upsert({
        where: { faqId_locale: { faqId: record.id, locale: 'en-US' } },
        create: {
          faqId: record.id,
          locale: 'en-US',
          question: item.question,
          answer: item.answer,
        },
        update: { question: item.question, answer: item.answer },
      });
    }
  }
  console.log(`seeded ${CONTENT_PAGES.length} content pages and ${FAQ_SEED.length} FAQ entries`);
}

async function seedTags() {
  // `colorToken` is one of the whitelisted style tokens (docs/23 §3.1); the
  // seed keeps the reference tags visually distinguishable out of the box.
  const tags = [
    { code: 'featured', colorToken: 'tag.brand', labels: { 'en-US': 'Featured', 'zh-CN': '精选' } },
    {
      code: 'new-arrival',
      colorToken: 'tag.info',
      labels: { 'en-US': 'New arrival', 'zh-CN': '新品' },
    },
    {
      code: 'preorder',
      colorToken: 'tag.warning',
      labels: { 'en-US': 'Pre-order', 'zh-CN': '预售' },
    },
    {
      code: 'oem',
      colorToken: 'tag.success',
      labels: { 'en-US': 'OEM available', 'zh-CN': '支持 OEM' },
    },
  ];
  for (const tag of tags) {
    const record = await prisma.tag.upsert({
      where: { code: tag.code },
      create: { code: tag.code, enabled: true, colorToken: tag.colorToken },
      // Existing rows keep whatever an administrator may have changed; only a
      // still-empty token is filled in so re-running the seed cannot overwrite
      // a deliberate styling decision.
      update: {},
    });
    if (!record.colorToken) {
      await prisma.tag.update({
        where: { id: record.id },
        data: { colorToken: tag.colorToken },
      });
    }
    for (const [locale, label] of Object.entries(tag.labels)) {
      await prisma.tagTranslation.upsert({
        where: { tagId_locale: { tagId: record.id, locale } },
        create: { tagId: record.id, locale, label },
        update: { label },
      });
    }
  }
  console.log(`seeded ${tags.length} tags`);
}

// Sample catalogue: clearly marked DEMO data, created only on request.
async function seedDemoCatalog() {
  const root = await prisma.category.upsert({
    where: { slug: 'demo-industrial-components' },
    create: {
      code: 'demo-industrial-components',
      slug: 'demo-industrial-components',
      sortOrder: 10,
      translations: {
        create: [
          { locale: 'en-US', name: 'Industrial components (demo)' },
          { locale: 'zh-CN', name: '工业零部件（演示数据）' },
        ],
      },
    },
    update: {},
  });
  const child = await prisma.category.upsert({
    where: { slug: 'demo-fasteners' },
    create: {
      code: 'demo-fasteners',
      slug: 'demo-fasteners',
      parentId: root.id,
      sortOrder: 11,
      translations: {
        create: [
          { locale: 'en-US', name: 'Fasteners (demo)' },
          { locale: 'zh-CN', name: '紧固件（演示数据）' },
        ],
      },
    },
    update: {},
  });

  const products = [
    {
      sku: 'DEMO-1001',
      slug: 'demo-hex-bolt-m12',
      name: 'Hex bolt M12 (demo)',
      isFeatured: true,
      isNew: true,
      lifecycleStatus: 'AVAILABLE' as const,
      priceCny: '2.35',
    },
    {
      sku: 'DEMO-1002',
      slug: 'demo-flat-washer-m12',
      name: 'Flat washer M12 (demo)',
      isFeatured: true,
      isNew: false,
      lifecycleStatus: 'AVAILABLE' as const,
      priceCny: '0.18',
    },
    {
      sku: 'DEMO-1003',
      slug: 'demo-nylon-lock-nut-m12',
      name: 'Nylon lock nut M12 (demo, pre-order)',
      isFeatured: false,
      isNew: true,
      lifecycleStatus: 'PREORDER' as const,
      priceCny: '0.42',
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      create: {
        sku: product.sku,
        slug: product.slug,
        categoryId: child.id,
        priceCny: product.priceCny,
        lifecycleStatus: product.lifecycleStatus,
        publishStatus: 'PUBLISHED',
        isNew: product.isNew,
        isFeatured: product.isFeatured,
        // Demo pre-order product is also curated for the home pre-order rail,
        // so a fresh demo install still shows that section.
        isPreOrder: product.lifecycleStatus === 'PREORDER',
        lengthMm: 60,
        widthMm: 20,
        heightMm: 20,
        weightGrams: 86,
        packaging: 'Carton of 200 pcs, inner box of 50 pcs (demo)',
        cartonLengthCm: 40,
        cartonWidthCm: 30,
        cartonHeightCm: 24,
        cartonWeightKg: '18.500',
        cartonQuantity: 200,
        translations: {
          create: [
            {
              locale: 'en-US',
              name: product.name,
              description:
                '<p>Demo catalogue item used to verify the storefront, WhatsApp batch inquiry and quote export flows. Replace with real product data before launch.</p>',
            },
            {
              locale: 'zh-CN',
              name: `${product.name}`,
              description: '<p>演示商品，用于验证前台与导出流程。</p>',
            },
          ],
        },
      },
      update: { categoryId: child.id },
    });
  }
  console.log(`seeded demo catalogue: 2 categories, ${products.length} products (demo)`);
}

async function seedHomeSections() {
  const sections = [
    {
      code: 'home.factory-preview',
      sortOrder: 10,
      labels: {
        'en-US': {
          title: 'Meet our factory',
          description: 'Selected factory photos and videos',
          ctaLabel: 'Explore factory',
        },
        'zh-CN': {
          title: '工厂实力预览',
          description: '精选工厂照片与视频',
          ctaLabel: '了解工厂',
        },
      },
    },
    {
      code: 'home.quality-preview',
      sortOrder: 20,
      labels: {
        'en-US': {
          title: 'Quality & awards',
          description: 'Selected certificates and awards',
          ctaLabel: 'Explore quality',
        },
        'zh-CN': {
          title: '品质与荣誉预览',
          description: '精选证书与奖项',
          ctaLabel: '查看品质',
        },
      },
    },
  ];
  for (const section of sections) {
    const record = await prisma.homeSection.upsert({
      where: { code: section.code },
      create: {
        code: section.code,
        enabled: false,
        displayLimit: 4,
        sortOrder: section.sortOrder,
        itemIds: [],
      },
      update: {},
    });
    for (const [locale, label] of Object.entries(section.labels)) {
      await prisma.homeSectionTranslation.upsert({
        where: { sectionId_locale: { sectionId: record.id, locale } },
        create: { sectionId: record.id, locale, ...label },
        update: label,
      });
    }
  }
  console.log(`seeded ${sections.length} home sections`);
}

async function main() {
  if (referenceOnly && withDemoData) {
    throw new Error('--reference-only cannot be combined with --demo.');
  }

  if (referenceOnly) {
    // Production deployment path: synchronize versioned authorization and
    // system dictionary data only. Do not reseed administrator-managed page
    // content, global setting values, tags, FAQs, home sections, or demo items.
    await seedPermissionsAndRoles({ referenceOnly: true });
    await seedMenus({ preserveExistingTranslations: true, disableStaleMenus: false });
    await seedDictionaries({ systemLockedOnly: true });
    console.log('production reference-data sync completed; business content and custom menu labels preserved');
    return;
  }

  await seedPermissionsAndRoles();
  await seedMenus();
  await seedDictionaries();
  await seedSettings();
  await seedContent();
  await seedTags();
  await seedHomeSections();
  if (withDemoData) {
    await seedDemoCatalog();
  } else {
    console.log('skipping demo catalogue (pass --demo to create it)');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
