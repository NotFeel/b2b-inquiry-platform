import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PERMISSIONS } from '@b2b/contracts';
import { PrismaClient } from '@b2b/database';
import { envSchema } from '../src/config/env';
import { JsonLogger } from '../src/common/logger.service';
import { AuditService } from '../src/common/services/audit.service';
import { CryptoService } from '../src/common/services/crypto.service';
import { StorageService } from '../src/common/services/storage.service';
import { DictionaryService } from '../src/modules/dictionary/dictionary.service';
import { FilesService } from '../src/modules/files/files.service';
import { ProductBulkImportService } from '../src/modules/products/product-bulk-import.service';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl.includes('@localhost:5432/b2b_import_test')) {
  throw new Error(
    'Refusing to run: DATABASE_URL must target the isolated local b2b_import_test database.',
  );
}
process.env.STORAGE_LOCAL_ROOT = resolve(process.cwd(), '../../.data/import-test-uploads');

const headers = [
  'SKU*',
  'Slug (optional)',
  'Product Name (English)*',
  'Product Description (English)',
  'Product Name (Chinese)',
  'Product Description (Chinese)',
  'Unit Length (cm)',
  'Unit Width (cm)',
  'Unit Height (cm)',
  'Unit Weight (g)',
  'Packaging Type',
  'Carton Length (cm)',
  'Carton Width (cm)',
  'Carton Height (cm)',
  'Carton Gross Weight (kg)',
  'Carton Quantity (pcs)',
  'Unit Price (CNY) [internal]',
  'Image URL(s) or Asset ID(s)',
  'Sort Order',
];

let checks = 0;
let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

