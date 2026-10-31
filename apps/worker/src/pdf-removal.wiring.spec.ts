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

describe('worker Excel-to-PDF wiring after docs/38 reintroduction', () => {
  it('registers the isolated converter and outbox dispatch', () => {
    expect(indexSource).toContain('PostgresTaskRunner');
    expect(envSource).toContain('EXCEL_PDF_CONVERTER_PATH');
    expect(envSource).toContain('EXCEL_PDF_TIMEOUT_MS');
    expect(runnerSource).toContain("task.eventType === 'excel-pdf-convert'");
    expect(runnerSource).toContain('processExcelPdfConversion');
    expect(runnerSource).toContain("task.eventType === 'excel-pdf-cleanup'");
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
