/**
 * Category management acceptance run (docs/22 §13.1).
 *
 * Boots the real Nest application context and exercises the real service layer
 * against the real database: tree reads and filters, detail path/counts,
 * create/edit/reorder, duplicate code+slug, cycle and depth guards, delete
 * protection, optimistic concurrency and the storefront ancestor-visibility
 * rules for product filtering.
 *
 * Usage (needs the local Postgres/Redis from infra/docker-compose.dev.yml):
 *   pnpm --filter @b2b/api run acceptance:categories
 *   QA_ACTOR_ID=<admin user id> pnpm --filter @b2b/api run acceptance:categories
 *
 * The run creates a real multi-level catalogue (tools / auto / toys / outdoor
 * with children and products) so the workbench has data to show, and removes
 * only the nodes it created for the write-path cases.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CategoryNode } from '@b2b/contracts';
import type { CategoryTreeQueryInput } from '@b2b/validation';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CategoriesService } from '../src/modules/categories/categories.service';
import { PublicCatalogService } from '../src/modules/products/public-catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';

for (const candidate of [join(process.cwd(), '.env'), join(process.cwd(), '..', '..', '.env')]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

const ACTOR_ID = process.env.QA_ACTOR_ID ?? '';
const REQUEST_ID = 'qa-categories-acceptance';

const results: { name: string; ok: boolean; detail: string }[] = [];
let failures = 0;

function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

function expectEq(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(
    name,
    ok,
    ok
      ? `= ${JSON.stringify(actual)}`
      : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function expectTrue(name: string, condition: boolean, detail = ''): void {
  record(name, condition, detail);
}

/** Runs a write that is expected to fail and returns the stable error code. */
async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    const code = (error as { code?: string }).code;
    return typeof code === 'string' ? code : `NO_CODE(${String(error)})`;
  }
  return 'NO_THROW';
}

