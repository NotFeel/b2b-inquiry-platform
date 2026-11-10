import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertWorkbookWithLibreOffice } from './libreoffice.runner';

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

describe('convertWorkbookWithLibreOffice', () => {
  it('resolves relative workspace paths before changing the child cwd', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'excel-libreoffice-relative-'));
    const binDir = join(root, 'bin');
    const outputDir = join(root, 'output');
    const profileDir = join(root, 'profile');
    await fs.mkdir(binDir);
    await fs.mkdir(outputDir);
    await fs.mkdir(profileDir);

    const executable = join(binDir, 'fake-soffice');
    await fs.writeFile(
      executable,
      `#!/bin/sh
set -eu
input=""
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --outdir) out="$2"; shift 2 ;;
    *.xlsx) input="$1"; shift ;;
    *) shift ;;
  esac
done
file="\${input##*/}"
name="\${file%.xlsx}"
printf '%%PDF-1.7\\n%%%%EOF\\n' > "$out/$name.pdf"
`,
    );
    await fs.chmod(executable, 0o700);
    const inputPath = join(root, 'input.xlsx');
    await fs.writeFile(inputPath, 'not-a-real-workbook');
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`;

    try {
      const result = await convertWorkbookWithLibreOffice({
        executable: 'fake-soffice',
        inputPath: relative(process.cwd(), inputPath),
        outputDir: relative(process.cwd(), outputDir),
        profileDir: relative(process.cwd(), profileDir),
        timeoutMs: 10_000,
      });
      await expect(fs.readFile(result.outputPath, 'utf8')).resolves.toContain('%PDF-1.7');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
