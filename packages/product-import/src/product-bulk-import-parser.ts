import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  ERROR_CODES,
  PRODUCT_IMPORT_LIMITS,
  type ProductImportIssue,
  type ProductImportTemplateVersion,
} from '@b2b/contracts';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { IMAGE_MIME_BY_KIND, detectKind, readImageDimensions } from './file-validation';

const OPTIMIZED_SHEET = 'Products';
const LEGACY_SHEET = 'Price List';

const OPTIMIZED_HEADERS = [
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
] as const;

const LEGACY_HEADERS = [
  'Product Code',
  'Product Image',
  'Product Name',
  'Price per Unit (CNY)',
  'Price per Unit (CNY)',
  'Packing Quantity (PCS)',
  'Case Dimensions (L×W×H cm)',
  'Gross Weight (KG)',
] as const;

export interface ParsedProductImage {
  source: 'wps-cellimage' | 'drawing';
  rowNumber: number;
  columnNumber: number;
  mediaName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  bytes: Buffer;
}

export interface ParsedProductRow {
  rowNumber: number;
  sku: string;
  slug: string | null;
  nameEn: string;
  descriptionEn: string | null;
  nameZh: string | null;
  descriptionZh: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightGrams: number | null;
  packaging: string | null;
  cartonLengthCm: number | null;
  cartonWidthCm: number | null;
  cartonHeightCm: number | null;
  cartonWeightKg: string | null;
  cartonQuantity: number | null;
  priceCny: string | null;
  sortOrder: number;
  images: ParsedProductImage[];
}

export interface ParsedProductWorkbook {
  templateVersion: ProductImportTemplateVersion;
  fileSha256: string;
  rows: ParsedProductRow[];
  errors: ProductImportIssue[];
  warnings: ProductImportIssue[];
  imageCount: number;
}

export interface ProductBulkImportParserOptions {
  maxBytes: number;
  maxRows: number;
  maxImageBytes: number;
  maxPixels: number;
  maxTotalUncompressedBytes: number;
}

interface RowDraft {
  rowNumber: number;
  sku: string;
  rawImageRef: { formula: string; column: number } | null;
  images: ParsedProductImage[];
  errors: ProductImportIssue[];
  row: Omit<ParsedProductRow, 'images'>;
}

interface CellImagesResult {
  byId: Map<string, Omit<ParsedProductImage, 'rowNumber' | 'columnNumber' | 'source'>>;
  errors: ProductImportIssue[];
}

export class ImportRowError extends Error {
  constructor(readonly issues: ProductImportIssue[]) {
    super(issues[0]?.messageKey ?? ERROR_CODES.importFileTypeInvalid);
  }
}

/**
 * Safe arithmetic formula evaluator for the confirmed internal-price business
 * rule. The accepted grammar is only Decimal literals, parentheses, unary signs,
 * addition, subtraction, multiplication and division.
 */
