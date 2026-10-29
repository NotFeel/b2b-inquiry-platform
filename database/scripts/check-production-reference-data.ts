import { PrismaClient } from '../generated/client';

const prisma = new PrismaClient();

const REQUIRED_PERMISSION_CODES = [
  'product.import',
  'product.create',
  'product.publish',
  'product.cost.update',
  'category.read',
  'dictionary.option.read',
  'tag.read',
  'product.read',
] as const;

const REQUIRED_DICTIONARIES: Record<string, string[]> = {
  publish_status: ['draft', 'published', 'unpublished'],
  product_lifecycle: ['available', 'preorder', 'discontinued'],
};

async function main(): Promise<void> {
  const problems: string[] = [];

  const validationTable = await prisma.$queryRawUnsafe<{ tableName: string | null }[]>(
    'SELECT to_regclass(\'public.product_import_validations\')::text AS "tableName"',
  );
  if (!validationTable[0]?.tableName) {
    problems.push('missing migration table: product_import_validations');
  }

  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...REQUIRED_PERMISSION_CODES] } },
    select: { code: true },
  });
  const permissionCodes = new Set(permissions.map((permission) => permission.code));
  for (const code of REQUIRED_PERMISSION_CODES) {
    if (!permissionCodes.has(code)) problems.push('missing permission: ' + code);
  }

  const importMenu = await prisma.menu.findUnique({
    where: { code: 'products.bulk-import' },
    select: {
      code: true,
      route: true,
      permissionCode: true,
      enabled: true,
      translations: { select: { locale: true, label: true } },
    },
  });
  if (!importMenu) {
    problems.push('missing menu: products.bulk-import');
  } else {
    if (importMenu.route !== '/products/bulk-import') {
      problems.push('menu products.bulk-import has an unexpected route');
    }
    if (importMenu.permissionCode !== 'product.import') {
      problems.push('menu products.bulk-import must require product.import');
    }
    if (!importMenu.enabled) problems.push('menu products.bulk-import is disabled');
    for (const locale of ['zh-CN', 'en-US']) {
      const label = importMenu.translations.find((item) => item.locale === locale)?.label.trim();
      if (!label) problems.push('menu products.bulk-import is missing translation: ' + locale);
    }
  }

  const dictionaries = await prisma.dictionaryType.findMany({
    where: { code: { in: Object.keys(REQUIRED_DICTIONARIES) } },
    select: {
      code: true,
      enabled: true,
      systemLocked: true,
      items: {
        select: {
          code: true,
          enabled: true,
          translations: { select: { locale: true, label: true } },
        },
      },
    },
  });
  const dictionaryByCode = new Map(dictionaries.map((dictionary) => [dictionary.code, dictionary] as const));
  for (const [typeCode, expectedItems] of Object.entries(REQUIRED_DICTIONARIES)) {
    const dictionary = dictionaryByCode.get(typeCode);
    if (!dictionary) {
      problems.push('missing dictionary type: ' + typeCode);
      continue;
    }
    if (!dictionary.enabled) problems.push('dictionary type ' + typeCode + ' is disabled');
    if (!dictionary.systemLocked) problems.push('dictionary type ' + typeCode + ' must be system-locked');
    const itemsByCode = new Map(dictionary.items.map((item) => [item.code, item] as const));
    for (const itemCode of expectedItems) {
      const item = itemsByCode.get(itemCode);
      if (!item) {
        problems.push('missing dictionary option: ' + typeCode + '.' + itemCode);
        continue;
      }
      if (!item.enabled) problems.push('dictionary option is disabled: ' + typeCode + '.' + itemCode);
      for (const locale of ['zh-CN', 'en-US']) {
        const label = item.translations.find((translation) => translation.locale === locale)?.label.trim();
        if (!label) {
          problems.push('missing dictionary option translation: ' + typeCode + '.' + itemCode + ':' + locale);
        }
      }
    }
  }

  const catalogManager = await prisma.role.findUnique({
    where: { code: 'catalog_manager' },
    select: { id: true },
  });
  if (!catalogManager) {
    problems.push('missing built-in role: catalog_manager');
  } else if (
    !(await prisma.rolePermission.findUnique({
      where: {
        roleId_permissionCode: {
          roleId: catalogManager.id,
          permissionCode: 'product.import',
        },
      },
      select: { roleId: true },
    }))
  ) {
    problems.push('catalog_manager is missing the product.import grant');
  }

  const superAdmin = await prisma.role.findUnique({
    where: { code: 'super_admin' },
    select: { id: true },
  });
  if (!superAdmin) {
    problems.push('missing built-in role: super_admin');
  } else if (
    !(await prisma.rolePermission.findUnique({
      where: {
        roleId_permissionCode: {
          roleId: superAdmin.id,
          permissionCode: 'product.import',
        },
      },
      select: { roleId: true },
    }))
  ) {
    problems.push('super_admin is missing the product.import grant');
  }

  if (problems.length > 0) {
    console.error('Production reference-data verification failed (' + problems.length + ' issue(s)):');
    for (const problem of problems) console.error('  - ' + problem);
    process.exitCode = 1;
    return;
  }

  console.log(
    'Production reference-data verification OK: bulk-import migration, permissions, menu translations, role grants, and product status dictionaries.',
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
