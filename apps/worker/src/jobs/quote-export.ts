import { PrismaClient } from '@b2b/database';
import ExcelJS from 'exceljs';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';

interface Payload {
  jobId: string;
  templateId: string;
  templateVersion: number;
  locale: string;
  filter: {
    categoryId?: string | null;
    includeDescendants?: boolean;
    publishStatus?: string;
    lifecycleStatus?: string;
    tag?: string;
    search?: string;
    piDocumentId?: string;
  };
}

// User-controlled text must never be interpreted as a spreadsheet formula
// (docs/08 §6). Trusted formulas only come from the template itself.
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length === 0) return '';
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/**
 * Renders a product quote or a PI workbook.
 *
 * Rows are written from a server-side projection; the caller's filters are
 * re-resolved here so a stale snapshot cannot widen the export (docs/08 §2).
 */
export async function processQuoteExport(
  payload: Payload,
  deps: { prisma: PrismaClient; storage: ObjectStorage; env: WorkerEnv; logger: WorkerLogger },
): Promise<{ fileKey: string; productCount: number }> {
  const { prisma, storage, logger } = deps;
  const job = await prisma.quoteExportJob.findUnique({ where: { id: payload.jobId } });
  if (!job) throw new Error('job.not_found');

  await prisma.quoteExportJob.update({
    where: { id: payload.jobId },
    data: { status: 'PROCESSING' },
  });

  try {
    const template = await prisma.quoteTemplate.findUnique({ where: { id: payload.templateId } });
    if (!template) throw new Error('template.not_found');

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(template.sheetName ?? 'Quote');
    const fieldMapping = (template.fieldMapping as Record<string, string>) ?? {};

    if (payload.filter.piDocumentId) {
      const document = await prisma.piDocument.findUnique({
        where: { id: payload.filter.piDocumentId },
        include: { items: { orderBy: { lineNo: 'asc' } } },
      });
      if (!document) throw new Error('pi.not_found');
      const seller = document.sellerSnapshot as Record<string, string | null>;
      const buyer = document.buyerSnapshot as Record<string, string | null>;

      worksheet.addRow(['Proforma Invoice', document.piNo]).font = { bold: true };
      worksheet.addRow(['Revision', document.revisionNo]);
      worksheet.addRow([
        'Date',
        document.issuedAt ? document.issuedAt.toISOString().slice(0, 10) : '',
      ]);
      worksheet.addRow([
        'Valid until',
        document.validUntil ? document.validUntil.toISOString().slice(0, 10) : '',
      ]);
      worksheet.addRow(['Currency', document.currency]);
      worksheet.addRow(['Seller', seller.companyName ?? '']);
      worksheet.addRow(['Buyer', buyer.companyName ?? '']);
      worksheet.addRow([]);
      worksheet.addRow([
        '#',
        'SKU',
        'Description',
        'Qty',
        'Unit',
        'Unit price',
        'Discount',
        'Amount',
      ]);
      for (const item of document.items) {
        worksheet.addRow([
          item.lineNo,
          escapeCell(item.sku),
          escapeCell(item.productNameSnapshot),
          item.quantity.toString(),
          escapeCell(item.unit),
          item.unitPrice.toString(),
          item.discountAmount.toString(),
          item.lineAmount.toString(),
        ]);
      }
      worksheet.addRow([]);
      worksheet.addRow(['', '', '', '', '', '', 'Subtotal', document.subtotal.toString()]);
      worksheet.addRow(['', '', '', '', '', '', 'Freight', document.freightAmount.toString()]);
      worksheet.addRow(['', '', '', '', '', '', 'Insurance', document.insuranceAmount.toString()]);
      worksheet.addRow(['', '', '', '', '', '', 'Other charges', document.otherCharges.toString()]);
      worksheet.addRow(['', '', '', '', '', '', 'Total', document.totalAmount.toString()]).font = {
        bold: true,
      };
    } else {
      const categoryIds = payload.filter.categoryId
        ? await resolveCategoryIds(
            prisma,
            payload.filter.categoryId,
            payload.filter.includeDescendants ?? true,
          )
        : null;

      const products = await prisma.product.findMany({
        where: {
          ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
          ...(payload.filter.publishStatus
            ? { publishStatus: payload.filter.publishStatus.toUpperCase() as 'DRAFT' }
            : {}),
          ...(payload.filter.lifecycleStatus
            ? { lifecycleStatus: payload.filter.lifecycleStatus.toUpperCase() as 'AVAILABLE' }
            : {}),
          ...(payload.filter.tag ? { tags: { some: { tag: { code: payload.filter.tag } } } } : {}),
          ...(payload.filter.search
            ? {
                OR: [
                  { sku: { contains: payload.filter.search, mode: 'insensitive' as const } },
                  {
                    translations: {
                      some: {
                        name: { contains: payload.filter.search, mode: 'insensitive' as const },
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { sku: 'asc' }],
        take: deps.env.QUOTE_EXPORT_MAX_PRODUCTS + 1,
        include: {
          translations: true,
          category: { include: { translations: true } },
          tags: { include: { tag: true } },
        },
      });
      if (products.length > deps.env.QUOTE_EXPORT_MAX_PRODUCTS) {
        throw new Error(`export.too_large:${deps.env.QUOTE_EXPORT_MAX_PRODUCTS}`);
      }
      if (products.length === 0) throw new Error('export.empty');

      const headers = [
        'SKU',
        'Name',
        'Size (mm)',
        'Weight (g)',
        'Packaging',
        'Carton (cm)',
        'Carton weight (kg)',
        'Carton qty',
        'Category',
        'Lifecycle',
        'Internal price (CNY)',
      ];
      worksheet.addRow(headers).font = { bold: true };
      void fieldMapping;

      for (const product of products) {
        const translation =
          product.translations.find((item) => item.locale === payload.locale) ??
          product.translations.find((item) => item.locale === 'en-US');
        const categoryName =
          product.category?.translations.find((item) => item.locale === payload.locale)?.name ??
          product.category?.translations[0]?.name ??
          '';
        worksheet.addRow([
          escapeCell(product.sku),
          escapeCell(translation?.name ?? ''),
          [product.lengthMm, product.widthMm, product.heightMm].filter(Boolean).join(' x '),
          product.weightGrams ?? '',
          escapeCell(product.packaging ?? ''),
          [product.cartonLengthCm, product.cartonWidthCm, product.cartonHeightCm]
            .filter(Boolean)
            .join(' x '),
          product.cartonWeightKg?.toString() ?? '',
          product.cartonQuantity ?? '',
          escapeCell(categoryName),
          escapeCell(product.lifecycleStatus.toLowerCase()),
          // Internal price: this workbook is an internal document and must never
          // be published to the storefront (docs/13 §2).
          product.priceCny?.toString() ?? '',
        ]);
      }
    }

    worksheet.columns.forEach((column) => {
      column.width = Math.max(column.width ?? 12, 14);
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileKey = `quote-exports/${new Date().toISOString().slice(0, 7)}/${payload.jobId}.xlsx`;
    await storage.put(
      fileKey,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    await prisma.quoteExportJob.update({
      where: { id: payload.jobId },
      data: {
        status: 'SUCCEEDED',
        fileKey,
        fileSizeBytes: BigInt(buffer.byteLength),
        errorCode: null,
      },
    });
    logger.info('quote_export.done', {
      jobId: payload.jobId,
      fileKey,
      sizeBytes: buffer.byteLength,
    });
    return { fileKey, productCount: job.productCount };
  } catch (error) {
    await prisma.quoteExportJob.update({
      where: { id: payload.jobId },
      data: {
        status: 'FAILED',
        errorCode: error instanceof Error ? error.message.slice(0, 100) : 'JOB_FAILED',
      },
    });
    throw error;
  }
}

async function resolveCategoryIds(
  prisma: PrismaClient,
  rootId: string,
  includeDescendants: boolean,
): Promise<string[]> {
  if (!includeDescendants) return [rootId];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, "parentId" FROM categories WHERE id = ${rootId}::uuid
      UNION ALL
      SELECT c.id, c."parentId" FROM categories c JOIN subtree s ON c."parentId" = s.id
    )
    SELECT id FROM subtree
  `;
  return rows.map((row) => row.id);
}
