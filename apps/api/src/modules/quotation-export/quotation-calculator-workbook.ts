import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { safeExcelText } from './quotation-workbook';
import {
  QUOTATION_IMAGE_PADDING_PX,
  fitImageIntoCell,
  measureQuotationImageCell,
  pixelsToEmu,
} from './quotation-image-fitter';
import { inspectCalculatorQuoteTemplateWorkbook } from '../quote/calculator-quote-template-parser';

export interface CalculatorQuotationWorkbookItem {
  productId: string;
  sku: string;
  englishName: string;
  categoryLeafNameEn: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  image: {
    buffer: Buffer;
    extension: 'jpeg' | 'png';
    width: number;
    height: number;
  } | null;
}

export interface CalculatorQuotationWorkbookInput {
  templateBuffer: Buffer;
  currencyCode: string;
  items: CalculatorQuotationWorkbookItem[];
  productSubtotal: string;
  shippingCost: string;
  totalCost: string;
}

interface DrawingImage {
  imageId: string;
  range: {
    tl: { nativeCol: number; nativeRow: number };
    br?: { nativeCol: number; nativeRow: number };
  };
}

function cellText(value: ExcelJS.CellValue): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  }
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text.trim();
  }
  return '';
}

function findSummaryRows(worksheet: ExcelJS.Worksheet): [number, number, number] {
  const matches: Record<'subtotal' | 'shipping' | 'total', number[]> = {
    subtotal: [],
    shipping: [],
    total: [],
  };
  for (let rowNumber = 7; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const label = cellText(worksheet.getCell(rowNumber, 1).value).toLowerCase();
    if (label.includes('product subtotal')) matches.subtotal.push(rowNumber);
    if (label.includes('shipping cost')) matches.shipping.push(rowNumber);
    if (label.includes('total cost')) matches.total.push(rowNumber);
  }
  const [subtotalRow] = matches.subtotal;
  const [shippingRow] = matches.shipping;
  const [totalRow] = matches.total;
  if (
    matches.subtotal.length !== 1 ||
    matches.shipping.length !== 1 ||
    matches.total.length !== 1 ||
    subtotalRow === undefined ||
    shippingRow !== subtotalRow + 1 ||
    totalRow !== subtotalRow + 2
  ) {
    throw new Error('The calculator quotation template summary rows are invalid.');
  }
  return [subtotalRow, shippingRow, totalRow];
}

function copyRowStyle(source: ExcelJS.Row, target: ExcelJS.Row): void {
  target.height = source.height;
  target.hidden = source.hidden;
  target.outlineLevel = source.outlineLevel;
  source.eachCell({ includeEmpty: true }, (sourceCell, columnNumber) => {
    const targetCell = target.getCell(columnNumber);
    targetCell.style = structuredClone(sourceCell.style);
    targetCell.numFmt = sourceCell.numFmt;
    if (sourceCell.alignment) targetCell.alignment = structuredClone(sourceCell.alignment);
    targetCell.border = sourceCell.border ? structuredClone(sourceCell.border) : {};
    targetCell.fill = sourceCell.fill
      ? structuredClone(sourceCell.fill)
      : { type: 'pattern', pattern: 'none' };
    targetCell.font = sourceCell.font ? structuredClone(sourceCell.font) : {};
    targetCell.protection = sourceCell.protection ? structuredClone(sourceCell.protection) : {};
  });
}

function clearRowValues(row: ExcelJS.Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
  });
}

function exactBuffer(buffer: Buffer): ExcelJS.Buffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ExcelJS.Buffer;
}

function asExcelNumber(value: string): number {
  const decimal = new Decimal(value);
  const number = decimal.toNumber();
  if (
    !Number.isFinite(number) ||
    new Decimal(number.toString()).minus(decimal).abs().gt('0.0000000001')
  ) {
    throw new Error('A quotation value cannot be represented safely in Excel.');
  }
  return number;
}

function replaceCurrencySuffix(value: string, currencyCode: string): string {
  if (/\[\s*CURRENCY\s*\]/i.test(value)) {
    return value.replace(/\[\s*CURRENCY\s*\]/gi, currencyCode);
  }
  const suffix = new RegExp('\\(([A-Z]{3})\\)\\s*$', 'i');
  return suffix.test(value)
    ? value.replace(suffix, `(${currencyCode})`)
    : `${value.trim()} (${currencyCode})`;
}

function removeProductImages(worksheet: ExcelJS.Worksheet): void {
  const images = worksheet.getImages() as unknown as DrawingImage[];
  const removableIds = new Set(
    images
      .filter((image) => {
        return image.range.tl.nativeRow >= 6;
      })
      .map((image) => image.imageId),
  );
  const worksheetMedia = worksheet as unknown as { _media: { imageId: string }[] };
  worksheetMedia._media = worksheetMedia._media.filter((image) => !removableIds.has(image.imageId));
}

