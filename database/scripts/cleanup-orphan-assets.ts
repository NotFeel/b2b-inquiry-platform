import { PrismaClient } from '../generated/client';

// Maintenance script: reports file assets that nothing references.
//
// docs/11 §6 requires maintenance scripts to default to a dry run, print the
// affected count, and only delete with an explicit --apply while leaving an
// audit record. Deleting the row also queues the physical object for removal
// through file_deletion_jobs, so storage and database stay consistent.
//
// Run: node scripts/exec.mjs tsx scripts/cleanup-orphan-assets.ts [--apply]

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const [snapshotAssetReferences, templateReferences, orphanCandidates] = await Promise.all([
    prisma.$queryRaw<{ assetId: string }[]>`
      SELECT DISTINCT snapshot ->> 'imageSnapshotAssetId' AS "assetId"
      FROM (
        SELECT "productDataSnapshot" AS snapshot FROM quotation_items
        UNION ALL
        SELECT "productDataSnapshot" AS snapshot FROM order_items
      ) AS history_items
      WHERE snapshot ? 'imageSnapshotAssetId'
        AND jsonb_typeof(snapshot -> 'imageSnapshotAssetId') = 'string'
    `,
    prisma.quoteTemplate.findMany({ select: { storageKey: true } }),
    prisma.fileAsset.findMany({
      where: {
        // An asset is orphaned when no product, category, ad or job references it.
        productImages: { none: {} },
        categoryCovers: { none: {} },
        adDesktopFor: { none: {} },
        adMobileFor: { none: {} },
        pdfSources: { none: {} },
      },
      select: { id: true, storageKey: true, purpose: true, sizeBytes: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  // Historical quotation images are referenced from the existing JSON snapshot
  // instead of a relation column; they remain retained for the quotation/order lifetime.
  const snapshotAssetIds = new Set(snapshotAssetReferences.map((reference) => reference.assetId));
  const templateStorageKeys = new Set(templateReferences.map((template) => template.storageKey));
  const orphans = orphanCandidates.filter(
    (asset) => !snapshotAssetIds.has(asset.id) && !templateStorageKeys.has(asset.storageKey),
  );

  const totalBytes = orphans.reduce((sum, asset) => sum + Number(asset.sizeBytes), 0);
  console.log(`orphaned assets: ${orphans.length} (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);
  for (const asset of orphans) {
    console.log(`  - ${asset.purpose} ${asset.storageKey} (${asset.createdAt.toISOString()})`);
  }

  if (orphans.length === 0) return;

  if (!apply) {
    console.log('dry run: re-run with --apply to remove these assets and queue their objects');
    return;
  }

  for (const asset of orphans) {
    await prisma.$transaction([
      prisma.fileDeletionJob.create({
        data: {
          storageKey: asset.storageKey,
          entityType: 'file_asset',
          entityId: asset.id,
          status: 'QUEUED',
        },
      }),
      prisma.fileAsset.delete({ where: { id: asset.id } }),
    ]);
  }

  await prisma.auditLog.create({
    data: {
      action: 'maintenance.orphan_assets_removed',
      entityType: 'file_asset',
      entityId: null,
      metadata: { count: orphans.length, bytes: totalBytes, source: 'cleanup-orphan-assets' },
    },
  });
  console.log(`removed ${orphans.length} orphaned assets; deletion jobs queued for the worker`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