async function firstTwoProductRows(source: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  const sheet = zip.file('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('fixture worksheet missing');
  const xml = (await sheet.async('string'))
    .replace(/<dimension ref="A1:S1001"\/>/, '<dimension ref="A1:S3"/>')
    .replace(/<autoFilter ref="A1:S4"/, '<autoFilter ref="A1:S3"')
    .replace(/<drawing r:id="rId2"\/>/, '')
    .replace(/<row r="(?:[4-9]|\d{2,})"[\s\S]*?<\/row>/g, '');
  const rels = zip.file('xl/worksheets/_rels/sheet1.xml.rels');
  if (rels) {
    zip.file(
      'xl/worksheets/_rels/sheet1.xml.rels',
      (await rels.async('string')).replace(/<Relationship Id="rId2"[^>]*\/>/, ''),
    );
  }
  zip.file('xl/worksheets/sheet1.xml', xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

async function invalidSecondRowWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(headers);
  sheet.addRow(['BX-INVALID-1', '', 'Valid first row']);
  sheet.addRow(['BX-INVALID-2', '', '']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function atomicRaceWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(headers);
  sheet.addRow(['BX-ATOMIC-1', '', 'Atomic first row']);
  sheet.addRow(['BX-ATOMIC-2', '', 'Atomic second row']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const prisma = new PrismaClient();
  const logger = new JsonLogger(env);
  const audit = new AuditService(prisma as never, logger);
  const storage = new StorageService(env, logger);
  const crypto = new CryptoService(env);
  const dictionary = new DictionaryService(prisma as never, logger);
  const files = new FilesService(env, prisma as never, storage, crypto, audit, logger);
  const importer = new ProductBulkImportService(env, prisma as never, dictionary, files, audit);

  console.log('Bulk import acceptance: cleaning isolated fixtures');
  try {
    await prisma.productImportValidation.deleteMany();
    await prisma.product.deleteMany();
    await prisma.adminUser.deleteMany({ where: { username: 'bulk-import-acceptance' } });
    await prisma.category.deleteMany({
      where: { code: 'bulk-import-acceptance' },
    });

    const category = await prisma.category.create({
      data: {
        code: 'bulk-import-acceptance',
        slug: 'bulk-import-acceptance',
        translations: {
          create: [
            { locale: 'en-US', name: 'Bulk Import Acceptance' },
            { locale: 'zh-CN', name: '批量导入验收' },
          ],
        },
      },
    });
    const actor = await prisma.adminUser.create({
      data: {
        username: 'bulk-import-acceptance',
        displayName: 'Bulk import acceptance',
        passwordHash: 'unused-test-only',
        mustChangePassword: false,
        userRoles: {
          create: {
            role: { connect: { code: 'super_admin' } },
          },
        },
      },
    });
    const actorContext = {
      id: actor.id,
      username: actor.username,
      roles: ['super_admin'],
      permissions: new Set<string>(Object.values(PERMISSIONS)),
    };
    const settings = {
      categoryId: category.id,
      publishStatus: 'draft' as const,
      lifecycleStatus: 'available' as const,
      tagIds: [] as string[],
      templateVersion: 'optimized-v1' as const,
    };

    const invalid = await importer.validate(
      { buffer: await invalidSecondRowWorkbook(), originalName: 'invalid.xlsx' },
      settings,
      actorContext,
      'acceptance-invalid',
    );
    check(
      'invalid row 3 reported',
      invalid.errors.some((issue) => issue.rowNumber === 3),
    );
    check('invalid workbook has no commit token', invalid.validationId === null);
    check('invalid second row creates zero products', (await prisma.product.count()) === 0);

    const actualWorkbook = await firstTwoProductRows(
      await readFile(resolve(process.cwd(), '../../docs/凡士林.xlsx')),
    );
    const validated = await importer.validate(
      { buffer: actualWorkbook, originalName: '凡士林.xlsx' },
      settings,
      actorContext,
      'acceptance-valid',
    );
    check('actual workbook extracts two images', validated.summary.imageCount === 2);
    check('actual workbook produces a commit token', Boolean(validated.validationId));
    if (!validated.validationId) {
      console.error(JSON.stringify(validated.errors, null, 2));
      throw new Error('valid workbook did not produce a token');
    }
    const committed = await importer.commit(
      validated.validationId,
      actorContext,
      'acceptance-valid-commit',
    );
    check('two valid rows create two products', committed.createdCount === 2);
    const imported = await prisma.product.findMany({
      where: { sku: { in: ['WX-FSL-2610001', 'WX-FSL-2610002'] } },
      include: { images: true, translations: true },
      orderBy: { sku: 'asc' },
    });
    check('actual workbook created both product rows', imported.length === 2);
    check(
      'actual workbook associated two images',
      imported.reduce((sum, row) => sum + row.images.length, 0) === 2,
    );
    check(
      'each imported product has one cover image',
      imported.every((row) => row.images.length === 1 && row.images[0]?.isCover),
    );
    let duplicateCommitRejected = false;
    try {
      await importer.commit(validated.validationId, actorContext, 'acceptance-duplicate-commit');
    } catch {
      duplicateCommitRejected = true;
    }
    check('same validation token cannot commit twice', duplicateCommitRejected);
    check(
      'duplicate commit keeps created count at two',
      (await prisma.product.count({
        where: { sku: { in: ['WX-FSL-2610001', 'WX-FSL-2610002'] } },
      })) === 2,
    );

    const race = await importer.validate(
      { buffer: await atomicRaceWorkbook(), originalName: 'atomic.xlsx' },
      settings,
      actorContext,
      'acceptance-atomic-validate',
    );
    if (!race.validationId) throw new Error('atomic workbook did not produce a token');
    await prisma.product.create({
      data: {
        sku: 'BX-ATOMIC-2',
        slug: 'bx-atomic-race-existing',
        categoryId: category.id,
        createdById: actor.id,
        translations: { create: { locale: 'en-US', name: 'Conflicting row' } },
      },
    });
    let rollbackRejected = false;
    try {
      await importer.commit(race.validationId, actorContext, 'acceptance-atomic-commit');
    } catch {
      rollbackRejected = true;
    }
    check('commit after SKU race is rejected', rollbackRejected);
    check(
      'failed commit leaves zero rows from that batch',
      (await prisma.product.count({ where: { sku: 'BX-ATOMIC-1' } })) === 0,
    );

    console.log(`RESULT ${failures === 0 ? 'PASS' : 'FAIL'} ${checks - failures}/${checks}`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
