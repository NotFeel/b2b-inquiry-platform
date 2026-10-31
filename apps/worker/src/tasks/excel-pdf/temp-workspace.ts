import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface ExcelPdfTempWorkspace {
  root: string;
  inputPath: string;
  normalisedInputPath: string;
  outputDir: string;
  profileDir: string;
  cleanup: () => Promise<void>;
}

/** Fails before a conversion claims work when the configured temp volume is unusable. */
export async function assertExcelPdfTempWorkspaceWritable(baseDir: string): Promise<void> {
  await fs.mkdir(baseDir, { recursive: true, mode: 0o700 });
  const probe = join(baseDir, `.write-probe-${randomUUID()}`);
  try {
    const handle = await fs.open(probe, 'wx', 0o600);
    try {
      await handle.writeFile('ok', 'utf8');
    } finally {
      await handle.close();
    }
  } finally {
    await fs.rm(probe, { force: true });
  }
}

/** Creates a private per-conversion workspace under the configured temp root. */
export async function createExcelPdfTempWorkspace(baseDir: string): Promise<ExcelPdfTempWorkspace> {
  await fs.mkdir(baseDir, { recursive: true, mode: 0o700 });
  const root = join(baseDir, `excel-pdf-${randomUUID()}`);
  const outputDir = join(root, 'output');
  const profileDir = join(root, 'libreoffice-profile');
  await fs.mkdir(root, { recursive: false, mode: 0o700 });
  await Promise.all([
    fs.mkdir(outputDir, { recursive: false, mode: 0o700 }),
    fs.mkdir(profileDir, { recursive: false, mode: 0o700 }),
  ]);

  return {
    root,
    inputPath: join(root, 'input.xlsx'),
    normalisedInputPath: join(root, 'print.xlsx'),
    outputDir,
    profileDir,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
