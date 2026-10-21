import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appModule = readFileSync(resolve(__dirname, '../app.module.ts'), 'utf8');
const jobsController = readFileSync(resolve(__dirname, './jobs/jobs.controller.ts'), 'utf8');
const quoteController = readFileSync(resolve(__dirname, './quote/quote.controller.ts'), 'utf8');
const queueContracts = readFileSync(
  resolve(__dirname, '../../../../packages/contracts/src/jobs.ts'),
  'utf8',
);
const validationSchemas = readFileSync(
  resolve(__dirname, '../../../../packages/validation/src/admin-schemas.ts'),
  'utf8',
);

describe('Excel-to-PDF removal wiring', () => {
  it('does not ship a PDF API module, route or input schema', () => {
    const pdfDirectory = resolve(__dirname, './pdf');
    expect(existsSync(pdfDirectory) ? readdirSync(pdfDirectory) : []).toEqual([]);
    expect(appModule).not.toContain('PdfModule');
    expect(appModule).not.toContain('admin/pdf-conversions');
    expect(jobsController).not.toContain('pdf-conversion');
    expect(jobsController).not.toContain('pdfConversionJob');
    expect(validationSchemas).not.toContain('pdfConversionCreateSchema');
  });

  it('does not publish a PDF conversion queue name or payload contract', () => {
    expect(queueContracts).not.toContain('pdfConvert');
    expect(queueContracts).not.toContain('pdf-convert');
    expect(queueContracts).not.toContain('PdfConvertJobPayload');
  });

  it('keeps the quote Excel API wired', () => {
    expect(quoteController).toContain("@Controller('admin')");
    expect(quoteController).toContain("@Post('quote-exports')");
  });
});
