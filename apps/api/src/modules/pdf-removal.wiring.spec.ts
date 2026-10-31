import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appModule = readFileSync(resolve(__dirname, '../app.module.ts'), 'utf8');
const excelPdfModule = readFileSync(resolve(__dirname, './excel-pdf/excel-pdf.module.ts'), 'utf8');
const excelPdfController = readFileSync(
  resolve(__dirname, './excel-pdf/excel-pdf.controller.ts'),
  'utf8',
);
const quoteController = readFileSync(resolve(__dirname, './quote/quote.controller.ts'), 'utf8');
const excelPdfContracts = readFileSync(
  resolve(__dirname, '../../../../packages/contracts/src/excel-pdf.ts'),
  'utf8',
);
const validationSchemas = readFileSync(
  resolve(__dirname, '../../../../packages/validation/src/excel-pdf.ts'),
  'utf8',
);

describe('Excel-to-PDF wiring after docs/38 reintroduction', () => {
  it('registers the independent Excel-to-PDF module and controller', () => {
    expect(appModule).toContain('ExcelPdfModule');
    expect(excelPdfModule).toContain('ExcelPdfController');
    expect(excelPdfController).toContain("@Controller('admin/excel-pdf')");
    expect(excelPdfController).toContain("@Post('uploads')");
    expect(excelPdfController).toContain("@Put('uploads/:uploadId/chunks/:index')");
    expect(excelPdfController).toContain("@Get('jobs/:id/download')");
  });

  it('publishes bounded chunked upload and conversion contracts', () => {
    expect(excelPdfContracts).toContain('maxUploadBytes: 200 * MIB');
    expect(excelPdfContracts).toContain('chunkBytes: 8 * MIB');
    expect(excelPdfContracts).toContain('ExcelPdfConvertJobPayload');
    expect(excelPdfContracts).toContain('ExcelPdfUploadInitInput');
    expect(validationSchemas).toContain('excelPdfUploadInitSchema');
  });

  it('keeps the quote Excel API wired', () => {
    expect(quoteController).toContain("@Controller('admin')");
    expect(quoteController).toContain("@Post('quote-exports')");
  });
});