export function parseSafePriceFormula(value: string): string {
  const source = value.trim().replace(/^=/, '').trim();
  if (source.length === 0 || source.length > 120) {
    throw new Error(ERROR_CODES.importFormulaNotAllowed);
  }
  const tokens: string[] = [];
  for (let index = 0; index < source.length;) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if ('+-*/()'.includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }
    if (/\d|\./.test(char)) {
      let end = index;
      let dots = 0;
      while (end < source.length && /[\d.]/.test(source[end]!)) {
        if (source[end] === '.') dots += 1;
        end += 1;
      }
      const literal = source.slice(index, end);
      if (dots > 1 || literal === '.') throw new Error(ERROR_CODES.importFormulaNotAllowed);
      tokens.push(literal);
      index = end;
      continue;
    }
    throw new Error(ERROR_CODES.importFormulaNotAllowed);
  }

  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];
  const parseExpression = (): Decimal => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const right = parseTerm();
      value = operator === '+' ? value.plus(right) : value.minus(right);
    }
    return value;
  };
  const parseTerm = (): Decimal => {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const operator = consume();
      const right = parseFactor();
      if (operator === '/' && right.isZero()) {
        throw new Error(ERROR_CODES.importFormulaNotAllowed);
      }
      value = operator === '*' ? value.times(right) : value.dividedBy(right);
    }
    return value;
  };
  const parseFactor = (): Decimal => {
    const token = consume();
    if (token === '+') return parseFactor();
    if (token === '-') return parseFactor().negated();
    if (token === '(') {
      const value = parseExpression();
      if (consume() !== ')') throw new Error(ERROR_CODES.importFormulaNotAllowed);
      return value;
    }
    if (token === undefined || !/^\d+(?:\.\d+)?$/.test(token)) {
      throw new Error(ERROR_CODES.importFormulaNotAllowed);
    }
    return new Decimal(token);
  };

  const result = parseExpression();
  if (cursor !== tokens.length || !result.isFinite() || result.isNegative()) {
    throw new Error(ERROR_CODES.importFormulaNotAllowed);
  }
  return result.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export class ProductBulkImportParser {
  constructor(
    private readonly options: ProductBulkImportParserOptions = {
      maxBytes: PRODUCT_IMPORT_LIMITS.maxBytes,
      maxRows: PRODUCT_IMPORT_LIMITS.maxRows,
      maxImageBytes: PRODUCT_IMPORT_LIMITS.maxImageBytes,
      maxPixels: 50_000_000,
      maxTotalUncompressedBytes: PRODUCT_IMPORT_LIMITS.maxTotalUncompressedBytes,
    },
  ) {}

  async parse(buffer: Buffer): Promise<ParsedProductWorkbook> {
    this.assertWorkbookEnvelope(buffer);
    const fileSha256 = createHash('sha256').update(buffer).digest('hex');
    const zip = await this.loadArchive(buffer);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importFileTypeInvalid,
          'products.import.errors.fileType',
        ),
      ]);
    }

    const optimized = workbook.getWorksheet(OPTIMIZED_SHEET);
    const legacy = workbook.getWorksheet(LEGACY_SHEET);
    const worksheet = optimized ?? legacy;
    if (!worksheet) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importWorksheetMissing,
          'products.import.errors.worksheetMissing',
        ),
      ]);
    }
    const templateVersion: ProductImportTemplateVersion = optimized
      ? 'optimized-v1'
      : 'wps-price-list-v1';
    await this.assertNoMergedCells(zip);
    const cellImages = await this.readWpsCellImages(zip);
    const drawingImages = this.readDrawingImages(workbook, worksheet);
    const drafts =
      templateVersion === 'optimized-v1'
        ? this.readOptimizedRows(worksheet)
        : this.readLegacyRows(worksheet);
    if (drafts.length === 0) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'rows',
          ERROR_CODES.importNoDataRows,
          'products.import.errors.noDataRows',
        ),
      ]);
    }
    if (drafts.length > this.options.maxRows) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'rows',
          ERROR_CODES.importRowLimitExceeded,
          'products.import.errors.rowLimit',
        ),
      ]);
    }

    const imageColumn = templateVersion === 'optimized-v1' ? 18 : 2;
    const draftsByRow = new Map(drafts.map((draft) => [draft.rowNumber, draft]));
    const standardByRow = new Map<number, ParsedProductImage[]>();
    const drawingErrors: ProductImportIssue[] = [];
    for (const image of drawingImages) {
      if (image.columnNumber === imageColumn && draftsByRow.has(image.rowNumber)) {
        const rows = standardByRow.get(image.rowNumber) ?? [];
        rows.push(image);
        standardByRow.set(image.rowNumber, rows);
      } else if (image.columnNumber === imageColumn) {
        drawingErrors.push(
          this.issue(
            image.rowNumber,
            null,
            'image',
            ERROR_CODES.importImageMappingInvalid,
            'products.import.errors.imageMapping',
          ),
        );
      }
    }

    for (const draft of drafts) {
      if (draft.rawImageRef) {
        const image = cellImages.byId.get(draft.rawImageRef.formula);
        if (!image) {
          draft.errors.push(
            this.issue(
              draft.rowNumber,
              draft.sku || null,
              'image',
              ERROR_CODES.importImageMappingInvalid,
              'products.import.errors.imageMapping',
            ),
          );
        } else {
          draft.images.push({
            ...image,
            source: 'wps-cellimage',
            rowNumber: draft.rowNumber,
            columnNumber: draft.rawImageRef.column,
          });
        }
      }
      const standard = standardByRow.get(draft.rowNumber) ?? [];
      if (standard.length > 1 || (draft.rawImageRef && standard.length > 0)) {
        draft.errors.push(
          this.issue(
            draft.rowNumber,
            draft.sku || null,
            'image',
            ERROR_CODES.importImageMappingInvalid,
            'products.import.errors.imageMapping',
          ),
        );
      } else {
        draft.images.push(...standard);
      }
      if (draft.images.length > PRODUCT_IMPORT_LIMITS.maxImagesPerProduct) {
        draft.errors.push(
          this.issue(
            draft.rowNumber,
            draft.sku || null,
            'image',
            ERROR_CODES.importImageInvalid,
            'products.import.errors.imageCount',
          ),
        );
      }
    }

    const errors = [
      ...cellImages.errors,
      ...drawingErrors,
      ...drafts.flatMap((draft) => draft.errors),
    ];
    this.detectDuplicates(drafts, errors);
    const rows = drafts.map((draft) => ({ ...draft.row, images: draft.images }));
    return {
      templateVersion,
      fileSha256,
      rows,
      errors,
      warnings: [],
      imageCount: rows.reduce((count, row) => count + row.images.length, 0),
    };
  }

  private async loadArchive(buffer: Buffer): Promise<JSZip> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    } catch {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importFileTypeInvalid,
          'products.import.errors.fileType',
        ),
      ]);
    }
    const entries = Object.values(zip.files);
    if (entries.length > 512) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importFileTypeInvalid,
          'products.import.errors.fileType',
        ),
      ]);
    }
    let total = 0;
    for (const entry of entries) {
      if (entry.name.includes('..') || entry.name.startsWith('/')) {
        throw new ImportRowError([
          this.issue(
            null,
            null,
            'file',
            ERROR_CODES.importFileTypeInvalid,
            'products.import.errors.fileType',
          ),
        ]);
      }
      const uncompressed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (typeof uncompressed === 'number') total += uncompressed;
    }
    if (total > this.options.maxTotalUncompressedBytes) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importFileTooLarge,
          'products.import.errors.fileTooLarge',
        ),
      ]);
    }
    if (
      entries.some(
        (entry) =>
          /(^|\/)vbaProject\.bin$/i.test(entry.name) ||
          /(^|\/)externalLinks\//i.test(entry.name) ||
          /(^|\/)embeddings\//i.test(entry.name),
      )
    ) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importExternalLink,
          'products.import.errors.externalContent',
        ),
      ]);
    }
    for (const entry of entries.filter((candidate) => candidate.name.endsWith('.rels'))) {
      const xml = await entry.async('string');
      for (const relationship of xml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
        const targetMode = this.relationshipAttribute(relationship, 'TargetMode');
        if (targetMode?.toLowerCase() !== 'external') continue;
        const target = this.relationshipAttribute(relationship, 'Target');
        const relationType = this.relationshipAttribute(relationship, 'Type');
        const id = this.relationshipAttribute(relationship, 'Id');
        // WPS leaves Target="NULL" in cellimages.xml.rels after a linked image
        // is removed. It is safe to ignore only in that exact relationship file
        // and only when it is not referenced by a DISPIMG cellImage block.
        const isSafeWpsNullPlaceholder =
          entry.name === 'xl/_rels/cellimages.xml.rels' &&
          id !== null &&
          target?.toUpperCase() === 'NULL' &&
          relationType?.endsWith('/image') === true;
        if (!isSafeWpsNullPlaceholder) {
          throw new ImportRowError([
            this.issue(
              null,
              null,
              'file',
              ERROR_CODES.importExternalLink,
              'products.import.errors.externalContent',
            ),
          ]);
        }
      }
    }
    return zip;
  }

  private assertWorkbookEnvelope(buffer: Buffer): void {
    if (buffer.byteLength === 0) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importFileRequired,
          'products.import.errors.fileRequired',
        ),
      ]);
    }
    if (buffer.byteLength > this.options.maxBytes) {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importFileTooLarge,
          'products.import.errors.fileTooLarge',
        ),
      ]);
    }
    if (detectKind(buffer) !== 'xlsx') {
      throw new ImportRowError([
        this.issue(
          null,
          null,
          'file',
          ERROR_CODES.importFileTypeInvalid,
          'products.import.errors.fileType',
        ),
      ]);
    }
  }

  private async readWpsCellImages(zip: JSZip): Promise<CellImagesResult> {
    const cellXmlFile = zip.file('xl/cellimages.xml');
    const relsFile = zip.file('xl/_rels/cellimages.xml.rels');
    if (!cellXmlFile) return { byId: new Map(), errors: [] };
    if (!relsFile) {
      return {
        byId: new Map(),
        errors: [
          this.issue(
            null,
            null,
            'image',
            ERROR_CODES.importImageMappingInvalid,
            'products.import.errors.imageMapping',
          ),
        ],
      };
    }
    const relationships = this.readRelationships(await relsFile.async('string'));
    const xml = await cellXmlFile.async('string');
    const result: CellImagesResult = { byId: new Map(), errors: [] };
    const blocks = xml.match(/<etc:cellImage\b[^>]*>[\s\S]*?<\/etc:cellImage>/g) ?? [];
    for (const block of blocks) {
      const id = this.xmlAttribute(block, /<xdr:cNvPr\b[^>]*\bname="([^"]+)"/);
      const relationId = this.xmlAttribute(block, /<a:blip\b[^>]*\br:embed="([^"]+)"/);
      const target = relationId ? relationships.get(relationId) : null;
      if (!id || !target) {
        result.errors.push(
          this.issue(
            null,
            null,
            'image',
            ERROR_CODES.importImageMappingInvalid,
            'products.import.errors.imageMapping',
          ),
        );
        continue;
      }
      const mediaPath = this.resolveRelationshipTarget('xl', target);
      const mediaFile = zip.file(mediaPath);
      if (!mediaFile) {
        result.errors.push(
          this.issue(
            null,
            null,
            'image',
            ERROR_CODES.importImageMappingInvalid,
            'products.import.errors.imageMapping',
          ),
        );
        continue;
      }
      const bytes = Buffer.from(await mediaFile.async('uint8array'));
      const parsed = this.validateImage(bytes, posix.basename(mediaPath));
      if (!parsed) {
        result.errors.push(
          this.issue(
            null,
            null,
            'image',
            ERROR_CODES.importImageInvalid,
            'products.import.errors.imageInvalid',
          ),
        );
        continue;
      }
      if (result.byId.has(id)) {
        result.errors.push(
          this.issue(
            null,
            null,
            'image',
            ERROR_CODES.importImageMappingInvalid,
            'products.import.errors.imageMapping',
          ),
        );
        continue;
      }
      result.byId.set(id, parsed);
    }
    return result;
  }

  private readDrawingImages(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
  ): ParsedProductImage[] {
    const images: ParsedProductImage[] = [];
    for (const placement of worksheet.getImages()) {
      const rowNumber = placement.range.tl.nativeRow + 1;
      const columnNumber = placement.range.tl.nativeCol + 1;
      const bottom = placement.range.br;
      if (bottom && bottom.nativeRow !== placement.range.tl.nativeRow) {
        throw new ImportRowError([
          this.issue(
            rowNumber,
            null,
            'image',
            ERROR_CODES.importImageMappingInvalid,
            'products.import.errors.imageMapping',
          ),
        ]);
      }
      const image = workbook.getImage(Number(placement.imageId));
      if (!image.buffer) {
        throw new ImportRowError([
          this.issue(
            rowNumber,
            null,
            'image',
            ERROR_CODES.importImageInvalid,
            'products.import.errors.imageInvalid',
          ),
        ]);
      }
      const bytes = Buffer.from(image.buffer);
      const parsed = this.validateImage(bytes, `drawing-${placement.imageId}.${image.extension}`);
      if (!parsed) {
        throw new ImportRowError([
          this.issue(
            rowNumber,
            null,
            'image',
            ERROR_CODES.importImageInvalid,
            'products.import.errors.imageInvalid',
          ),
        ]);
      }
      images.push({
        ...parsed,
        source: 'drawing',
        rowNumber,
        columnNumber,
      });
    }
    return images;
  }

  private validateImage(
    bytes: Buffer,
    mediaName: string,
  ): Omit<ParsedProductImage, 'rowNumber' | 'columnNumber' | 'source'> | null {
    if (bytes.byteLength === 0 || bytes.byteLength > this.options.maxImageBytes) return null;
    const kind = detectKind(bytes);
    if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') return null;
    const dimensions = readImageDimensions(bytes, kind);
    if (!dimensions || dimensions.width * dimensions.height > this.options.maxPixels) return null;
    return {
      mediaName,
      mimeType: IMAGE_MIME_BY_KIND[kind] as ParsedProductImage['mimeType'],
      width: dimensions.width,
      height: dimensions.height,
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
    };
  }

  private readRelationships(xml: string): Map<string, string> {
    const relationships = new Map<string, string>();
    for (const tag of xml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
      if (this.relationshipAttribute(tag, 'TargetMode')?.toLowerCase() === 'external') continue;
      const id = this.relationshipAttribute(tag, 'Id');
      const target = this.relationshipAttribute(tag, 'Target');
      if (id && target) relationships.set(id, target);
    }
    return relationships;
  }

  private relationshipAttribute(xml: string, name: string): string | null {
    const match = xml.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    const value = match?.[1] ?? match?.[2];
    return value === undefined ? null : this.xmlUnescape(value);
  }

  private readOptimizedRows(worksheet: ExcelJS.Worksheet): RowDraft[] {
    this.assertHeaders(worksheet, OPTIMIZED_HEADERS, 'optimized-v1');
    const rows: RowDraft[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      if (OPTIMIZED_HEADERS.every((_, index) => this.rawCell(row.getCell(index + 1)) === null)) {
        continue;
      }
      const errors: ProductImportIssue[] = [];
      const sku = this.requiredText(row.getCell(1), rowNumber, 'sku', errors);
      const nameEn = this.requiredText(row.getCell(3), rowNumber, 'nameEn', errors, 240);
      const slug = this.optionalText(row.getCell(2), rowNumber, 'slug', errors, 180);
      const descriptionEn = this.optionalText(
        row.getCell(4),
        rowNumber,
        'descriptionEn',
        errors,
        8000,
      );
      const nameZh = this.optionalText(row.getCell(5), rowNumber, 'nameZh', errors, 240);
      const descriptionZh = this.optionalText(
        row.getCell(6),
        rowNumber,
        'descriptionZh',
        errors,
        8000,
      );
      const priceCell = row.getCell(17);
      const priceResult = this.readPriceCell(priceCell, rowNumber, errors);
      const imageResult = this.readImageReference(row.getCell(18), rowNumber, errors);
      rows.push({
        rowNumber,
        sku,
        rawImageRef: imageResult ? { formula: imageResult, column: 18 } : null,
        images: [],
        errors,
        row: {
          rowNumber,
          sku,
          slug: slug || null,
          nameEn,
          descriptionEn,
          nameZh,
          descriptionZh,
          lengthMm: this.optionalDimensionMm(row.getCell(7), rowNumber, 'lengthMm', errors),
          widthMm: this.optionalDimensionMm(row.getCell(8), rowNumber, 'widthMm', errors),
          heightMm: this.optionalDimensionMm(row.getCell(9), rowNumber, 'heightMm', errors),
          weightGrams: this.optionalInteger(row.getCell(10), rowNumber, 'weightGrams', errors),
          packaging: this.optionalText(row.getCell(11), rowNumber, 'packaging', errors, 500),
          cartonLengthCm: this.optionalInteger(
            row.getCell(12),
            rowNumber,
            'cartonLengthCm',
            errors,
          ),
          cartonWidthCm: this.optionalInteger(row.getCell(13), rowNumber, 'cartonWidthCm', errors),
          cartonHeightCm: this.optionalInteger(
            row.getCell(14),
            rowNumber,
            'cartonHeightCm',
            errors,
          ),
          cartonWeightKg: this.optionalDecimal(
            row.getCell(15),
            rowNumber,
            'cartonWeightKg',
            errors,
          ),
          cartonQuantity: this.optionalInteger(
            row.getCell(16),
            rowNumber,
            'cartonQuantity',
            errors,
          ),
          priceCny: priceResult,
          sortOrder: this.optionalInteger(row.getCell(19), rowNumber, 'sortOrder', errors) ?? 0,
        },
      });
    }
    return rows;
  }

  private readLegacyRows(worksheet: ExcelJS.Worksheet): RowDraft[] {
    this.assertHeaders(worksheet, LEGACY_HEADERS, 'wps-price-list-v1');
    const rows: RowDraft[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      if (LEGACY_HEADERS.every((_, index) => this.rawCell(row.getCell(index + 1)) === null)) {
        continue;
      }
      const errors: ProductImportIssue[] = [];
      const sku = this.requiredText(row.getCell(1), rowNumber, 'sku', errors);
      const nameEn = this.requiredText(row.getCell(3), rowNumber, 'nameEn', errors, 240);
      const priceResult =
        this.readPriceCell(row.getCell(5), rowNumber, errors) ??
        this.readPriceCell(row.getCell(4), rowNumber, errors);
      const imageResult = this.readImageReference(row.getCell(2), rowNumber, errors);
      const cartonDimensions = this.readLegacyDimensions(row.getCell(7), rowNumber, errors);
      rows.push({
        rowNumber,
        sku,
        rawImageRef: imageResult ? { formula: imageResult, column: 2 } : null,
        images: [],
        errors,
        row: {
          rowNumber,
          sku,
          slug: null,
          nameEn,
          descriptionEn: null,
          nameZh: null,
          descriptionZh: null,
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          weightGrams: null,
          packaging: null,
          cartonLengthCm: cartonDimensions[0],
          cartonWidthCm: cartonDimensions[1],
          cartonHeightCm: cartonDimensions[2],
          cartonWeightKg: this.optionalDecimal(row.getCell(8), rowNumber, 'cartonWeightKg', errors),
          cartonQuantity: this.optionalInteger(row.getCell(6), rowNumber, 'cartonQuantity', errors),
          priceCny: priceResult,
          sortOrder: 0,
        },
      });
    }
    return rows;
  }

  private assertHeaders(
    worksheet: ExcelJS.Worksheet,
    expected: readonly string[],
    templateVersion: ProductImportTemplateVersion,
  ): void {
    if (worksheet.columnCount > expected.length) {
      const extra = Array.from({ length: worksheet.columnCount - expected.length }, (_, index) =>
        this.rawCell(worksheet.getRow(1).getCell(expected.length + index + 1)),
      ).filter((value) => value !== null && String(value).trim().length > 0);
      if (extra.length > 0) {
        throw new ImportRowError([
          this.issue(
            1,
            null,
            'header',
            ERROR_CODES.importHeaderInvalid,
            `products.import.errors.headerInvalid.${templateVersion}`,
          ),
        ]);
      }
    }
    const actual = expected.map((_, index) =>
      String(this.rawCell(worksheet.getRow(1).getCell(index + 1)) ?? '').trim(),
    );
    if (actual.some((header) => header.length === 0)) {
      throw new ImportRowError([
        this.issue(
          1,
          null,
          'header',
          ERROR_CODES.importHeaderInvalid,
          `products.import.errors.headerInvalid.${templateVersion}`,
        ),
      ]);
    }
    const normalized = actual.map((header) => header.toLocaleLowerCase());
    if (
      actual.length !== expected.length ||
      normalized.some((header, index) => header !== expected[index]?.toLocaleLowerCase())
    ) {
      throw new ImportRowError([
        this.issue(
          1,
          null,
          'header',
          ERROR_CODES.importHeaderInvalid,
          `products.import.errors.headerInvalid.${templateVersion}`,
        ),
      ]);
    }
    const duplicates = normalized.filter((header, index) => normalized.indexOf(header) !== index);
    if (duplicates.length > 0 && templateVersion !== 'wps-price-list-v1') {
      throw new ImportRowError([
        this.issue(
          1,
          null,
          'header',
          ERROR_CODES.importDuplicateHeader,
          'products.import.errors.duplicateHeader',
        ),
      ]);
    }
  }

  private async assertNoMergedCells(zip: JSZip): Promise<void> {
    const sheetFiles = Object.values(zip.files).filter((entry) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name),
    );
    for (const file of sheetFiles) {
      const xml = await file.async('string');
      if (/<mergeCell\b/i.test(xml)) {
        throw new ImportRowError([
          this.issue(
            null,
            null,
            'file',
            ERROR_CODES.importFieldInvalid,
            'products.import.errors.mergedCells',
          ),
        ]);
      }
    }
  }

  private requiredText(
    cell: ExcelJS.Cell,
    rowNumber: number,
    field: string,
    errors: ProductImportIssue[],
    max = 64,
  ): string {
    const value = this.optionalText(cell, rowNumber, field, errors, max) ?? '';
    if (value.length === 0) {
      errors.push(
        this.issue(
          rowNumber,
          field === 'sku' ? null : null,
          field,
          ERROR_CODES.importRequiredFieldMissing,
          'products.import.errors.required',
        ),
      );
    }
    return value;
  }

  private optionalText(
    cell: ExcelJS.Cell,
    rowNumber: number,
    field: string,
    errors: ProductImportIssue[],
    max: number,
  ): string | null {
    const raw = this.rawCell(cell);
    if (raw === null) return null;
    if (cell.type === ExcelJS.ValueType.Formula) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFormulaNotAllowed,
          'products.import.errors.formula',
        ),
      );
      return null;
    }
    const value = String(raw).trim();
    if (value.length === 0) return null;
    if (value.length > max || hasUnsupportedControlCharacters(value)) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFieldInvalid,
          'products.import.errors.field',
        ),
      );
      return null;
    }
    return value;
  }

  private optionalInteger(
    cell: ExcelJS.Cell,
    rowNumber: number,
    field: string,
    errors: ProductImportIssue[],
  ): number | null {
    const raw = this.rawCell(cell);
    if (raw === null) return null;
    if (cell.type === ExcelJS.ValueType.Formula) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFormulaNotAllowed,
          'products.import.errors.formula',
        ),
      );
      return null;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFieldInvalid,
          'products.import.errors.field',
        ),
      );
      return null;
    }
    return value;
  }

  private optionalDecimal(
    cell: ExcelJS.Cell,
    rowNumber: number,
    field: string,
    errors: ProductImportIssue[],
  ): string | null {
    const raw = this.rawCell(cell);
    if (raw === null) return null;
    if (cell.type === ExcelJS.ValueType.Formula) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFormulaNotAllowed,
          'products.import.errors.formula',
        ),
      );
      return null;
    }
    try {
      const value = new Decimal(String(raw));
      if (!value.isFinite() || value.isNegative()) throw new Error('invalid');
      return value.toFixed(3);
    } catch {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFieldInvalid,
          'products.import.errors.field',
        ),
      );
      return null;
    }
  }

  private optionalDimensionMm(
    cell: ExcelJS.Cell,
    rowNumber: number,
    field: string,
    errors: ProductImportIssue[],
  ): number | null {
    const raw = this.rawCell(cell);
    if (raw === null) return null;
    if (cell.type === ExcelJS.ValueType.Formula) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFormulaNotAllowed,
          'products.import.errors.formula',
        ),
      );
      return null;
    }
    let millimetres: Decimal;
    try {
      millimetres = new Decimal(String(raw)).times(10);
    } catch {
      millimetres = new Decimal(-1);
    }
    if (!millimetres.isInteger() || millimetres.isNegative()) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          field,
          ERROR_CODES.importFieldInvalid,
          'products.import.errors.field',
        ),
      );
      return null;
    }
    return millimetres.toNumber();
  }

  private readPriceCell(
    cell: ExcelJS.Cell,
    rowNumber: number,
    errors: ProductImportIssue[],
  ): string | null {
    const raw = this.rawCell(cell);
    if (raw === null) return null;
    try {
      if (cell.type === ExcelJS.ValueType.Formula) {
        const formula = this.formulaOf(cell);
        if (!formula) throw new Error(ERROR_CODES.importFormulaNotAllowed);
        return parseSafePriceFormula(formula);
      }
      const value = new Decimal(String(raw));
      if (!value.isFinite() || value.isNegative()) throw new Error('invalid');
      return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    } catch {
      errors.push(
        this.issue(
          rowNumber,
          null,
          'priceCny',
          cell.type === ExcelJS.ValueType.Formula
            ? ERROR_CODES.importFormulaNotAllowed
            : ERROR_CODES.importFieldInvalid,
          cell.type === ExcelJS.ValueType.Formula
            ? 'products.import.errors.priceFormula'
            : 'products.import.errors.price',
        ),
      );
      return null;
    }
  }

  private readImageReference(
    cell: ExcelJS.Cell,
    rowNumber: number,
    errors: ProductImportIssue[],
  ): string | null {
    const raw = this.rawCell(cell);
    if (raw === null || String(raw).trim().length === 0) return null;
    if (cell.type !== ExcelJS.ValueType.Formula) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          'image',
          ERROR_CODES.importImageMappingInvalid,
          'products.import.errors.imageReference',
        ),
      );
      return null;
    }
    const formula = this.formulaOf(cell);
    const match = formula?.match(/^(?:_xlfn\.)?DISPIMG\(\s*"([^"]+)"\s*,\s*1\s*\)$/i);
    if (!match?.[1]) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          'image',
          ERROR_CODES.importImageMappingInvalid,
          'products.import.errors.imageReference',
        ),
      );
      return null;
    }
    return match[1];
  }

  private readLegacyDimensions(
    cell: ExcelJS.Cell,
    rowNumber: number,
    errors: ProductImportIssue[],
  ): [number | null, number | null, number | null] {
    const raw = this.rawCell(cell);
    if (raw === null) return [null, null, null];
    const parts = String(raw)
      .trim()
      .toLowerCase()
      .replace(/cm/g, '')
      .split(/\s*[*x×]\s*/);
    if (parts.length !== 3) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          'cartonDimensions',
          ERROR_CODES.importFieldInvalid,
          'products.import.errors.dimensions',
        ),
      );
      return [null, null, null];
    }
    const values = parts.map((part) => {
      try {
        const value = new Decimal(part);
        if (!value.isInteger() || value.isNegative()) return null;
        return value.toNumber();
      } catch {
        return null;
      }
    });
    if (values.some((value) => value === null)) {
      errors.push(
        this.issue(
          rowNumber,
          null,
          'cartonDimensions',
          ERROR_CODES.importFieldInvalid,
          'products.import.errors.dimensions',
        ),
      );
    }
    return [values[0] ?? null, values[1] ?? null, values[2] ?? null];
  }

  private formulaOf(cell: ExcelJS.Cell): string | null {
    const value = cell.value as unknown;
    if (typeof value === 'object' && value !== null && 'formula' in value) {
      const formula = (value as { formula?: unknown }).formula;
      return typeof formula === 'string' ? formula : null;
    }
    return null;
  }

  private rawCell(cell: ExcelJS.Cell): string | number | boolean | null {
    if (cell.type === ExcelJS.ValueType.Formula) {
      const result = (cell.value as { result?: unknown } | null)?.result;
      return result === undefined || result === null ? '' : String(result);
    }
    const value = cell.value;
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && 'text' in value) {
      return String((value as { text?: unknown }).text ?? '');
    }
    return null;
  }

  private detectDuplicates(drafts: RowDraft[], errors: ProductImportIssue[]): void {
    const skuCounts = new Map<string, number>();
    const slugCounts = new Map<string, number>();
    for (const draft of drafts) {
      if (draft.sku) skuCounts.set(draft.sku, (skuCounts.get(draft.sku) ?? 0) + 1);
      if (draft.row.slug) slugCounts.set(draft.row.slug, (slugCounts.get(draft.row.slug) ?? 0) + 1);
    }
    for (const draft of drafts) {
      if (draft.sku && (skuCounts.get(draft.sku) ?? 0) > 1) {
        errors.push(
          this.issue(
            draft.rowNumber,
            draft.sku,
            'sku',
            ERROR_CODES.importDuplicateSkuInFile,
            'products.import.errors.duplicateSku',
          ),
        );
      }
      if (draft.row.slug && (slugCounts.get(draft.row.slug) ?? 0) > 1) {
        errors.push(
          this.issue(
            draft.rowNumber,
            draft.sku || null,
            'slug',
            ERROR_CODES.importSlugDuplicate,
            'products.import.errors.duplicateSlug',
          ),
        );
      }
    }
  }

  private issue(
    rowNumber: number | null,
    sku: string | null,
    field: string,
    code: string,
    messageKey: string,
  ): ProductImportIssue {
    return { rowNumber, sku, field, code, messageKey, severity: 'error' };
  }

  private xmlAttribute(xml: string, pattern: RegExp): string | null {
    const match = xml.match(pattern);
    return match?.[1] ? this.xmlUnescape(match[1]) : null;
  }

  private resolveRelationshipTarget(base: string, target: string): string {
    if (target.startsWith('/')) {
      return posix.normalize(target.slice(1));
    }
    return posix.normalize(posix.join(base, target));
  }

  private xmlUnescape(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
}

function hasUnsupportedControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}
