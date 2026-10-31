import { constants as fsConstants, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { ERROR_CODES } from '@b2b/contracts';
import { ExcelPdfProcessingError } from './excel-pdf-errors';

export interface PdfValidationResult {
  sizeBytes: number;
  pageCount: number;
  sha256?: string;
}

export async function validatePdfOutput(input: {
  path: string;
  pdfInfoPath: string;
  maxBytes: number;
  maxPages: number;
  timeoutMs?: number;
}): Promise<PdfValidationResult> {
  let stat;
  try {
    stat = await fs.stat(input.path);
  } catch {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfOutputInvalid,
      'The generated PDF does not exist.',
    );
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfOutputInvalid,
      'The generated PDF is empty.',
    );
  }
  if (stat.size > input.maxBytes) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfOutputInvalid,
      'The generated PDF exceeds the configured output limit.',
    );
  }

  const handle = await fs.open(input.path, 'r');
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, header.byteLength, 0);
    if (header.toString('ascii') !== '%PDF-') {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfOutputInvalid,
        'The generated file does not have a PDF signature.',
      );
    }
    const tailLength = Math.min(4096, stat.size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tail.byteLength, stat.size - tailLength);
    if (!tail.includes(Buffer.from('%%EOF'))) {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfOutputInvalid,
        'The generated PDF is incomplete.',
      );
    }
  } finally {
    await handle.close();
  }

  try {
    await fs.access(input.pdfInfoPath, fsConstants.X_OK);
  } catch {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfConverterUnavailable,
      'The PDF inspection utility is unavailable.',
      true,
    );
  }

  const pageCount = await readPdfPageCount(
    input.pdfInfoPath,
    input.path,
    input.timeoutMs ?? 30_000,
  );
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfOutputInvalid,
      'The generated PDF contains no readable pages.',
    );
  }
  if (pageCount > input.maxPages) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfOutputInvalid,
      'The generated PDF exceeds the configured page limit.',
    );
  }
  return { sizeBytes: stat.size, pageCount };
}

function readPdfPageCount(executable: string, path: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [path], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? 0);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        new ExcelPdfProcessingError(
          ERROR_CODES.excelPdfConversionTimeout,
          'PDF inspection exceeded its time limit.',
          true,
        ),
      );
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes <= 256 * 1024) chunks.push(chunk);
      else child.kill('SIGKILL');
    });
    child.stderr?.resume();
    child.once('error', () => {
      finish(
        new ExcelPdfProcessingError(
          ERROR_CODES.excelPdfConverterUnavailable,
          'The PDF inspection utility could not be started.',
          true,
        ),
      );
    });
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(
          new ExcelPdfProcessingError(
            ERROR_CODES.excelPdfOutputInvalid,
            'The generated PDF could not be inspected.',
          ),
        );
        return;
      }
      const output = Buffer.concat(chunks).toString('utf8');
      const match = /^Pages:\s+(\d+)\s*$/m.exec(output);
      finish(undefined, match ? Number.parseInt(match[1] ?? '0', 10) : 0);
    });
  });
}
