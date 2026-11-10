import { promises as fs } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ERROR_CODES } from '@b2b/contracts';
import { resolveExecutablePath } from '../resolve-executable';
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
  const executable = await resolveExecutablePath(input.executable);
  if (!executable) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfConverterUnavailable,
      'The configured PDF converter is unavailable.',
      false,
    );
  }

  const startedAt = Date.now();
  // The converter process uses the output directory as cwd. Resolve every
  // configured workspace path before spawning so a relative
  // WORKER_TMP_DIR cannot make the input workbook disappear from its view.
  const inputPath = resolve(input.inputPath);
  const outputDir = resolve(input.outputDir);
  const profileDir = resolve(input.profileDir);
  const expectedOutput = join(outputDir, `${basename(inputPath, '.xlsx')}.pdf`);
  const binaryDir = dirname(executable);
  const args = [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--headless',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    '--convert-to',
    'pdf:calc_pdf_Export',
    '--outdir',
    outputDir,
    inputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: outputDir,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        HOME: profileDir,
        TMPDIR: outputDir,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        PATH: [binaryDir, process.env.PATH, '/usr/local/bin', '/usr/bin', '/bin']
          .filter((entry): entry is string => Boolean(entry))
          .join(delimiter),
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
