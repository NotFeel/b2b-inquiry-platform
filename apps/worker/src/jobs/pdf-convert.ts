import { PrismaClient } from '@b2b/database';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';

interface Payload {
  jobId: string;
  sourceStorageKey: string;
  sheetName?: string | null;
}

/**
 * Converts a validated .xlsx workbook to PDF with LibreOffice headless.
 *
 * The process runs in a temporary directory with a hard timeout, the source file
 * name is replaced by a generated one, and macros are never executed
 * (docs/08 §4, docs/13 §4).
 */
export async function processPdfConversion(
  payload: Payload,
  deps: { prisma: PrismaClient; storage: ObjectStorage; env: WorkerEnv; logger: WorkerLogger },
): Promise<{ outputKey: string; sizeBytes: number }> {
  const { prisma, storage, env, logger } = deps;

  await prisma.pdfConversionJob.update({
    where: { id: payload.jobId },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });

  const workDir = await mkdtemp(join(tmpdir(), 'b2b-pdf-'));
  const inputPath = join(workDir, `${payload.jobId}.xlsx`);

  try {
    const source = await storage.get(payload.sourceStorageKey);
    await writeFile(inputPath, source);
    const outputDir = join(workDir, 'out');
    await mkdir(outputDir, { recursive: true });

    await runConverter(env, outputDir, inputPath, logger);

    const produced = (await readdir(outputDir)).filter((name) => name.toLowerCase().endsWith('.pdf'));
    if (produced.length === 0) throw new Error('PDF_CONVERSION_FAILED');

    const pdfPath = join(outputDir, produced[0] as string);
    const pdf = await readFile(pdfPath);
    if (pdf.byteLength === 0 || pdf.subarray(0, 4).toString() !== '%PDF') {
      throw new Error('PDF_CONVERSION_FAILED');
    }
    const pageCount = countPdfPages(pdf);
    if (pageCount !== null && pageCount > env.PDF_MAX_OUTPUT_PAGES) {
      throw new Error('PDF_CONVERSION_FAILED');
    }

    const outputKey = `pdf-conversions/${new Date().toISOString().slice(0, 7)}/${payload.jobId}.pdf`;
    await storage.put(outputKey, pdf, 'application/pdf');
    await prisma.pdfConversionJob.update({
      where: { id: payload.jobId },
      data: {
        status: 'SUCCEEDED',
        outputKey,
        outputSizeBytes: BigInt(pdf.byteLength),
        pageCount,
        errorCode: null,
      },
    });
    logger.info('pdf.converted', { jobId: payload.jobId, outputKey, pageCount });
    return { outputKey, sizeBytes: pdf.byteLength };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PDF_CONVERSION_FAILED';
    const stable = ['PDF_CONVERTER_UNAVAILABLE', 'PDF_CONVERSION_TIMEOUT'].includes(code)
      ? code
      : 'PDF_CONVERSION_FAILED';
    await prisma.pdfConversionJob.update({
      where: { id: payload.jobId },
      data: { status: 'FAILED', errorCode: stable },
    });
    logger.error('pdf.failed', { jobId: payload.jobId, code: stable });
    throw new Error(stable);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runConverter(
  env: WorkerEnv,
  outputDir: string,
  inputPath: string,
  logger: WorkerLogger,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Fixed argument list: the file name is generated, never user supplied.
    const child = spawn(
      env.PDF_CONVERTER_PATH,
      ['--headless', '--norestore', '--invisible', '--nolockcheck', '--convert-to', 'pdf', '--outdir', outputDir, inputPath],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: outputDir } },
    );

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 2000);
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('PDF_CONVERSION_TIMEOUT'));
    }, env.PDF_CONVERTER_TIMEOUT_SECONDS * 1000);

    child.on('error', (error: Error) => {
      clearTimeout(timeout);
      logger.error('pdf.converter_spawn_failed', { message: error.message, binary: env.PDF_CONVERTER_PATH });
      reject(new Error('PDF_CONVERTER_UNAVAILABLE'));
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      logger.error('pdf.converter_failed', { code, stderr: stderr.slice(0, 500), file: basename(inputPath) });
      reject(new Error('PDF_CONVERSION_FAILED'));
    });
  });
}

// Cheap page counter; it only reads the /Type /Page markers.
function countPdfPages(buffer: Buffer): number | null {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : null;
}