function addProductImage(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  image: NonNullable<CalculatorQuotationWorkbookItem['image']>,
): void {
  const cell = measureQuotationImageCell(worksheet, rowNumber, 2);
  const fit = fitImageIntoCell({
    sourceWidth: image.width,
    sourceHeight: image.height,
    cellWidthPx: cell.widthPx,
    cellHeightPx: cell.heightPx,
    paddingPx: QUOTATION_IMAGE_PADDING_PX,
  });
  const imageId = worksheet.workbook.addImage({
    buffer: exactBuffer(image.buffer),
    extension: image.extension,
  });
  worksheet.addImage(imageId, {
    tl: {
      nativeCol: 1,
      nativeRow: rowNumber - 1,
      nativeColOff: pixelsToEmu(fit.offsetX),
      nativeRowOff: pixelsToEmu(fit.offsetY),
    },
    ext: { width: fit.width, height: fit.height },
    editAs: 'oneCell',
  } as unknown as Parameters<ExcelJS.Worksheet['addImage']>[1]);
}

/** Fills the controlled DOC-40 template while preserving its header and visual styles. */
export async function buildCalculatorQuotationWorkbook(
  input: CalculatorQuotationWorkbookInput,
): Promise<Buffer> {
  if (input.items.length === 0) throw new Error('At least one quotation item is required.');
  const inspection = await inspectCalculatorQuoteTemplateWorkbook(input.templateBuffer);
  if (!inspection.requiredFieldsPresent) {
    throw new Error('The calculator quotation template no longer matches its validated layout.');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    input.templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const worksheet = workbook.getWorksheet('Quotation');
  if (!worksheet) throw new Error('The Quotation worksheet is missing.');

  const [subtotalRow, shippingRow, totalRow] = findSummaryRows(worksheet);
  const firstItemRow = 7;
  const templateItemCount = subtotalRow - firstItemRow;
  if (templateItemCount < 1) throw new Error('The template has no sample product row to style.');
  const styleSource = worksheet.getRow(firstItemRow);
  const rowHeight = styleSource.height ?? 60;
  const originalSummaryRows = [subtotalRow, shippingRow, totalRow];

  // Remove template-only product drawings before row edits; the logo above row 7 stays.
  removeProductImages(worksheet);
  for (const rowNumber of originalSummaryRows) {
    for (const range of [`A${rowNumber}:E${rowNumber}`, `F${rowNumber}:G${rowNumber}`]) {
      try {
        worksheet.unMergeCells(range);
      } catch {
        // Some compatible templates may store the same summary cells unmerged.
      }
    }
  }

  if (input.items.length < templateItemCount) {
    worksheet.spliceRows(firstItemRow + input.items.length, templateItemCount - input.items.length);
  } else if (input.items.length > templateItemCount) {
    worksheet.spliceRows(
      subtotalRow,
      0,
      ...Array.from({ length: input.items.length - templateItemCount }, () => []),
    );
  }

  const nextSummaryRow = firstItemRow + input.items.length;
  const summaryRows = [nextSummaryRow, nextSummaryRow + 1, nextSummaryRow + 2];
  for (const rowNumber of summaryRows) {
    worksheet.mergeCells(`A${rowNumber}:E${rowNumber}`);
    worksheet.mergeCells(`F${rowNumber}:G${rowNumber}`);
  }

  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index]!;
    const rowNumber = firstItemRow + index;
    const row = worksheet.getRow(rowNumber);
    if (rowNumber >= firstItemRow + templateItemCount) copyRowStyle(styleSource, row);
    row.height = Math.max(rowHeight, 48);
    clearRowValues(row);
    row.getCell(1).value = safeExcelText(item.sku);
    row.getCell(3).value = safeExcelText(item.englishName);
    row.getCell(4).value = safeExcelText(item.categoryLeafNameEn);
    row.getCell(5).value = asExcelNumber(item.quantity);
    row.getCell(5).numFmt = '0.###';
    row.getCell(6).value = asExcelNumber(item.unitPrice);
    row.getCell(6).numFmt = '0.00';
    row.getCell(7).value = asExcelNumber(item.lineTotal);
    row.getCell(7).numFmt = '0.00';
    if (item.image) addProductImage(worksheet, rowNumber, item.image);
  }

  const headerUnitPrice = cellText(worksheet.getCell(6, 6).value);
  const headerTotalPrice = cellText(worksheet.getCell(6, 7).value);
  worksheet.getCell(6, 6).value = safeExcelText(
    replaceCurrencySuffix(headerUnitPrice, input.currencyCode),
  );
  worksheet.getCell(6, 7).value = safeExcelText(
    replaceCurrencySuffix(headerTotalPrice, input.currencyCode),
  );

  const summaryLabels = [
    ['Product Subtotal', input.productSubtotal],
    ['Shipping Cost', input.shippingCost],
    ['Total Cost', input.totalCost],
  ] as const;
  summaryLabels.forEach(([label, amount], index) => {
    const rowNumber = summaryRows[index]!;
    const existingLabel = cellText(worksheet.getCell(rowNumber, 1).value);
    const text = existingLabel
      ? replaceCurrencySuffix(existingLabel, input.currencyCode)
      : `${label} (${input.currencyCode})`;
    worksheet.getCell(rowNumber, 1).value = safeExcelText(text);
    worksheet.getCell(rowNumber, 6).value = asExcelNumber(amount);
    worksheet.getCell(rowNumber, 6).numFmt = '0.00';
  });

  worksheet.pageSetup.printArea = `A1:G${summaryRows[2]}`;
  worksheet.autoFilter = undefined;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
