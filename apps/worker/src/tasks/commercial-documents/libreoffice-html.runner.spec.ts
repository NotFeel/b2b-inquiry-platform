import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertHtmlWithLibreOffice, HtmlConversionError } from './libreoffice-html.runner';

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

describe('convertHtmlWithLibreOffice', () => {
  it('runs a converter configured as a command on PATH', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'commercial-libreoffice-runner-'));
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
    *.html) input="$1"; shift ;;
    *) shift ;;
  esac
done
file="\${input##*/}"
name="\${file%.html}"
printf '%%PDF-1.7\\n%%%%EOF\\n' > "$out/$name.pdf"
`,
    );
    await fs.chmod(executable, 0o700);
    const inputPath = join(root, 'document.html');
    await fs.writeFile(inputPath, '<html><body>test</body></html>');
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`;

    try {
      const result = await convertHtmlWithLibreOffice({
        executable: 'fake-soffice',
        inputPath,
        outputDir,
        profileDir,
        timeoutMs: 10_000,
      });
      await expect(fs.readFile(result.outputPath, 'utf8')).resolves.toContain('%PDF-1.7');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports an unavailable converter before spawning', async () => {
    await expect(
      convertHtmlWithLibreOffice({
        executable: '/definitely/missing/soffice',
        inputPath: '/tmp/not-used.html',
        outputDir: '/tmp',
        profileDir: '/tmp',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('COMMERCIAL_DOCUMENT_CONVERTER_UNAVAILABLE');
  });

  it('stores a stable error code while retaining converter diagnostics internally', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'commercial-libreoffice-failure-'));
    const binDir = join(root, 'bin');
    const outputDir = join(root, 'output');
    const profileDir = join(root, 'profile');
    await fs.mkdir(binDir);
    await fs.mkdir(outputDir);
    await fs.mkdir(profileDir);

    const executable = join(binDir, 'failing-soffice');
    await fs.writeFile(executable, '#!/bin/sh\necho "converter failed" >&2\nexit 42\n');
    await fs.chmod(executable, 0o700);
    const inputPath = join(root, 'document.html');
    await fs.writeFile(inputPath, '<html><body>test</body></html>');

    try {
      const error = await convertHtmlWithLibreOffice({
        executable,
        inputPath,
        outputDir,
        profileDir,
        timeoutMs: 10_000,
      }).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(HtmlConversionError);
      expect(error).toMatchObject({
        message: 'COMMERCIAL_DOCUMENT_CONVERSION_FAILED',
        exitCode: 42,
        stderr: 'converter failed',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('resolves relative workspace paths before changing the child cwd', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'commercial-libreoffice-relative-'));
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
    *.html) input="$1"; shift ;;
    *) shift ;;
  esac
done
file="\${input##*/}"
name="\${file%.html}"
printf '%%PDF-1.7\\n%%%%EOF\\n' > "$out/$name.pdf"
`,
    );
    await fs.chmod(executable, 0o700);
    const inputPath = join(root, 'document.html');
    await fs.writeFile(inputPath, '<html><body>relative paths</body></html>');
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`;

    try {
      const result = await convertHtmlWithLibreOffice({
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
