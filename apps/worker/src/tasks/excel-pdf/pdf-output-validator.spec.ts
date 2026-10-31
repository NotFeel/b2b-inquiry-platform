import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_CODES } from '@b2b/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { validatePdfOutput } from './pdf-output-validator';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe('generated PDF validation', () => {
  it('accepts a signed non-empty PDF and parses its page count', async () => {
    const { pdfPath, pdfInfoPath } = await fixture('%PDF-1.7\nfixture\n%%EOF\n', 2);
    await expect(
      validatePdfOutput({
        path: pdfPath,
        pdfInfoPath,
        maxBytes: 1024,
        maxPages: 5,
        // Process startup can be slower on loaded CI runners; this assertion
        // tests page parsing rather than timeout behavior.
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({ pageCount: 2 });
  });

  it('rejects a file without a PDF signature before running pdfinfo', async () => {
    const { pdfPath, pdfInfoPath } = await fixture('not a pdf', 1);
    await expect(
      validatePdfOutput({ path: pdfPath, pdfInfoPath, maxBytes: 1024, maxPages: 5 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.excelPdfOutputInvalid });
  });

  it('rejects output larger than the configured limit', async () => {
    const { pdfPath, pdfInfoPath } = await fixture('%PDF-1.7\n1234567890\n%%EOF\n', 1);
    await expect(
      validatePdfOutput({ path: pdfPath, pdfInfoPath, maxBytes: 5, maxPages: 5 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.excelPdfOutputInvalid });
  });

  it('rejects a PDF whose page count exceeds the configured limit', async () => {
    const { pdfPath, pdfInfoPath } = await fixture('%PDF-1.7\nfixture\n%%EOF\n', 6);
    await expect(
      validatePdfOutput({ path: pdfPath, pdfInfoPath, maxBytes: 1024, maxPages: 5 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.excelPdfOutputInvalid });
  });
});

async function fixture(pdf: string, pages: number) {
  const root = await fs.mkdtemp(join(tmpdir(), 'b2b-pdf-validator-'));
  temporaryDirectories.push(root);
  const pdfPath = join(root, 'output.pdf');
  const pdfInfoPath = join(root, 'fake-pdfinfo');
  await fs.writeFile(pdfPath, pdf, { mode: 0o600 });
  await fs.writeFile(pdfInfoPath, `#!/bin/sh\nprintf 'Pages: ${pages}\\n'\n`, { mode: 0o700 });
  return { pdfPath, pdfInfoPath };
}
