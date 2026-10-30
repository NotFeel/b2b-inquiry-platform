import ExcelJS from 'exceljs';
import type { QuotationExportCurrency, QuotationExportHeader } from '@b2b/contracts';

export interface QuotationWorkbookProduct {
  productId: string;
  sku: string;
  englishName: string;
  unitPrice: string;
  cartonQuantity: number;
  cartonDimensions: string;
  cartonGrossWeightKg: string;
  size?: string;
  weightGrams?: number | null;
  packaging?: string | null;
  category?: string | null;
  lifecycleStatus?: string | null;
  image: {
    buffer: Buffer;
    extension: 'jpeg' | 'png';
    width: number | null;
    height: number | null;
  };
}

export interface QuotationWorkbookInput {
  header: QuotationExportHeader;
  currencyCode: QuotationExportCurrency;
  markupPercent: string;
  exchangeRate: string;
  products: QuotationWorkbookProduct[];
  generatedAt: Date;
}

const HEADER_FILL = 'FF3B3F45';
const EVEN_ROW_FILL = 'FFF3F5F7';
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
};

/** Prevents customer/product text from becoming a spreadsheet formula. */
export function safeExcelText(value: string): string {
  // Excel ignores some leading whitespace when deciding whether a cell is a
  // formula, so test the first non-whitespace character as well as the raw
  // control-character prefixes documented by spreadsheet security guidance.
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

function imageDisplaySize(image: QuotationWorkbookProduct['image']): {
  width: number;
  height: number;
} {
  const sourceWidth = image.width ?? 160;
  const sourceHeight = image.height ?? 160;
  const maxWidth = 92;
  const maxHeight = 72;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function applySectionStyle(cell: ExcelJS.Cell, size = 10, bold = false): void {
  cell.font = { name: 'Arial', size, bold, color: { argb: 'FF202124' } };
  cell.alignment = { vertical: 'middle' };
}

/**
 * Builds the customer-facing price list. This function receives only validated
 * data and never reads the database or storage (docs/36 §9).
 */
export async function buildQuotationWorkbook(input: QuotationWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'B2B Inquiry Platform';
  workbook.created = input.generatedAt;
  workbook.modified = input.generatedAt;
  workbook.calcProperties.fullCalcOnLoad = false;

  const worksheet = workbook.addWorksheet('Price List', {
    views: [{ state: 'frozen', ySplit: 7 }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:7',
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });

  worksheet.columns = [
    { key: 'sku', width: 21 },
    { key: 'image', width: 17 },
    { key: 'name', width: 34 },
    { key: 'price', width: 19 },
    { key: 'quantity', width: 20 },
    { key: 'dimensions', width: 24 },
    { key: 'weight', width: 18 },
  ];

  worksheet.mergeCells('A1:G1');
  const company = worksheet.getCell('A1');
  company.value = safeExcelText(input.header.companyName);
  company.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF111827' } };
  company.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 28;

  const contactLines = [
    `Contact: ${safeExcelText(input.header.contactPerson)}`,
    `Email: ${safeExcelText(input.header.email)}`,
    `Phone: ${safeExcelText(input.header.phone)}`,
  ];
  contactLines.forEach((value, index) => {
    const rowNumber = index + 2;
    worksheet.mergeCells(`A${rowNumber}:G${rowNumber}`);
    const cell = worksheet.getCell(`A${rowNumber}`);
    cell.value = value;
    applySectionStyle(cell);
  });

  worksheet.mergeCells('A5:G5');
  const title = worksheet.getCell('A5');
  title.value = safeExcelText(input.header.quotationTitle);
  title.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF111827' } };
  title.alignment = { vertical: 'middle' };
  worksheet.getRow(5).height = 24;

  worksheet.mergeCells('A6:G6');
  const pricing = worksheet.getCell('A6');
  pricing.value = [
    `Currency: ${input.currencyCode}`,
    `Exchange rate: 1 CNY = ${input.exchangeRate} ${input.currencyCode}`,
    `Markup: ${input.markupPercent}%`,
  ].join('   |   ');
  applySectionStyle(pricing, 10);
  pricing.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF4B5563' } };

  const headers = [
    'Product SKU',
    'Product Image',
    'Product Name',
    `Unit Price (${input.currencyCode})`,
    'Packing Quantity (PCS / carton)',
    'Case Dimensions (L × W × H cm)',
    'Gross Weight (KG)',
  ];
  const headerRow = worksheet.getRow(7);
  headerRow.values = headers;
  headerRow.height = 34;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = THIN_BORDER;
  });

  input.products.forEach((product, index) => {
    const rowIndex = index + 8;
    const row = worksheet.getRow(rowIndex);
    row.height = 78;
    row.values = [
      safeExcelText(product.sku),
      '',
      safeExcelText(product.englishName),
      null,
      null,
      null,
      null,
    ];

    const priceCell = row.getCell(4);
    priceCell.value = Number(product.unitPrice);
    priceCell.numFmt = '0.00';

    row.getCell(5).value = product.cartonQuantity;
    row.getCell(6).value = safeExcelText(product.cartonDimensions);
    row.getCell(7).value = Number(product.cartonGrossWeightKg);
    row.getCell(7).numFmt = '0.000';

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = cell.font ?? { name: 'Arial', size: 10, color: { argb: 'FF202124' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: columnNumber === 1 || columnNumber === 3 ? 'left' : 'center',
        wrapText: true,
      };
      cell.border = THIN_BORDER;
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EVEN_ROW_FILL } };
      }
    });

    const imageId = workbook.addImage({
      // ExcelJS's declaration models this as an ArrayBuffer while Node's Buffer
      // is accepted by its runtime. Copy only the exact buffer range so a pooled
      // Node Buffer cannot expose unrelated memory to the workbook writer.
      buffer: product.image.buffer.buffer.slice(
        product.image.buffer.byteOffset,
        product.image.buffer.byteOffset + product.image.buffer.byteLength,
      ) as ExcelJS.Buffer,
      extension: product.image.extension,
    });
    const size = imageDisplaySize(product.image);
    worksheet.addImage(imageId, {
      tl: { col: 1.16, row: rowIndex - 1 + 0.11 },
      ext: size,
      editAs: 'oneCell',
    });
  });

  worksheet.autoFilter = 'A7:G7';
  worksheet.pageSetup.printArea = `A1:G${Math.max(7, input.products.length + 7)}`;
  worksheet.headerFooter.oddFooter = '&LGenerated quotation&C&P / &N&RConfidential';

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function quotationFilename(currencyCode: string, generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  return `Quotation_${currencyCode}_${stamp}.xlsx`;
}
