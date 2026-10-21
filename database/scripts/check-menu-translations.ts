import { PrismaClient } from '../generated/client';

// Read-only completeness gate for the live back-office navigation. Run after a
// seed or menu import: every enabled + visible menu, including route-less
// groups, must have a non-empty zh-CN and en-US label (docs/26 §4.4).
const REQUIRED_LOCALES = ['zh-CN', 'en-US'] as const;
const prisma = new PrismaClient();

async function main() {
  const menus = await prisma.menu.findMany({
    where: { enabled: true, visible: true },
    orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    select: {
      code: true,
      translations: { select: { locale: true, label: true } },
    },
  });

  const missing: string[] = [];
  for (const menu of menus) {
    for (const locale of REQUIRED_LOCALES) {
      const label = menu.translations.find((item) => item.locale === locale)?.label.trim();
      if (!label) missing.push(`${menu.code}:${locale}`);
    }
  }

  if (missing.length > 0) {
    console.error(`Menu translation coverage failed (${missing.length} missing):`);
    for (const item of missing) console.error(`  - ${item}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Menu translation coverage OK: ${menus.length} enabled/visible menus × ${REQUIRED_LOCALES.length} locales.`,
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
