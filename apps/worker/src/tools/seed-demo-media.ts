import { PrismaClient } from '@b2b/database';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { loadWorkerEnv } from '../env';
import { createStorage } from '../storage';

// Generates and attaches clearly-labelled DEMO placeholder imagery.
//
// Why a placeholder instead of stock product photos: docs/16 §1 forbids filling
// real catalogue gaps with invented products. These tiles exist so the demo
// environment can exercise the real pipeline (storage -> FileAsset -> public URL
// -> storefront card) end to end, and they are named `demo-*` on purpose.
// Production must use the customer's own product photography.
//
// Run: pnpm --filter @b2b/worker exec tsx src/tools/seed-demo-media.ts

const env = loadWorkerEnv();
const prisma = new PrismaClient();
const storage = createStorage(env);

const FIXTURE_DIR = resolve(process.cwd(), '..', '..', 'tests', 'fixtures', 'demo-images');
const SIZE = 1200;

type ArtKind = 'bolt' | 'washer' | 'nut';

function artFor(name: string): ArtKind {
  const value = name.toLowerCase();
  if (value.includes('washer')) return 'washer';
  if (value.includes('nut')) return 'nut';
  return 'bolt';
}

// The artwork is drawn as SVG and rasterised, so the repo keeps no binary source
// of truth: the PNG fixtures are reproducible from this function.
function buildArtSvg(kind: ArtKind): string {
  const stroke = '#0f766e';
  const accent = '#0b3b36';
  const body =
    kind === 'bolt'
      ? `
        <rect x="430" y="250" width="340" height="120" rx="12" fill="none" stroke="${accent}" stroke-width="14"/>
        <path d="M470 250v120M530 250v120M590 250v120M650 250v120M710 250v120" stroke="${accent}" stroke-width="10"/>
        <rect x="530" y="370" width="140" height="430" rx="10" fill="none" stroke="${stroke}" stroke-width="16"/>
        <rect x="500" y="800" width="200" height="60" rx="10" fill="none" stroke="${stroke}" stroke-width="16"/>
      `
      : kind === 'washer'
        ? `
        <circle cx="600" cy="600" r="300" fill="none" stroke="${stroke}" stroke-width="18"/>
        <circle cx="600" cy="600" r="140" fill="none" stroke="${accent}" stroke-width="16"/>
        <circle cx="600" cy="600" r="330" fill="none" stroke="${stroke}" stroke-width="6" opacity="0.35"/>
      `
        : `
        <path d="M600 250 900 430v340L600 950 300 770V430z" fill="none" stroke="${stroke}" stroke-width="18"/>
        <circle cx="600" cy="600" r="130" fill="none" stroke="${accent}" stroke-width="16"/>
      `;

  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f8fafc"/>
        <stop offset="100%" stop-color="#e8eef0"/>
      </linearGradient>
      <pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse">
        <path d="M120 0H0v120" fill="none" stroke="#dbe3e8" stroke-width="2"/>
      </pattern>
    </defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#grid)" opacity="0.55"/>
    <rect x="60" y="60" width="${SIZE - 120}" height="${SIZE - 120}" rx="28" fill="none" stroke="#cbd5e1" stroke-width="4"/>
    ${body}
    <rect x="88" y="88" width="240" height="56" rx="10" fill="#0f766e" opacity="0.10"/>
  </svg>`;
}

async function renderPlaceholder(sku: string, kind: ArtKind): Promise<Buffer> {
  return sharp(Buffer.from(buildArtSvg(kind)), { density: 144 })
    .resize(SIZE, SIZE, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { sku: { startsWith: 'DEMO-' } },
    include: { translations: true, images: true },
    orderBy: { sku: 'asc' },
  });

  if (products.length === 0) {
    throw new Error('No DEMO-* products found. Run `pnpm db:seed -- --demo` first.');
  }

  const tags = await prisma.tag.findMany();
  const tagByCode = new Map(tags.map((tag) => [tag.code, tag.id]));
  await mkdir(FIXTURE_DIR, { recursive: true });

  for (const product of products) {
    const english = product.translations.find((translation) => translation.locale === 'en-US');
    const kind = artFor(english?.name ?? product.sku);
    const fileName = `demo-${product.sku.toLowerCase()}.png`;
    const fixturePath = join(FIXTURE_DIR, fileName);
    const buffer = await renderPlaceholder(product.sku, kind);
    await writeFile(fixturePath, buffer);

    const storageKey = `product-image/${new Date().getUTCFullYear()}/${String(
      new Date().getUTCMonth() + 1,
    ).padStart(2, '0')}/${randomUUID()}.png`;
    await storage.put(storageKey, buffer, 'image/png');

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const asset = await prisma.fileAsset.create({
      data: {
        storageKey,
        originalName: fileName,
        mimeType: 'image/png',
        sizeBytes: BigInt(buffer.byteLength),
        sha256,
        width: SIZE,
        height: SIZE,
        purpose: 'product-image',
        status: 'ready',
        isPublic: true,
        derivatives: { variants: [], note: 'demo placeholder, no derivatives' } as never,
      },
    });

    // Replacing images keeps the script idempotent across reruns.
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.create({
      data: {
        productId: product.id,
        fileAssetId: asset.id,
        storageKey,
        altText: `${english?.name ?? product.sku} (demo placeholder image)`.slice(0, 240),
        sortOrder: 0,
        isCover: true,
        width: SIZE,
        height: SIZE,
        sizeBytes: BigInt(buffer.byteLength),
        sha256,
      },
    });

    // Demo products also carry presentation tags so the storefront can show the
    // badge/filter behaviour with real data.
    const desiredTags = ['featured', 'new-arrival', ...(product.lifecycleStatus === 'PREORDER' ? ['preorder'] : [])];
    for (const code of desiredTags) {
      const tagId = tagByCode.get(code);
      if (!tagId) continue;
      await prisma.productTag.upsert({
        where: { productId_tagId: { productId: product.id, tagId } },
        create: { productId: product.id, tagId },
        update: {},
      });
    }

    console.log(
      `attached ${fileName} -> ${product.sku} (asset ${asset.id.slice(0, 8)}…, ${buffer.byteLength} bytes)`,
    );
  }

  // Sanity check: the fixture bytes must be readable back through the same
  // storage driver the API serves from.
  const first = products[0];
  if (first) {
    const image = await prisma.productImage.findFirst({ where: { productId: first.id } });
    if (image) {
      const stored = await storage.get(image.storageKey);
      const fixture = await readFile(join(FIXTURE_DIR, `demo-${first.sku.toLowerCase()}.png`));
      if (!stored.equals(fixture)) {
        throw new Error('Stored object does not match the generated fixture.');
      }
      console.log(`verified round-trip for ${first.sku}: ${stored.byteLength} bytes`);
    }
  }

  void dirname;
  console.log(`fixtures written to ${FIXTURE_DIR}`);
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
