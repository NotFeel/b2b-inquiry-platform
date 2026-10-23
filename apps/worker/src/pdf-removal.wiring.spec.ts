import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
const envSource = readFileSync(fileURLToPath(new URL('./env.ts', import.meta.url)), 'utf8');
const runnerSource = readFileSync(
  fileURLToPath(new URL('./task-runner/runner.ts', import.meta.url)),
  'utf8',
);
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { dependencies?: Record<string, string> };

describe('worker after Excel-to-PDF removal', () => {
  it('does not register a PDF converter or PDF-only configuration', () => {
    expect(indexSource).not.toContain('processPdfConversion');
    expect(indexSource).not.toContain('pdfConvert');
    expect(envSource).not.toContain('PDF_CONVERTER_PATH');
    expect(envSource).not.toContain('PDF_MAX_OUTPUT_PAGES');
  });

  it('keeps the shared Excel quote and PI worker and its dependency', () => {
    expect(indexSource).toContain('PostgresTaskRunner');
    expect(runnerSource).toContain('processQuoteExport');
    expect(runnerSource).toContain('processImageDerivatives');
    expect(packageJson.dependencies?.exceljs).toBe('4.4.0');
    expect(packageJson.dependencies?.bullmq).toBeUndefined();
    expect(packageJson.dependencies?.ioredis).toBeUndefined();
  });
});
