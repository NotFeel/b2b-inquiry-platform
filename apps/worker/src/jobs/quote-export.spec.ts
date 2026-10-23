import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@b2b/database';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import { processQuoteExport } from './quote-export';

function deps(prisma: Record<string, unknown>) {
  const put = vi.fn(async (_key: string, _bytes: Buffer, _contentType: string) => undefined);
  return {
    deps: {
      prisma: prisma as unknown as PrismaClient,
      storage: { put } as unknown as ObjectStorage,
      env: { QUOTE_EXPORT_MAX_PRODUCTS: 5_000 } as WorkerEnv,
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as WorkerLogger,
    },
    put,
  };
}

describe('processQuoteExport', () => {
  it('keeps product quote Excel export with formula-injection protection', async () => {
    const prisma = {
      quoteExportJob: {
        findUnique: vi.fn(async () => ({ id: 'export-1', productCount: 1 })),
        update: vi.fn(async () => ({})),
      },
      quoteTemplate: {
        findUnique: vi.fn(async () => ({ id: 'template-1', sheetName: 'Quote', fieldMapping: {} })),
      },
      product: {
        findMany: vi.fn(async () => [
          {
            sku: '00123',
            lengthMm: 10,
            widthMm: 20,
            heightMm: 30,
            weightGrams: 50,
            packaging: 'Box',
            cartonLengthCm: 40,
            cartonWidthCm: 50,
            cartonHeightCm: 60,
            cartonWeightKg: 2,
            cartonQuantity: 24,
            lifecycleStatus: 'AVAILABLE',
            priceCny: 12.5,
            translations: [{ locale: 'en-US', name: '=SUM(A1:A2)' }],
            category: { translations: [{ locale: 'en-US', name: 'Fasteners' }] },
            tags: [],
          },
        ]),
      },
    };
    const { deps: workerDeps, put } = deps(prisma);

    const result = await processQuoteExport(
      {
        jobId: 'export-1',
        templateId: 'template-1',
        templateVersion: 1,
        locale: 'en-US',
        filter: {},
      },
      workerDeps,
    );

    expect(result.fileKey).toMatch(/quote-exports\/\d{4}-\d{2}\/export-1\.xlsx$/);
    expect(put).toHaveBeenCalledWith(
      result.fileKey,
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const buffer = put.mock.calls[0]?.[1] as Buffer;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Quote');
    expect(sheet?.getRow(2).getCell(1).value).toBe('00123');
    expect(sheet?.getRow(2).getCell(2).value).toBe("'=SUM(A1:A2)");
    expect(sheet?.getRow(2).getCell(11).value).toBe('12.5');
  });

  it('keeps PI Excel export on the same quote-export worker', async () => {
    const prisma = {
      quoteExportJob: {
        findUnique: vi.fn(async () => ({ id: 'pi-export-1', productCount: 1 })),
        update: vi.fn(async () => ({})),
      },
      quoteTemplate: {
        findUnique: vi.fn(async () => ({ id: 'pi-template', sheetName: 'PI', fieldMapping: {} })),
      },
      piDocument: {
        findUnique: vi.fn(async () => ({
          piNo: 'PI-20261021-1001',
          revisionNo: 1,
          issuedAt: new Date('2026-10-21T00:00:00.000Z'),
          validUntil: new Date('2026-11-20T00:00:00.000Z'),
          currency: 'USD',
          sellerSnapshot: { companyName: 'Seller Ltd' },
          buyerSnapshot: { companyName: 'Buyer Ltd' },
          subtotal: { toString: () => '100.00' },
          freightAmount: { toString: () => '5.00' },
          insuranceAmount: { toString: () => '0.00' },
          otherCharges: { toString: () => '0.00' },
          totalAmount: { toString: () => '105.00' },
          items: [
            {
              lineNo: 1,
              sku: 'PI-001',
              productNameSnapshot: 'Demo product',
              quantity: { toString: () => '2' },
              unit: 'pcs',
              unitPrice: { toString: () => '50.00' },
              discountAmount: { toString: () => '0.00' },
              lineAmount: { toString: () => '100.00' },
            },
          ],
        })),
      },
    };
    const { deps: workerDeps, put } = deps(prisma);

    const result = await processQuoteExport(
      {
        jobId: 'pi-export-1',
        templateId: 'pi-template',
        templateVersion: 1,
        locale: 'en-US',
        filter: { piDocumentId: 'pi-document-1' },
      },
      workerDeps,
    );

    const buffer = put.mock.calls[0]?.[1] as Buffer;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('PI');
    expect(result.fileKey).toMatch(/quote-exports\/\d{4}-\d{2}\/pi-export-1\.xlsx$/);
    expect(sheet?.getRow(1).getCell(1).value).toBe('Proforma Invoice');
    expect(sheet?.getRow(1).getCell(2).value).toBe('PI-20261021-1001');
    expect(sheet?.getRow(16).getCell(8).value).toBe('105.00');
  });
});
