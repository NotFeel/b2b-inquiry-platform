import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertTemplateDrawingsPreserved,
  captureTemplateDrawings,
  removeTemplateProductImages,
} from './quotation-drawing-preserver';

const TEMPLATE = readFileSync(
  resolve(process.cwd(), '../../assets/templates/B2B_Quotation_Template.xlsx'),
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=',
  'base64',
);

interface LoadedTemplate {
  workbook: ExcelJS.Workbook;
  worksheet: ExcelJS.Worksheet;
}

async function loadTemplate(buffer: Buffer = TEMPLATE): Promise<LoadedTemplate> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.getWorksheet('Quotation');
  if (!worksheet) throw new Error('Quotation worksheet missing');
  return { workbook, worksheet };
}

async function templateWithPlaceholder(range: string): Promise<Buffer> {
  const { workbook, worksheet } = await loadTemplate();
  const imageId = workbook.addImage({ buffer: PNG as never, extension: 'png' });
  worksheet.addImage(imageId, range);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function options(loaded: LoadedTemplate) {
  return {
    workbook: loaded.workbook,
    worksheet: loaded.worksheet,
    headerRow: 7,
    itemStartRow: 8,
    footerStartRow: 12,
    imageColumn: 2,
  };
}

describe('quotation drawing preservation', () => {
  it('classifies the real template logo as fixed and keeps its media and anchor', async () => {
    const loaded = await loadTemplate();
    const snapshot = captureTemplateDrawings(options(loaded));

    expect(snapshot.fixedImages).toHaveLength(1);
    expect(snapshot.productImageIds).toEqual([]);
    expect(snapshot.fixedImages[0]?.range).toMatchObject({
      tl: { nativeCol: 1, nativeRow: 1 },
      br: { nativeCol: 1, nativeRow: 4 },
    });

    const output = Buffer.from(await loaded.workbook.xlsx.writeBuffer());
    await expect(
      assertTemplateDrawingsPreserved(output, 'Quotation', snapshot),
    ).resolves.toBeUndefined();
  });

  it('removes only a product-region placeholder image', async () => {
    const loaded = await loadTemplate(await templateWithPlaceholder('B8:B8'));
    const snapshot = captureTemplateDrawings(options(loaded));

    expect(snapshot.fixedImages).toHaveLength(1);
    expect(snapshot.productImageIds).toHaveLength(1);
    removeTemplateProductImages(loaded.worksheet, snapshot);
    expect(loaded.worksheet.getImages()).toHaveLength(1);

    const output = Buffer.from(await loaded.workbook.xlsx.writeBuffer());
    await expect(
      assertTemplateDrawingsPreserved(output, 'Quotation', snapshot),
    ).resolves.toBeUndefined();
  });

  it('fails safely when a header or cross-region image cannot be classified', async () => {
    const headerImage = await loadTemplate(await templateWithPlaceholder('B7:B7'));
    expect(() => captureTemplateDrawings(options(headerImage))).toThrowError(
      expect.objectContaining({ reason: 'TEMPLATE_IMAGE_ANCHOR_AMBIGUOUS' }),
    );

    const crossRegion = await loadTemplate(await templateWithPlaceholder('B7:B8'));
    expect(() => captureTemplateDrawings(options(crossRegion))).toThrowError(
      expect.objectContaining({ reason: 'TEMPLATE_IMAGE_ANCHOR_AMBIGUOUS' }),
    );
  });
});
