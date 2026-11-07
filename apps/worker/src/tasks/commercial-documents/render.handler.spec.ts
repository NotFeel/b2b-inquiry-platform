import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTemplateConfig } from '@b2b/commercial-documents';
import type { PrismaClient } from '@b2b/database';
import { processCommercialDocumentRender } from './render.handler';

vi.mock('./libreoffice-html.runner', () => ({
  convertHtmlWithLibreOffice: vi.fn(async () => ({ outputPath: '', durationMs: 5 })),
}));
vi.mock('./pdf-validator', () => ({
  validateCommercialPdf: vi.fn(async () => ({ sizeBytes: 9, pageCount: 1 })),
}));

const DOC_ID = 'ec6b6f8b-3f36-45ec-bc02-c11e3e5ef111';
const JOB_ID = 'f5c2e8b0-4a57-4e6b-9c7f-1f2e3d4c5b6a';
const ATTEMPT_ID = 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d';

describe('processCommercialDocumentRender', () => {
  const put = vi.fn(async () => undefined);
  const documentUpdate = vi.fn(async () => ({}));
  const jobUpdate = vi.fn(async () => ({}));

  function prismaMock() {
    return {
      documentRenderJob: {
        findUnique: vi.fn(async () => ({
          id: JOB_ID,
          attemptId: ATTEMPT_ID,
          documentId: DOC_ID,
          status: 'QUEUED',
          startedAt: null,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: jobUpdate,
      },
      commercialDocument: {
        findUnique: vi.fn(async () => ({
          id: DOC_ID,
          documentType: 'CI',
          documentNo: 'CI-20261106-ABC123',
          revisionNo: 2,
          status: 'ISSUED',
          locale: 'en-US',
          currency: 'USD',
          issueDate: new Date('2026-11-06T00:00:00.000Z'),
          validUntil: null,
          sellerSnapshot: { companyName: 'Seller' },
          buyerSnapshot: { companyName: 'Buyer' },
          consigneeSnapshot: null,
          notifyPartySnapshot: null,
          tradeSnapshot: { incotermCode: 'DDP' },
          shippingSnapshot: null,
          paymentSnapshot: null,
          declarationSnapshot: null,
          signatureSnapshot: null,
          notes: null,
          subtotal: { toString: () => '100.00' },
          discountAmount: { toString: () => '0.00' },
          freightAmount: { toString: () => '0.00' },
          insuranceAmount: { toString: () => '0.00' },
          otherCharges: { toString: () => '0.00' },
          totalAmount: { toString: () => '100.00' },
          order: { orderNo: 'O-1', orderDate: new Date('2026-11-05T00:00:00.000Z') },
          template: null,
          templateVersion: { config: createDefaultTemplateConfig('CI') },
          items: [],
        })),
        update: documentUpdate,
      },
      fileAsset: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the rendered PDF privately and links it to the document', async () => {
    const workspace = await fs.mkdtemp(join(tmpdir(), 'commercial-render-spec-'));
    const pdfPath = join(workspace, 'document.pdf');
    await fs.writeFile(pdfPath, '%PDF-1.7 test');
    const { convertHtmlWithLibreOffice } = await import('./libreoffice-html.runner');
    vi.mocked(convertHtmlWithLibreOffice).mockResolvedValue({ outputPath: pdfPath, durationMs: 5 });

    await processCommercialDocumentRender(
      { jobId: JOB_ID, attemptId: ATTEMPT_ID },
      {
        prisma: prismaMock(),
        storage: { put, get: vi.fn(), delete: vi.fn(), exists: vi.fn(), readStream: vi.fn() },
        env: {
          WORKER_TMP_DIR: tmpdir(),
          EXCEL_PDF_CONVERTER_PATH: '/usr/bin/soffice',
          EXCEL_PDF_PDFINFO_PATH: '/usr/bin/pdfinfo',
          COMMERCIAL_DOCUMENT_RENDER_TIMEOUT_MS: 10_000,
          COMMERCIAL_DOCUMENT_PDF_MAX_BYTES: 1_000_000,
          COMMERCIAL_DOCUMENT_PDF_MAX_PAGES: 10,
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );

    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^private/commercial-documents/${DOC_ID}/r2-${ATTEMPT_ID}\\.pdf$`),
      ),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(documentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DOC_ID },
        data: expect.objectContaining({ pdfFileKey: expect.stringContaining(DOC_ID) }),
      }),
    );
    await fs.rm(workspace, { recursive: true, force: true });
  });
});
