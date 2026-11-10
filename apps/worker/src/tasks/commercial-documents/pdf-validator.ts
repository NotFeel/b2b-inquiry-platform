import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolveExecutablePath } from '../resolve-executable';

export interface CommercialPdfValidation {
  sizeBytes: number;
  pageCount: number;
}

/**
 * PDFs produced for CI/PI must be real, complete PDF files within the render
 * limits. Unlike the Excel converter we accept both A4 and Letter, because the
 * document template chooses the paper size.
 */
export async function validateCommercialPdf(input: {
  path: string;
  pdfInfoPath: string;
  maxBytes: number;
  maxPages: number;
  timeoutMs?: number;
}): Promise<CommercialPdfValidation> {
  const stat = await fs.stat(input.path).catch(() => null);
  if (!stat || !stat.isFile() || stat.size === 0) {
    throw new Error('COMMERCIAL_DOCUMENT_OUTPUT_INVALID');
  }
  if (stat.size > input.maxBytes) {
    throw new Error('COMMERCIAL_DOCUMENT_OUTPUT_TOO_LARGE');
  }
  const handle = await fs.open(input.path, 'r');
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, header.byteLength, 0);
    if (header.toString('ascii') !== '%PDF-') {
      throw new Error('COMMERCIAL_DOCUMENT_OUTPUT_INVALID');
    }
    const tailLength = Math.min(4096, stat.size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tail.byteLength, stat.size - tailLength);
    if (!tail.includes(Buffer.from('%%EOF'))) {
      throw new Error('COMMERCIAL_DOCUMENT_OUTPUT_INVALID');
    }
  } finally {
    await handle.close();
  }

  const pdfInfoPath = await resolveExecutablePath(input.pdfInfoPath);
  if (!pdfInfoPath) throw new Error('COMMERCIAL_DOCUMENT_PDFINFO_UNAVAILABLE');
  const pageCount = await readPageCount(pdfInfoPath, input.path, input.timeoutMs ?? 30_000);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('COMMERCIAL_DOCUMENT_OUTPUT_INVALID');
  }
  if (pageCount > input.maxPages) {
    throw new Error('COMMERCIAL_DOCUMENT_OUTPUT_TOO_MANY_PAGES');
  }
  return { sizeBytes: stat.size, pageCount };
}

function readPageCount(executable: string, path: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [path], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, pageCount?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(pageCount ?? 0);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('COMMERCIAL_DOCUMENT_CONVERSION_TIMEOUT'));
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes <= 256 * 1024) chunks.push(chunk);
      else child.kill('SIGKILL');
    });
    child.stderr?.resume();
    child.once('error', () => finish(new Error('COMMERCIAL_DOCUMENT_PDFINFO_UNAVAILABLE')));
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error('COMMERCIAL_DOCUMENT_OUTPUT_INVALID'));
        return;
      }
      const output = Buffer.concat(chunks).toString('utf8');
      const pages = /^Pages:\s+(\d+)\s*$/m.exec(output);
      finish(undefined, pages ? Number.parseInt(pages[1] ?? '0', 10) : 0);
    });
  });
}
