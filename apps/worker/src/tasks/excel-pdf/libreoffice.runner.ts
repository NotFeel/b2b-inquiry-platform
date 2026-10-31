import { constants as fsConstants, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ERROR_CODES } from '@b2b/contracts';
import { ExcelPdfProcessingError } from './excel-pdf-errors';

export interface LibreOfficeConversionInput {
  executable: string;
  inputPath: string;
  outputDir: string;
  profileDir: string;
  timeoutMs: number;
}

export interface LibreOfficeConversionResult {
  outputPath: string;
  durationMs: number;
}

export async function convertWorkbookWithLibreOffice(
  input: LibreOfficeConversionInput,
): Promise<LibreOfficeConversionResult> {
  try {
    await fs.access(input.executable, fsConstants.X_OK);
  } catch {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfConverterUnavailable,
      'The configured PDF converter is unavailable.',
      false,
    );
  }

  const startedAt = Date.now();
  const expectedOutput = join(input.outputDir, `${basename(input.inputPath, '.xlsx')}.pdf`);
  const binaryDir = dirname(input.executable);
  const args = [
    `-env:UserInstallation=${pathToFileURL(input.profileDir).href}`,
    '--headless',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    '--convert-to',
    'pdf:calc_pdf_Export',
    '--outdir',
    input.outputDir,
    input.inputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.executable, args, {
      cwd: input.outputDir,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        HOME: input.profileDir,
        TMPDIR: input.outputDir,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        PATH: `${binaryDir}:/usr/local/bin:/usr/bin:/bin`,
        SAL_USE_VCLPLUGIN: 'svp',
      },
    });

    let stderrBytes = 0;
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 16 * 1024) child.stderr?.destroy();
    });

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const killTree = () => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timeout = setTimeout(() => {
      killTree();
      finish(
        new ExcelPdfProcessingError(
          ERROR_CODES.excelPdfConversionTimeout,
          'The workbook conversion exceeded its time limit.',
          true,
        ),
      );
    }, input.timeoutMs);
    timeout.unref?.();

    child.once('error', (error: NodeJS.ErrnoException) => {
      finish(
        new ExcelPdfProcessingError(
          error.code === 'ENOENT'
            ? ERROR_CODES.excelPdfConverterUnavailable
            : ERROR_CODES.excelPdfOutputInvalid,
          'The PDF converter could not be started.',
          error.code !== 'ENOENT',
        ),
      );
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        finish(
          new ExcelPdfProcessingError(
            ERROR_CODES.excelPdfOutputInvalid,
            `The PDF converter exited unsuccessfully (${signal ?? code ?? 'unknown'}).`,
            true,
          ),
        );
        return;
      }
      finish();
    });
  });

  try {
    const stat = await fs.stat(expectedOutput);
    if (!stat.isFile()) throw new Error('not_a_file');
  } catch {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfOutputInvalid,
      'The converter did not produce a PDF file.',
    );
  }
  return { outputPath: expectedOutput, durationMs: Date.now() - startedAt };
}