function flatten<T extends { children: T[] }>(nodes: T[]): T[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const categories = app.get(CategoriesService);
  const publicCatalog = app.get(PublicCatalogService);
  const prisma = app.get(PrismaService);

  const actorId =
    ACTOR_ID ||
    ((await prisma.adminUser.findFirst({ where: { username: 'admin' }, select: { id: true } }))
      ?.id ??
      '');
  if (!actorId) throw new Error('No admin user found; set QA_ACTOR_ID.');
  const actor = actorId;
  record('setup.actorResolved', true, actorId);

  const stamp = Date.now().toString(36);
  const tree = (query: Partial<CategoryTreeQueryInput> = {}): Promise<CategoryNode[]> =>
    categories.listAdminTree({ locale: 'zh-CN', ...query });

  // --------------------------------------------------------------- fixtures
  async function ensureCategory(
    code: string,
    slug: string,
    names: { zh: string; en: string },
    parentId: string | null,
    sortOrder: number,
  ): Promise<string> {
    const existing = flatten(await tree()).find((node) => node.code === code);
    if (existing) return existing.id;
    const created = await categories.create(
      {
        code,
        slug,
        parentId,
        sortOrder,
        enabled: true,
        visible: true,
        translations: [
          { locale: 'en-US', name: names.en, description: null },
          { locale: 'zh-CN', name: names.zh, description: null },
        ],
      },
      actor,
      REQUEST_ID,
    );
    return created.id;
  }

  async function ensureProduct(
    sku: string,
    slug: string,
    categoryId: string,
    publishStatus: 'DRAFT' | 'PUBLISHED',
    lifecycleStatus: 'AVAILABLE' | 'DISCONTINUED' = 'AVAILABLE',
  ): Promise<string> {
    const existing = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
    if (existing) return existing.id;
    const product = await prisma.product.create({
      data: {
        sku,
        slug,
        categoryId,
        publishStatus,
        lifecycleStatus,
        translations: {
          create: [
            { locale: 'en-US', name: sku },
            { locale: 'zh-CN', name: sku },
          ],
        },
      },
      select: { id: true },
    });
    return product.id;
  }

  const tools = await ensureCategory('tools', 'tools', { zh: '五金工具', en: 'Tools' }, null, 10);
  await ensureCategory(
    'power-tools',
    'power-tools',
    { zh: '电动工具', en: 'Power Tools' },
    tools,
    10,
  );
  const handTools = await ensureCategory(
    'hand-tools',
    'hand-tools',
    { zh: '手动工具', en: 'Hand Tools' },
    tools,
    20,
  );
  const wrenches = await ensureCategory(
    'wrenches',
    'wrenches',
    { zh: '扳手', en: 'Wrenches' },
    handTools,
    10,
  );
  await ensureCategory(
    'screwdrivers',
    'screwdrivers',
    { zh: '螺丝刀', en: 'Screwdrivers' },
    handTools,
    20,
  );
  await ensureCategory('auto', 'auto', { zh: '汽车用品', en: 'Auto Supplies' }, null, 20);
  const toys = await ensureCategory('toys', 'toys', { zh: '玩具', en: 'Toys' }, null, 30);
  const modelToys = await ensureCategory(
    'model-toys',
    'model-toys',
    { zh: '模型玩具', en: 'Model Toys' },
    toys,
    10,
  );
  const electricToys = await ensureCategory(
    'electric-toys',
    'electric-toys',
    { zh: '电动玩具', en: 'Electric Toys' },
    toys,
    20,
  );
  await ensureCategory('outdoor', 'outdoor', { zh: '运动户外', en: 'Outdoor & Sports' }, null, 40);

  await ensureProduct('QA-TOY-1001', 'qa-model-kit', modelToys, 'PUBLISHED');
  await ensureProduct('QA-TOY-1002', 'qa-electric-car', electricToys, 'PUBLISHED');
  await ensureProduct('QA-TOY-1003', 'qa-direct-toy', toys, 'PUBLISHED');
  await ensureProduct('QA-TOY-1004', 'qa-draft-toy', toys, 'DRAFT');
  await ensureProduct('QA-TOY-1005', 'qa-retired-toy', toys, 'PUBLISHED', 'DISCONTINUED');
  await ensureProduct('QA-WR-2001', 'qa-combination-wrench', wrenches, 'PUBLISHED');

  const clearance = await ensureCategory(
    'clearance',
    'clearance',
    { zh: '清仓专区', en: 'Clearance' },
    null,
    90,
  );
  await ensureProduct('QA-HIDDEN-3001', 'qa-clearance-lamp', clearance, 'PUBLISHED');
  const retired = await ensureCategory(
    'retired',
    'retired',
    { zh: '停用品类', en: 'Retired' },
    null,
    91,
  );
  const retiredChild = await ensureCategory(
    'retired-child',
    'retired-child',
    { zh: '停用子类', en: 'Retired child' },
    retired,
    10,
  );
  await ensureProduct('QA-RETIRED-4001', 'qa-retired-child-part', retiredChild, 'PUBLISHED');

  // ---------------------------------------------------- tree + filters (1,3)
  const full = await tree();
  const toysNode = flatten(full).find((node) => node.code === 'toys');
  expectTrue(
    'tree.rootsPresent',
    flatten(full).some((node) => node.code === 'tools'),
  );
  expectEq('tree.node.zhName', toysNode?.names['zh-CN'], '玩具');
  expectEq('tree.node.enName', toysNode?.names['en-US'], 'Toys');
  expectTrue(
    'tree.node.children',
    (toysNode?.children.length ?? 0) >= 2,
    `${toysNode?.children.length}`,
  );
  expectTrue(
    'tree.node.directVsTotalCounts',
    (toysNode?.totalProductCount ?? 0) > (toysNode?.productCount ?? 0),
    `direct=${toysNode?.productCount} total=${toysNode?.totalProductCount}`,
  );
  // Back-office counts deliberately include drafts and discontinued products.
  expectEq('tree.node.descendantTotal', toysNode?.totalProductCount, 5);
  expectTrue(
    'tree.node.updatedAt',
    typeof toysNode?.updatedAt === 'string' && toysNode.updatedAt.length > 0,
  );

  const searched = flatten(await tree({ q: '模型' })).map((node) => node.code);
  expectTrue(
    'tree.search.matchPlusAncestors',
    searched.includes('model-toys') && searched.includes('toys'),
    searched.join(','),
  );
  const deep = flatten(await tree({ q: '扳手' })).map((node) => node.code);
  expectTrue(
    'tree.search.deepPathKept',
    deep.includes('wrenches') && deep.includes('hand-tools') && deep.includes('tools'),
    deep.join(','),
  );
  const slugSearch = flatten(await tree({ q: 'model-toys' })).map((node) => node.code);
  expectTrue('tree.search.bySlug', slugSearch.includes('model-toys'));
  const disabledOnly = flatten(await tree({ status: 'disabled' }));
  expectTrue(
    'tree.filter.status',
    disabledOnly.every((node) => !node.enabled),
    `${disabledOnly.length} nodes`,
  );
  const emptyOnly = flatten(await tree({ hasProducts: 'without' })).map((node) => node.code);
  expectTrue(
    'tree.filter.withoutProducts',
    emptyOnly.includes('auto') && !emptyOnly.includes('toys'),
  );
  const hiddenOnly = flatten(await tree({ visibility: 'hidden' }));
  expectTrue(
    'tree.filter.visibility',
    hiddenOnly.every((node) => !node.visible),
    `${hiddenOnly.length} nodes`,
  );
  const rootsOnly = await tree({ rootOnly: true });
  expectTrue(
    'tree.filter.rootOnly',
    rootsOnly.every((node) => node.parentId === null),
  );

  // --------------------------------------------------------- detail (1,3)
  const detail = await categories.getDetail(toys, 'zh-CN');
  expectEq(
    'detail.path.rootToSelf',
    detail.path.map((entry) => entry.name),
    ['玩具'],
  );
  expectTrue('detail.children.counted', detail.children.length === 2, `${detail.children.length}`);
  expectEq('detail.counts.direct', detail.productCount, 3);
  expectEq('detail.counts.total', detail.totalProductCount, 5);
  const nestedDetail = await categories.getDetail(wrenches, 'zh-CN');
  expectEq(
    'detail.nestedPath',
    nestedDetail.path.map((entry) => entry.name),
    ['五金工具', '手动工具', '扳手'],
  );
  expectEq('detail.parentName', nestedDetail.parentName, '手动工具');

  // ------------------------------------------------- create (2) + duplicates
  const qaRootId = await ensureCategory(
    `qa-root-${stamp}`,
    `qa-root-${stamp}`,
    { zh: '验收根品类', en: 'QA Root' },
    null,
    100,
  );
  record('create.root', Boolean(qaRootId));
  const qaChildId = await ensureCategory(
    `qa-child-${stamp}`,
    `qa-child-${stamp}`,
    { zh: '验收子品类', en: 'QA Child' },
    qaRootId,
    10,
  );
  const qaGrandChildId = await ensureCategory(
    `qa-grandchild-${stamp}`,
    `qa-grandchild-${stamp}`,
    { zh: '验收孙品类', en: 'QA Grandchild' },
    qaChildId,
    10,
  );
  const created = await categories.getDetail(qaGrandChildId, 'zh-CN');
  expectEq('create.multiLevelDepth', created.path.length, 3);

  const duplicateCode = await codeOf(() =>
    categories.create(
      {
        code: `qa-root-${stamp}`,
        slug: `qa-other-${stamp}`,
        sortOrder: 10,
        enabled: true,
        visible: true,
        translations: [{ locale: 'en-US', name: 'Dup code', description: null }],
      },
      actor,
      REQUEST_ID,
    ),
  );
  expectEq('create.duplicateCode', duplicateCode, 'CATEGORY_CODE_CONFLICT');

  const duplicateSlug = await codeOf(() =>
    categories.create(
      {
        code: `qa-dup-slug-${stamp}`,
        slug: `qa-root-${stamp}`,
        sortOrder: 10,
        enabled: true,
        visible: true,
        translations: [{ locale: 'en-US', name: 'Dup slug', description: null }],
      },
      actor,
      REQUEST_ID,
    ),
  );
  expectEq('create.duplicateSlug', duplicateSlug, 'CATEGORY_SLUG_CONFLICT');

  const missingParent = await codeOf(() =>
    categories.create(
      {
        code: `qa-bad-parent-${stamp}`,
        slug: `qa-bad-parent-${stamp}`,
        parentId: '00000000-0000-4000-8000-000000000000',
        sortOrder: 10,
        enabled: true,
        visible: true,
        translations: [{ locale: 'en-US', name: 'Bad parent', description: null }],
      },
      actor,
      REQUEST_ID,
    ),
  );
  expectEq('create.missingParent', missingParent, 'CATEGORY_PARENT_INVALID');

  // -------------------------------------------- edit + concurrency (2)
  const beforeRename = await categories.getDetail(qaRootId, 'zh-CN');
  await categories.update(
    qaRootId,
    { translations: [{ locale: 'zh-CN', name: '验收根品类（已改）', description: null }] },
    actor,
    REQUEST_ID,
  );
  const afterRename = await categories.getDetail(qaRootId, 'zh-CN');
  expectEq('update.zhNameChanged', afterRename.names['zh-CN'], '验收根品类（已改）');
  expectEq('update.enNameUntouched', afterRename.names['en-US'], 'QA Root');

  const staleUpdate = await codeOf(() =>
    categories.update(
      qaRootId,
      { sortOrder: 5, expectedUpdatedAt: beforeRename.updatedAt },
      actor,
      REQUEST_ID,
    ),
  );
  expectEq('update.staleVersionRejected', staleUpdate, 'CATEGORY_CONCURRENT_UPDATE');

  await categories.update(
    qaRootId,
    { slug: `qa-root-${stamp}-renamed`, expectedUpdatedAt: afterRename.updatedAt },
    actor,
    REQUEST_ID,
  );
  const afterSlug = await categories.getDetail(qaRootId, 'zh-CN');
  expectEq('update.slugChanged', afterSlug.slug, `qa-root-${stamp}-renamed`);

  // ------------------------------------------- cycle + depth guards (3)
  expectEq(
    'guard.selfParent',
    await codeOf(() => categories.move(qaRootId, qaRootId, actor, REQUEST_ID)),
    'CATEGORY_CYCLE_DETECTED',
  );
  expectEq(
    'guard.moveIntoDescendant',
    await codeOf(() => categories.move(qaRootId, qaGrandChildId, actor, REQUEST_ID)),
    'CATEGORY_CYCLE_DETECTED',
  );
  expectEq(
    'guard.updateParentIntoDescendant',
    await codeOf(() =>
      categories.update(qaRootId, { parentId: qaGrandChildId }, actor, REQUEST_ID),
    ),
    'CATEGORY_CYCLE_DETECTED',
  );
  await categories.move(qaGrandChildId, qaRootId, actor, REQUEST_ID);
  expectEq('guard.validMove', (await categories.getDetail(qaGrandChildId, 'zh-CN')).path.length, 2);

  const chain: string[] = [qaRootId];
  let chainParent = qaRootId;
  for (let level = 2; level <= 8; level += 1) {
    const next = await ensureCategory(
      `qa-depth-${stamp}-${level}`,
      `qa-depth-${stamp}-${level}`,
      { zh: `第${level}层`, en: `Depth ${level}` },
      chainParent,
      10,
    );
    chain.push(next);
    chainParent = next;
  }
  expectEq('depth.chainOfEight', chain.length, 8);
  expectEq(
    'depth.ninthLevelRejected',
    await codeOf(() =>
      categories.create(
        {
          code: `qa-depth-${stamp}-9`,
          slug: `qa-depth-${stamp}-9`,
          parentId: chainParent,
          sortOrder: 10,
          enabled: true,
          visible: true,
          translations: [{ locale: 'en-US', name: 'Depth 9', description: null }],
        },
        actor,
        REQUEST_ID,
      ),
    ),
    'CATEGORY_DEPTH_EXCEEDED',
  );
  expectEq(
    'depth.deepMoveRejected',
    await codeOf(() => categories.move(qaRootId, wrenches, actor, REQUEST_ID)),
    'CATEGORY_DEPTH_EXCEEDED',
  );

  // ------------------------------------------------------ reorder (2)
  const siblings = (await categories.getDetail(handTools, 'zh-CN')).children.map(
    (child) => child.id,
  );
  expectTrue('reorder.siblingsLoaded', siblings.length >= 2, `${siblings.length}`);
  const reversed = [...siblings].reverse();
  await categories.reorder(handTools, reversed, actor, REQUEST_ID);
  expectEq(
    'reorder.persisted',
    (await categories.getDetail(handTools, 'zh-CN')).children.map((child) => child.id),
    reversed,
  );
  await categories.reorder(handTools, siblings, actor, REQUEST_ID);
  expectEq(
    'reorder.partialRejected',
    await codeOf(() => categories.reorder(handTools, [siblings[0] as string], actor, REQUEST_ID)),
    'VALIDATION_FAILED',
  );
  expectEq(
    'reorder.foreignSiblingRejected',
    await codeOf(() => categories.reorder(handTools, [...siblings, toys], actor, REQUEST_ID)),
    'VALIDATION_FAILED',
  );

  // ------------------------------------------------ delete guards (3)
  expectEq(
    'delete.hasChildren',
    await codeOf(() => categories.remove(qaRootId, actor, REQUEST_ID)),
    'CATEGORY_HAS_CHILDREN',
  );
  const productCategory = await ensureCategory(
    `qa-with-product-${stamp}`,
    `qa-with-product-${stamp}`,
    { zh: '有商品的验收品类', en: 'QA category with product' },
    null,
    105,
  );
  const guardProduct = await ensureProduct(
    `QA-GUARD-${stamp.toUpperCase()}`,
    `qa-guard-${stamp}`,
    productCategory,
    'PUBLISHED',
  );
  expectEq(
    'delete.hasProducts',
    await codeOf(() => categories.remove(productCategory, actor, REQUEST_ID)),
    'CATEGORY_HAS_PRODUCTS',
  );
  const impact = await categories.deleteImpact(toys);
  expectEq('delete.impact.blockedBy', impact.blockedBy, 'children');
  expectEq('delete.impact.childCount', impact.childCount, 2);
  await prisma.product.delete({ where: { id: guardProduct } });
  expectEq(
    'delete.leafSucceeds',
    await codeOf(() => categories.remove(productCategory, actor, REQUEST_ID)),
    'NO_THROW',
  );
  expectTrue(
    'delete.leafThenGone',
    (await prisma.category.findUnique({ where: { id: productCategory } })) === null,
  );

  // Node with neither children nor products can still be deleted.
  await categories.move(qaGrandChildId, qaChildId, actor, REQUEST_ID);
  expectEq(
    'delete.leafUnderParent',
    await codeOf(() => categories.remove(qaGrandChildId, actor, REQUEST_ID)),
    'NO_THROW',
  );

  // Audit trail written for the write path (docs/22 §8).
  const auditCount = await prisma.auditLog.count({
    where: {
      entityType: 'category',
      action: {
        in: [
          'category.create',
          'category.update',
          'category.move',
          'category.reorder',
          'category.delete',
        ],
      },
    },
  });
  expectTrue('audit.entriesWritten', auditCount > 0, `${auditCount} category audit rows`);
  const slugAudit = await prisma.auditLog.findFirst({
    where: { action: 'category.update', entityId: qaRootId },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true },
  });
  expectTrue(
    'audit.recordsFieldDiff',
    JSON.stringify(slugAudit?.metadata ?? {}).includes('slug'),
    JSON.stringify(slugAudit?.metadata ?? {}),
  );
  const descriptionAudit = JSON.stringify(slugAudit?.metadata ?? {}).includes('描述');
  expectTrue('audit.excludesLongDescriptions', !descriptionAudit);

  // ------------------------------------------------------- list view (1)
  const list = await categories.listCategories({
    locale: 'zh-CN',
    page: 1,
    pageSize: 5,
    status: 'all',
    visibility: 'all',
    hasProducts: 'all',
    sortBy: 'path',
    sortDir: 'asc',
  });
  expectEq('list.pageSize', list.pagination.pageSize, 5);
  expectTrue(
    'list.rowsCarryPath',
    list.data.every((row) => row.path.length >= 1),
  );
  expectTrue('list.maxPageSizeRespected', list.data.length <= 5);
  const listByProducts = await categories.listCategories({
    locale: 'zh-CN',
    page: 1,
    pageSize: 100,
    status: 'all',
    visibility: 'all',
    hasProducts: 'with',
    sortBy: 'path',
    sortDir: 'asc',
  });
  expectTrue(
    'list.filter.hasProducts',
    listByProducts.data.every((row) => row.totalProductCount > 0),
  );
  expectTrue(
    'list.depthReported',
    listByProducts.data.some((row) => row.depth >= 3),
    listByProducts.data.map((row) => `${row.code}:${row.depth}`).join(','),
  );

  // ----------------------------------------------- storefront (4) + filters
  const publicTree = flatten(await categories.listPublicTree('en-US')).map((node) => node.code);
  expectTrue('public.tree.hasToys', publicTree.includes('toys'), publicTree.join(','));
  expectTrue('public.tree.hasGrandChildren', publicTree.includes('wrenches'));

  await categories.update(clearance, { visible: false }, actor, REQUEST_ID);
  await categories.update(retired, { enabled: false }, actor, REQUEST_ID);
  const publicAfter = flatten(await categories.listPublicTree('en-US')).map((node) => node.code);
  expectTrue('public.tree.hiddenBranchRemoved', !publicAfter.includes('clearance'));
  expectTrue('public.tree.disabledBranchRemoved', !publicAfter.includes('retired-child'));
  expectTrue('public.tree.publicSiblingKept', publicAfter.includes('toys'));

  const toysProducts = await publicCatalog.list({
    locale: 'en-US',
    page: 1,
    pageSize: 50,
    category: 'toys',
    sortBy: 'sku',
  });
  const skus = toysProducts.data.map((item) => item.sku);
  expectTrue('public.filter.includesSelf', skus.includes('QA-TOY-1003'), skus.join(','));
  expectTrue('public.filter.includesChild', skus.includes('QA-TOY-1001'));
  expectTrue('public.filter.includesGrandChild', skus.includes('QA-TOY-1002'));
  expectTrue('public.filter.excludesDraft', !skus.includes('QA-TOY-1004'));
  expectTrue('public.filter.excludesDiscontinued', !skus.includes('QA-TOY-1005'));
  expectTrue('public.filter.excludesOtherBranch', !skus.includes('QA-WR-2001'));
  expectEq('public.filter.total', toysProducts.pagination.total, 3);

  const directOnly = await publicCatalog.list({
    locale: 'en-US',
    page: 1,
    pageSize: 50,
    category: 'toys',
    includeDescendants: false,
    sortBy: 'sku',
  });
  expectEq(
    'public.filter.directOnlySkus',
    directOnly.data.map((item) => item.sku),
    ['QA-TOY-1003'],
  );

  const hiddenFilter = await publicCatalog.list({
    locale: 'en-US',
    page: 1,
    pageSize: 50,
    category: 'clearance',
    sortBy: 'sku',
  });
  expectEq('public.filter.hiddenCategoryYieldsNothing', hiddenFilter.pagination.total, 0);

  const disabledChildFilter = await publicCatalog.list({
    locale: 'en-US',
    page: 1,
    pageSize: 50,
    category: 'retired-child',
    sortBy: 'sku',
  });
  expectEq('public.filter.disabledAncestorYieldsNothing', disabledChildFilter.pagination.total, 0);

  const unknownFilter = await publicCatalog.list({
    locale: 'en-US',
    page: 1,
    pageSize: 50,
    category: 'no-such-category',
    sortBy: 'sku',
  });
  expectEq('public.filter.unknownCategoryYieldsNothing', unknownFilter.pagination.total, 0);

  const publicDetail = await publicCatalog.detailBySlug('qa-model-kit', 'en-US');
  expectTrue(
    'public.product.breadcrumbHasCategoryPath',
    (publicDetail?.breadcrumb.length ?? 0) === 2,
    publicDetail?.breadcrumb.map((entry) => entry.name).join('>') ?? 'missing',
  );
  expectTrue(
    'public.product.noPriceField',
    publicDetail !== null &&
      !Object.keys(publicDetail).some((key) => /price|amount|cost/i.test(key)),
    Object.keys(publicDetail ?? {}).join(','),
  );

  // ------------------------------------------------------------- cleanup
  await prisma.category.delete({ where: { id: qaChildId } });
  for (const id of [...chain].reverse()) {
    await prisma.category.delete({ where: { id } });
  }
  record('cleanup.qaBranch', true);

  await app.close();
}

main()
  .then(() => {
    const total = results.length;
    process.stdout.write(`\n${total - failures} / ${total} checks passed\n`);
    if (failures > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    process.stdout.write(
      `\nRUN ABORTED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
